#include "otaboot.h"

#include <ESP8266WiFi.h>
#include <stdarg.h>

#include "config.h"
#include "log.h"
#include "settings.h"

// RTC user memory is 512 bytes in 4-byte words: eboot has words 0-31, the crash record 32-59 (crash.cpp)
#define OTA_RTC_WORDS 64
#define OTA_MAGIC 0x4b4f5441  // "KOTA"

// what a TLS download takes in the ESP8266 core 3.1.2: BearSSL's own stack (StackThunk), the client context, the
// receive buffer for GitHub's 16 KB records and the send buffer, the Updater's flash sector
#define OTA_NEED_HEAP (6200 + 3408 + 16709 + 597 + 4096)
#define OTA_RESERVE 2048               // lwIP's receive window (4 × 536) and the Wi-Fi SDK, which does not check its mallocs
#define OTA_NEED_BLOCK (16709 + 3408)  // the receive buffer in one piece, the context beside it
#define OTA_TRIES 3
#define OTA_PAUSE_MS 2000
#define OTA_WIFI_MS 20000
#define OTA_RESTART_MS 500  // the confirm's answer and its log line go out first

enum OtaState : uint8_t {
    OS_REQUESTED = 1,  // the confirm asked for it
    OS_RUNNING,        // the update boot runs it: found at boot, that boot crashed
    OS_DONE,           // flashed, restarting into the new firmware
};

struct OtaRecord {
    uint32_t magic;
    uint8_t state;
    uint8_t tries;
    uint16_t reserved;
    uint32_t heap, block;  // at the last stage
    uint32_t done, total;  // bytes written, bytes of the bin
    char stage[12];
    char from[12];  // the version that ran the update
    char ssid[33];  // the network, kept from the confirm to the update boot only
    char pass[65];
    uint8_t pad[2];
    uint32_t sum;  // the fields above: the layout of v1.5.1-1.5.2, whose update boot writes the record this one reads
    // from v1.5.3 on, with a checksum of their own (over the whole record): a v1.5.2 update boot leaves them invalid
    uint32_t heap0, block0;        // at the update boot's start
    uint32_t heap_min, block_min;  // the lowest over its stages
    uint32_t sum_heap;
};
static_assert(sizeof(OtaRecord) % 4 == 0, "RTC memory is written in words");
static_assert(offsetof(OtaRecord, sum) == 148, "v1.5.2 update boots write the record up to this sum");
static_assert(OTA_RTC_WORDS * 4 + sizeof(OtaRecord) <= 512, "RTC user memory is 512 bytes");

// static RAM is heap the download does not get: the record lives on the stack of the update boot
static OtaRecord* rec = nullptr;
static String result;  // the result this boot found or made, until the DB has it
static uint32_t restart_at = 0;

// over the record's first bytes (a multiple of 4)
static uint32_t checksum(const OtaRecord& r, size_t bytes) {
    const uint32_t* w = (const uint32_t*)&r;
    uint32_t s = 0x9e3779b9;
    for (size_t i = 0; i < bytes / 4; i++) s = (s << 5 | s >> 27) ^ w[i];
    return s;
}

static bool heapValid(const OtaRecord& r) {
    return r.sum_heap == checksum(r, offsetof(OtaRecord, sum_heap));
}

static void save(OtaRecord& r) {
    r.sum = checksum(r, offsetof(OtaRecord, sum));
    r.sum_heap = checksum(r, offsetof(OtaRecord, sum_heap));
    ESP.rtcUserMemoryWrite(OTA_RTC_WORDS, (uint32_t*)&r, sizeof(r));
}

// the network goes with it
static void clear(OtaRecord& r) {
    memset(&r, 0, sizeof(r));
    ESP.rtcUserMemoryWrite(OTA_RTC_WORDS, (uint32_t*)&r, sizeof(r));
}

static void setResult(PGM_P fmt, ...) __attribute__((format(printf, 1, 2)));
static void setResult(PGM_P fmt, ...) {
    char buf[128];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf_P(buf, sizeof(buf), fmt, ap);
    va_end(ap);
    result = buf;
}

bool otaBootRequest(const String& ssid, const String& pass) {
    OtaRecord r;
    if (!ssid.length() || ssid.length() >= sizeof(r.ssid) || pass.length() >= sizeof(r.pass)) {
        LOGF(LG_ERROR, "ota", "update result=wifi what=\"no network to update over\"");
        db[kk::ota_last] = String(F("result=wifi"));
        return false;
    }

    memset(&r, 0, sizeof(r));
    r.magic = OTA_MAGIC;
    r.state = OS_REQUESTED;
    strlcpy(r.from, PROJECT_VER, sizeof(r.from));
    memcpy(r.ssid, ssid.c_str(), ssid.length());
    memcpy(r.pass, pass.c_str(), pass.length());
    save(r);
    memset(&r, 0, sizeof(r));

    LOGF(LG_INFO, "ota", "update result=restart");
    restart_at = millis() + OTA_RESTART_MS;
    if (!restart_at) restart_at = 1;
    return true;
}

void otaBootTick() {
    if (!restart_at || (int32_t)(millis() - restart_at) < 0) return;
    Serial.println(F("OTA: restart into the update boot"));
    db.update();  // what the DB holds for its 10 s timeout
    ESP.restart();
}

