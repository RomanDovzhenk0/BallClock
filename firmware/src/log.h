#pragma once
#include <Arduino.h>

#include "kaia.h"

// The clock's log: lines "ballclock: SEQ UPTIME EVENT key=value ..." kept in a RAM ring (the last 40, GET /kaia/log)
// and sent as UDP datagrams to the log target (the Kernel), when one is set. Static buffers, no String on this path.

enum LogSev : uint8_t {
    LG_ERROR = 3,
    LG_WARN = 4,
    LG_INFO = 6,
    LG_DEBUG = 7,
};

void logf_P(LogSev sev, PGM_P event, PGM_P fmt, ...) __attribute__((format(printf, 3, 4)));

// LOGF(LG_INFO, "wifi", "up rssi=%d", rssi)
#define LOGF(sev, event, fmt, ...) logf_P(sev, PSTR(event), PSTR(fmt), ##__VA_ARGS__)

// target = the DB's log_host ("IP:port", empty = off); writes the boot line
void logBegin(const char* target);

// "IP[:port]" (port 514 when absent), empty = off. False for a bad value, the target stays
bool logSetTarget(const char* hostPort);

// the target as set: "IP:port", or ""
const char* logTarget();

// hook the web server: one http line for every request, but /kaia/state and /kaia/frame answered 200 make one
// "http poll path=… n=… ms_max=… heap_min=…" line a minute per path
void logHttpAttach(KaiaServer& server);

// the code a handler of ours answered with (the Settings library answers 200)
void logHttpCode(int code);

// close the request that this loop turn served: call right after the server's tick
void logHttpEnd();

// GET /kaia/log: the lines as text/plain, oldest first, without the <PRI>
void logDump(KaiaServer& server);

// a line when the Wi-Fi came up or went down since the last call (also every loop turn)
void logWifiCheck();

// the Wi-Fi gave up connecting (the clock opened its own access point)
void logWifiDown();
