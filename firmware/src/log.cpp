#include "log.h"

#include <GyverNTP.h>
#include <Looper.h>
#include <WiFiUdp.h>
#include <stdarg.h>

#include "config.h"
#include "crash.h"

#define LOG_RING_BYTES 4096  // the ring: entries of 3 bytes of header (length, severity) and the line without its <PRI>
#define LOG_RING_LINES 40
#define LOG_LINE_MAX 480     // a datagram, <PRI> included
#define LOG_PER_SEC 20       // lines made a second; datagrams sent a second
#define LOG_PRI_LEN 5        // "<131>"
#define LOG_HEAP_MS 60000
#define LOG_POLL_MS 60000    // a poll line per path a minute

static char line[LOG_LINE_MAX + 1];  // the line being made, or being sent

static char ring[LOG_RING_BYTES];
// byte counters that only grow: the oldest entry, the next free place, the first entry not sent yet
static uint32_t r_rd = 0, r_wr = 0, r_sc = 0;
static uint8_t r_lines = 0;

static uint32_t seq = 0;
static uint32_t make_win = 0, send_win = 0;  // start of the second that the counters below belong to
static uint8_t make_n = 0, send_n = 0;
static uint16_t dropped = 0;

static WiFiUDP udp;
static bool target_on = false;
static IPAddress target_ip;
static uint16_t target_port = 0;
static char target_text[24] = "";
static bool retrying = false;  // a send failed: wait until retry_at
static uint32_t retry_at = 0;

static int8_t wifi_state = -1;  // -1 not up yet, 0 down, 1 up

static KaiaServer* srv = nullptr;

// ================= the ring =================

static inline uint8_t rget(uint32_t pos) {
    return ring[pos % LOG_RING_BYTES];
}

static inline void rput(uint32_t pos, uint8_t b) {
    ring[pos % LOG_RING_BYTES] = b;
}

static inline uint16_t entryLen(uint32_t pos) {
    return rget(pos) | (rget(pos + 1) << 8);
}

static void dropOldest() {
    r_rd += 3 + entryLen(r_rd);
    r_lines--;
    if (r_sc < r_rd) r_sc = r_rd;
}

static void ringPush(LogSev sev, const char* body, uint16_t len) {
    uint32_t need = 3 + len;
    while (r_lines >= LOG_RING_LINES || (r_wr - r_rd) + need > LOG_RING_BYTES) dropOldest();

    rput(r_wr, len & 0xff);
    rput(r_wr + 1, len >> 8);
    rput(r_wr + 2, sev);
    for (uint16_t i = 0; i < len; i++) rput(r_wr + 3 + i, body[i]);
    r_wr += need;
    r_lines++;
}

// the entry at pos into line[]: with its <PRI> (datagram = true) or without
static uint16_t ringRead(uint32_t pos, bool datagram) {
    uint16_t len = entryLen(pos);
    uint8_t sev = rget(pos + 2);
    char* to = line;
    if (datagram) {
        snprintf_P(line, LOG_PRI_LEN + 1, PSTR("<%u>"), 128 + sev);
        to += LOG_PRI_LEN;
    }
    for (uint16_t i = 0; i < len; i++) to[i] = rget(pos + 3 + i);
    return to - line + len;
}

// ================= the datagrams =================

static bool sendBudget() {
    uint32_t now = millis();
    if (now - send_win >= 1000) {
        send_win = now;
        send_n = 0;
    }
    if (send_n >= LOG_PER_SEC) return false;
    send_n++;
    return true;
}

// every line that the target has not got yet, oldest first
static void flush() {
    if (!target_on) {
        r_sc = r_wr;
        return;
    }
    if (WiFi.status() != WL_CONNECTED) return;
    if (retrying && (int32_t)(millis() - retry_at) < 0) return;
    retrying = false;

    while (r_sc < r_wr) {
        if (!sendBudget()) return;
        uint16_t n = ringRead(r_sc, true);
        if (!udp.beginPacket(target_ip, target_port) || (udp.write((const uint8_t*)line, n), !udp.endPacket())) {
            retrying = true;
            retry_at = millis() + 500;
            return;
        }
        r_sc += 3 + entryLen(r_sc);
    }
}

// ================= the log =================

void logf_P(LogSev sev, PGM_P event, PGM_P fmt, ...) {
    uint32_t now = millis();
    if (now - make_win >= 1000) {
        make_win = now;
        make_n = 0;
    }
    if (make_n >= LOG_PER_SEC) {
        dropped++;
        return;
    }
    make_n++;

    char ev[12];
    strncpy_P(ev, event, sizeof(ev) - 1);
    ev[sizeof(ev) - 1] = 0;

    int n = snprintf_P(line, sizeof(line), PSTR("<%u>ballclock: %u %u %s "), 128 + sev, (unsigned)++seq, (unsigned)now, ev);
    va_list ap;
    va_start(ap, fmt);
    int m = vsnprintf_P(line + n, sizeof(line) - n, fmt, ap);
    va_end(ap);
    if (m > 0) n += m;
    if (n > LOG_LINE_MAX) n = LOG_LINE_MAX;

    // one line, one datagram: nothing but printable ASCII
    for (int i = LOG_PRI_LEN; i < n; i++) {
        if ((uint8_t)line[i] < 0x20 || (uint8_t)line[i] > 0x7e) line[i] = ' ';
    }

    ringPush(sev, line + LOG_PRI_LEN, n - LOG_PRI_LEN);
    flush();
}