static void stage(const char* name, size_t done, size_t total) {
    OtaRecord& r = *rec;
    r.heap = ESP.getFreeHeap();
    r.block = ESP.getMaxFreeBlockSize();
    if (r.heap < r.heap_min) r.heap_min = r.heap;
    if (r.block < r.block_min) r.block_min = r.block;
    r.done = done;
    r.total = total;
    strlcpy(r.stage, name, sizeof(r.stage));
    if (!strcmp(name, "restart")) r.state = OS_DONE;
    save(r);
    LOGF(LG_INFO, "ota", "update stage=%s try=%u kb=%u/%u heap=%u block=%u",
         name, (unsigned)r.tries, (unsigned)(done / 1024), (unsigned)(total / 1024), (unsigned)r.heap, (unsigned)r.block);
}

void otaBoot() {
    OtaRecord r;
    if (!ESP.rtcUserMemoryRead(OTA_RTC_WORDS, (uint32_t*)&r, sizeof(r)) || r.magic != OTA_MAGIC ||
        r.sum != checksum(r, offsetof(OtaRecord, sum)))
        return;
    r.stage[sizeof(r.stage) - 1] = 0;
    r.from[sizeof(r.from) - 1] = 0;

    if (r.state == OS_DONE) {
        // the firmware before flashed this one: it runs, unless the same version came back. The update boot's heap
        // goes with it: its own log lines were lost at the restart
        char mem[64] = "";
        if (heapValid(r)) {
            snprintf_P(mem, sizeof(mem), PSTR(" heap0=%u block0=%u heap_min=%u block_min=%u"), (unsigned)r.heap0,
                       (unsigned)r.block0, (unsigned)r.heap_min, (unsigned)r.block_min);
        }
        if (strcmp(r.from, PROJECT_VER)) setResult(PSTR("result=ok from=%s kb=%u%s"), r.from, (unsigned)(r.total / 1024), mem);
        else setResult(PSTR("result=same kb=%u%s"), (unsigned)(r.total / 1024), mem);
        clear(r);
        return;
    }
    if (r.state == OS_RUNNING) {
        // the update boot never came back: it crashed (the boot line has the crash), the old firmware runs
        setResult(PSTR("result=crash try=%u stage=%s kb=%u/%u heap=%u block=%u"), (unsigned)r.tries, r.stage,
                  (unsigned)(r.done / 1024), (unsigned)(r.total / 1024), (unsigned)r.heap, (unsigned)r.block);
        clear(r);
        return;
    }
    if (r.state != OS_REQUESTED) {
        clear(r);
        return;
    }

    // the update boot: from here a crash leaves OS_RUNNING and its stage behind
    char ssid[sizeof(r.ssid)], pass[sizeof(r.pass)];
    memcpy(ssid, r.ssid, sizeof(ssid));
    memcpy(pass, r.pass, sizeof(pass));
    ssid[sizeof(ssid) - 1] = 0;
    pass[sizeof(pass) - 1] = 0;
    memset(r.ssid, 0, sizeof(r.ssid));
    memset(r.pass, 0, sizeof(r.pass));
    r.state = OS_RUNNING;
    strlcpy(r.stage, "wifi", sizeof(r.stage));
    r.heap0 = r.heap_min = ESP.getFreeHeap();
    r.block0 = r.block_min = ESP.getMaxFreeBlockSize();
    save(r);
    rec = &r;

    Serial.println(F("OTA: the update boot"));
    LOGF(LG_INFO, "ota", "update boot from=%s heap=%u block=%u", r.from, (unsigned)r.heap0, (unsigned)r.block0);

    // a station only: no access point for the SDK to keep and answer probes with
    uint32_t t0 = millis();
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, pass);
    memset(pass, 0, sizeof(pass));
    while (WiFi.status() != WL_CONNECTED && millis() - t0 < OTA_WIFI_MS) delay(100);

    if (WiFi.status() != WL_CONNECTED) {
        setResult(PSTR("result=wifi ms=%u"), (unsigned)(millis() - t0));
    } else {
        stage("wifi", 0, 0);
        ota.onStage(stage);
        for (r.tries = 1; r.tries <= OTA_TRIES; r.tries++) {
            unsigned heap = ESP.getFreeHeap(), block = ESP.getMaxFreeBlockSize();
            if (heap < OTA_NEED_HEAP + OTA_RESERVE || block < OTA_NEED_BLOCK) {
                setResult(PSTR("result=lowmem try=%u free=%u block=%u need=%u/%u"), (unsigned)r.tries, heap, block,
                          (unsigned)(OTA_NEED_HEAP + OTA_RESERVE), (unsigned)OTA_NEED_BLOCK);
                break;
            }

            ota.updateNow();  // restarts the clock when it succeeds

            // the last stage it reached, with its heap
            setResult(PSTR("result=%s try=%u stage=%s kb=%u/%u heap=%u block=%u ssl=%d"), otaError(), (unsigned)r.tries,
                      r.stage, (unsigned)(r.done / 1024), (unsigned)(r.total / 1024), (unsigned)r.heap, (unsigned)r.block,
                      ota.sslError());
            if (ota.sslError()) LOGF(LG_WARN, "ota", "update try=%u ssl=%d what=\"%s\"", (unsigned)r.tries, ota.sslError(), ota.sslErrorText());

            // the flash refused the image: no try will do better
            AutoOTA::Error err = ota.getError();
            if (err == AutoOTA::Error::OtaStart || err == AutoOTA::Error::OtaEnd) break;
            if (r.tries < OTA_TRIES) {
                LOGF(LG_WARN, "ota", "update %s", result.c_str());
                delay(OTA_PAUSE_MS);
            }
        }
        ota.onStage(nullptr);
    }
    rec = nullptr;
    clear(r);
}

void otaBootStore() {
    if (!result.length()) return;
    bool ok = result.startsWith(F("result=ok "));
    LOGF(ok ? LG_INFO : LG_ERROR, "ota", "update %s", result.c_str());
    db[kk::ota_last] = result;
    result = String();
}
