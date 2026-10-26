#pragma once
#include <Arduino.h>

// The update over the air runs in a boot of its own. The «Обновить» confirm keeps a request in RTC user memory and
// restarts; the next boot connects Wi-Fi as a station and runs ota.updateNow() first, before the web server, NTP,
// the animations and the log target start: with all the heap (a TLS download needs ~33 KB, a running clock has
// ~29 KB). Success restarts into the new firmware; a failure, or a crash in that boot, becomes the last result and
// the boot goes on as a normal one. The lines of that boot wait in the log's ring for the target.

// the confirm: keep the request with the network to use and restart in a moment (otaBootTick). False, with a line
// in the log, when the clock has no network to update over
bool otaBootRequest(const String& ssid, const String& pass);

// restarts the clock once a request was kept and the confirm's answer had its time to go out
void otaBootTick();

// early in setup, after crashBegin: the update when one was requested. It comes back when there was nothing to do
// or the update failed
void otaBoot();

// once the DB is up: the result of an update this boot found or made goes into it (kk::ota_last), with its log line
void otaBootStore();
