#pragma once

#include <GyverDBFile.h>
#include <AutoOTA.h>

extern GyverDBFile db;
extern AutoOTA ota;

// ota.checkUpdate() with a line in the log
void otaCheck();

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
    page_pass,
    log_host      // "IP:port" the log goes to, empty = nowhere

);