bool logSetTarget(const char* hostPort) {
    while (*hostPort == ' ') hostPort++;
    size_t len = strlen(hostPort);
    while (len && hostPort[len - 1] == ' ') len--;

    if (!len) {
        if (target_on) udp.stop();
        target_on = false;
        target_text[0] = 0;
        return true;
    }
    if (len >= sizeof(target_text)) return false;

    char buf[sizeof(target_text)];
    memcpy(buf, hostPort, len);
    buf[len] = 0;

    uint32_t port = 514;
    char* colon = strchr(buf, ':');
    if (colon) {
        *colon = 0;
        const char* p = colon + 1;
        if (!*p || strlen(p) > 5) return false;
        port = 0;
        for (; *p; p++) {
            if (*p < '0' || *p > '9') return false;
            port = port * 10 + (*p - '0');
        }
        if (!port || port > 65535) return false;
    }

    for (const char* p = buf; *p; p++) {
        if ((*p < '0' || *p > '9') && *p != '.') return false;
    }
    IPAddress ip;
    if (!ip.fromString(buf) || ip == IPAddress(0, 0, 0, 0)) return false;

    char text[sizeof(target_text)];
    snprintf_P(text, sizeof(text), PSTR("%u.%u.%u.%u:%u"), ip[0], ip[1], ip[2], ip[3], (unsigned)port);
    if (!target_on || strcmp(text, target_text)) {
        // a new target gets what the ring still holds
        r_sc = r_rd;
    }
    strcpy(target_text, text);
    target_ip = ip;
    target_port = port;
    target_on = true;
    return true;
}

const char* logTarget() {
    return target_text;
}

void logBegin(const char* target) {
    if (target && !logSetTarget(target)) logSetTarget("");

    const CrashInfo& c = crashInfo();
    unsigned heap = ESP.getFreeHeap(), block = ESP.getMaxFreeBlockSize();
    if (!c.valid) {
        LOGF(LG_INFO, "boot", "ver=" PROJECT_VER " reason=\"%s\" heap=%u block=%u", crashResetReason(), heap, block);
        return;
    }

    char bt[CRASH_BT_MAX * 11 + 1];
    bt[0] = 0;
    for (uint8_t i = 0; i < c.nbt; i++) {
        snprintf_P(bt + strlen(bt), sizeof(bt) - strlen(bt), PSTR("%s0x%08x"), i ? "," : "", (unsigned)c.bt[i]);
    }
    // the Kernel's keys (KAIA-156) first; crash= after them says what the record is (a panic boots as a software restart)
    char kind[12];  // the longest word is "exception"
    strcpy_P(kind, crashKind());
    LOGF(LG_WARN, "boot", "ver=" PROJECT_VER " reason=\"%s\" heap=%u block=%u cause=%u epc1=0x%08x excvaddr=0x%08x up=%u bt=%s crash=%s",
         crashResetReason(), heap, block, (unsigned)c.cause, (unsigned)c.epc1, (unsigned)c.excvaddr, (unsigned)c.up, bt, kind);
}

void logWifiDown() {
    if (wifi_state == 0) return;
    wifi_state = 0;
    LOGF(LG_WARN, "wifi", "down");
}

void logWifiCheck() {
    bool up = WiFi.status() == WL_CONNECTED;
    if (up == (wifi_state == 1)) return;

    wifi_state = up;
    if (up) {
        IPAddress ip = WiFi.localIP();
        LOGF(LG_INFO, "wifi", "up rssi=%d ip=%u.%u.%u.%u", (int)WiFi.RSSI(), ip[0], ip[1], ip[2], ip[3]);
    } else {
        LOGF(LG_WARN, "wifi", "down");
    }
}

void logDump(KaiaServer& server) {
    size_t total = 0;
    for (uint32_t pos = r_rd; pos < r_wr; pos += 3 + entryLen(pos)) total += entryLen(pos) + 1;

    server.setContentLength(total);
    server.send(200, "text/plain", emptyString);
    for (uint32_t pos = r_rd; pos < r_wr; pos += 3 + entryLen(pos)) {
        uint16_t n = ringRead(pos, false);
        line[n++] = '\n';
        server.sendContent(line, n);
    }
}

// ================= HTTP =================

static struct {
    bool active = false;
    int code = 200;
    uint32_t t0 = 0;
    unsigned heap0 = 0, block0 = 0;
    char m[8];
    char path[48];
    char from[16];
} rq;

