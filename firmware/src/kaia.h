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

// the styles (kaia_anim): 0 off, 1–3 ripple, orbit, sparks, 4–9 Kaya's styles of v1.8, 10..STYLE_COUNT those of v1.9;
// their names for a Select, in PROGMEM
#define STYLE_COUNT 18
extern const char kaia_style_names[] PROGMEM;

// the wakes (kaia_wake): 0 the style's own, 1..WAKE_COUNT - 1 the others (15–29 those of styles 4–18, 30–33 catalog C's
// singles); their names for a Select, in PROGMEM
#define WAKE_COUNT 34
extern const char kaia_wake_names[] PROGMEM;

// the looks of the other events (kaia_listen, kaia_think, kaia_speak, kaia_done, kaia_error, kaia_notify):
// 0 as the style (kaia_anim), 1–3 the ripple, orbit or sparks version with any style, 4–8 the new ones of v1.6,
// 9–23 the versions of styles 4–18, 24..LOOK_COUNT - 1 catalog C's singles (v1.9)
#define LOOK_COUNT 28
extern const char kaia_listen_names[] PROGMEM;
extern const char kaia_think_names[] PROGMEM;
extern const char kaia_speak_names[] PROGMEM;
extern const char kaia_done_names[] PROGMEM;
extern const char kaia_error_names[] PROGMEM;
extern const char kaia_notify_names[] PROGMEM;

// build the ball tables and add /kaia/state, /kaia/show, /kaia/anim, /kaia/log, /kaia/frame, /kaia/wifi, /kaia/test to the
// settings server, and the auth check of /settings set and click: before the Settings library's begin()
void kaiaBegin(KaiaServer& server);

// draw one 50 ms frame over the clock; night = night mode is on; hide = kaiaDigitScale() of this frame: the digit
// balls take the overlay that much more. It also steps the Digit fade's level
void kaiaDraw(bool night, uint8_t hide);

// 255 = the background as set, less while the overlay plays
uint8_t kaiaBackScale();

// the Digit fade (v1.7): how much of the time to take away, 0..255 (0 = all of it shown), for the redraw before the
// clock; the level kaiaDraw stepped in the frame before
uint8_t kaiaDigitScale();
