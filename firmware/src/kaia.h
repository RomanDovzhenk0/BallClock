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

// build the ball tables and add /kaia/state, /kaia/show, /kaia/anim to the settings server
void kaiaBegin(KaiaServer& server);

// draw one 50 ms frame over the clock; night = night mode is on
void kaiaDraw(bool night);

// 255 = the background as set, less while the overlay plays
uint8_t kaiaBackScale();