// the text for a value of a line: printable ASCII, no spaces or quotes
static void copySafe(char* dst, size_t cap, const char* src) {
    size_t i = 0;
    for (; src[i] && i < cap - 1; i++) {
        uint8_t c = src[i];
        dst[i] = (c > 0x20 && c < 0x7f && c != '"') ? c : '?';
    }
    dst[i] = 0;
}

void logHttpAttach(KaiaServer& server) {
    srv = &server;
#ifdef ESP8266
    // runs when a request has been read, before the handler
    server.addHook([](const String& method, const String& url, WiFiClient* client, KaiaServer::ContentTypeFunction) {
        rq.active = true;
        rq.code = 200;
        rq.t0 = millis();
        rq.heap0 = ESP.getFreeHeap();
        rq.block0 = ESP.getMaxFreeBlockSize();
        copySafe(rq.m, sizeof(rq.m), method.c_str());
        copySafe(rq.path, sizeof(rq.path), url.c_str());
        IPAddress ip = client ? client->remoteIP() : IPAddress();
        snprintf_P(rq.from, sizeof(rq.from), PSTR("%u.%u.%u.%u"), ip[0], ip[1], ip[2], ip[3]);
        return KaiaServer::CLIENT_REQUEST_CAN_CONTINUE;
    });
#endif
}

void logHttpCode(int code) {
    rq.code = code;
}

// the site polls these: answered 200, they make one line a minute per path instead of one a request
static struct Poll {
    const char* path;
    uint32_t since;  // the first request of this minute
    uint16_t n;
    unsigned ms_max, heap_min;
} polls[] = {{"/kaia/state"}, {"/kaia/frame"}};

static bool pollCount(unsigned ms, unsigned heap) {
    if (rq.code != 200) return false;
    for (Poll& p : polls) {
        if (strcmp(rq.path, p.path)) continue;
        if (!p.n) {
            p.since = rq.t0;
            p.ms_max = 0;
            p.heap_min = UINT_MAX;
        }
        if (p.n < UINT16_MAX) p.n++;
        p.ms_max = max(p.ms_max, ms);
        p.heap_min = min(p.heap_min, min(rq.heap0, heap));
        return true;
    }
    return false;
}

static void pollLines(uint32_t now) {
    for (Poll& p : polls) {
        if (!p.n || now - p.since < LOG_POLL_MS) continue;
        LOGF(LG_INFO, "http", "poll path=%s n=%u ms_max=%u heap_min=%u", p.path, (unsigned)p.n, p.ms_max, p.heap_min);
        p.n = 0;
    }
}

void logHttpEnd() {
    if (!rq.active) return;
    rq.active = false;

    unsigned ms = millis() - rq.t0;
    unsigned heap = ESP.getFreeHeap(), block = ESP.getMaxFreeBlockSize();
    if (pollCount(ms, heap)) return;
    LogSev sev = rq.code >= 500 ? LG_ERROR : rq.code >= 400 ? LG_WARN : LG_INFO;

    // the settings page says what it does in "action"; its value is never logged
    char action[16] = "";
    if (srv && !strcmp(rq.path, "/settings")) {
        for (int i = 0; i < srv->args(); i++) {
            if (srv->argName(i) == "action") copySafe(action, sizeof(action), srv->arg(i).c_str());
        }
    }

    if (action[0]) {
        LOGF(sev, "http", "m=%s path=%s action=%s from=%s ms=%u heap=%u>%u block=%u>%u code=%d",
             rq.m, rq.path, action, rq.from, ms, rq.heap0, heap, rq.block0, block, rq.code);
    } else {
        LOGF(sev, "http", "m=%s path=%s from=%s ms=%u heap=%u>%u block=%u>%u code=%d",
             rq.m, rq.path, rq.from, ms, rq.heap0, heap, rq.block0, block, rq.code);
    }
}

// ================= every loop turn =================

static void logTick() {
    static uint32_t heap_at = LOG_HEAP_MS;
    static bool synced = false;
    uint32_t now = millis();

    if (Looper.thisSetup()) return;

    flush();

    logWifiCheck();
    pollLines(now);

    bool s = NTP.synced();
    if (s && !synced) LOGF(LG_INFO, "ntp", "synced");
    synced = s;

    if ((int32_t)(now - heap_at) >= 0) {
        heap_at = now + LOG_HEAP_MS;
        unsigned heap = ESP.getFreeHeap();
        crashNoteHeap(heap);
        LOGF(LG_DEBUG, "heap", "free=%u block=%u frag=%u", heap, (unsigned)ESP.getMaxFreeBlockSize(), (unsigned)ESP.getHeapFragmentation());
    }

    if (dropped && now - make_win >= 1000) {
        LOGF(LG_ERROR, "error", "what=\"log rate limit\" lost=%u", (unsigned)dropped);
        dropped = 0;
    }
}

LP_TICKER(logTick);
