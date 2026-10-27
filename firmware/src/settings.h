#pragma once

#include <GyverDBFile.h>
#include <AutoOTA.h>

extern GyverDBFile db;
extern AutoOTA ota;

// ota.checkUpdate() with a line in the log
void otaCheck();

// ota.getError() as the word of the log lines: ok, connect, timeout, http, … size
const char* otaError();

DB_KEYS(
    kk,
    wifi_ssid,
    wifi_pass,
    show_ip,

    ntp_gmt,
    ntp_host,

    bright,
    auto_bright,
    bright_min,
    bright_max,
    adc_min,
    adc_max,

    night_mode,
    night_mode_auto,
    night_mode_auto_since,
    night_mode_auto_to,
    night_color,
    night_trsh,

    clock_style,
    clock_style_zero,
    clock_color,

    back_mode,  // 0 none, 1 grad, 2 perlin
    back_pal,
    back_speed,
    back_angle,
    back_scale,
    back_bright,

    kaia_anim,    // 0 off, 1 ripple, 2 orbit, 3 sparks
    kaia_color,
    kaia_bright,
    kaia_night,   // 0 as usual, 1 dimmer, 2 none
    kaia_wake,        // 0 the style's own wake, 1.. the wakes of kaia.cpp
    kaia_wake_speed,  // 50..200 %
    kaia_listen,      // the look of each event: 0 as the style, 1.. the looks of kaia.cpp
    kaia_think,
    kaia_speak,
    kaia_done,
    kaia_error,
    kaia_notify,
    kaia_hide,        // the Digit fade (v1.7): 0/1, the time fades out while an animation plays
    kaia_hide_out,    // 100..3000 ms to fade out
    kaia_hide_in,     // 100..5000 ms to fade back in
    kaia_hide_hold,   // 0..5000 ms without an animation before it comes back
    kaia_hide_keep,   // 0..100 % of the time that stays
    page_pass,
    log_host,     // "IP:port" the log goes to, empty = nowhere
    ota_last      // the result of the last update over the air: "result=ok from=…", "result=connect try=3 stage=…", …

);