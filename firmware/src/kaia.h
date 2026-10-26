#pragma once
#include <Arduino.h>

#ifdef ESP8266
#include <ESP8266WebServer.h>
typedef ESP8266WebServer KaiaServer;
#else
#include <WebServer.h>
typedef WebServer KaiaServer;
#endif

// K.A.I.A.'s display: a RAM-only overlay over the clock (nothing of it goes to the DB)

// the wakes (kaia_wake): 0 the style's own, 1..WAKE_COUNT - 1 the others; their names for a Select, in PROGMEM
#define WAKE_COUNT 12
extern const char kaia_wake_names[] PROGMEM;

// build the ball tables and add /kaia/state, /kaia/show, /kaia/anim, /kaia/log, /kaia/frame, /kaia/wifi to the
// settings server, and the auth check of /settings set and click: before the Settings library's begin()
void kaiaBegin(KaiaServer& server);

// draw one 50 ms frame over the clock; night = night mode is on
void kaiaDraw(bool night);

// 255 = the background as set, less while the overlay plays
uint8_t kaiaBackScale();
