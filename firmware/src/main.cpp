#include <Arduino.h>
#include <GyverNTP.h>
#include <Looper.h>
#include <RunningGFX.h>
#include <WiFiConnector.h>

#include "config.h"
#include "crash.h"
#include "log.h"
#include "matrix.h"
#include "otaboot.h"
#include "settings.h"

void runString(String str) {
    RunningGFX run(matrix);
    matrix.clear();
    matrix.setModeDiag();
    run.setSpeed(10);
    run.setWindow(0, matrix.width(), 1);
    run.setColor24(0x00ff00);
    run.setFont(gfx_font_3x5);
    run.setText(str);
    run.start();

    while (run.tick() != RG_FINISH) {
        delay(0);
        yield();
    }
}

void setup() {
    Serial.begin(115200);
    crashBegin();
    Serial.println("\n" PROJECT_NAME " v" PROJECT_VER);

    // the clock keeps its network in the DB: the mode changes (AP on while connecting, off once connected) and
    // WiFi.begin need not write the SDK's config to flash every time
    WiFi.persistent(false);

    // an update the confirm asked for runs here, before anything else takes heap; back = nothing to do, or it failed
    otaBoot();

    matrix.begin();

    WiFiConnector.setName(PROJECT_NAME);

    WiFiConnector.onConnect([]() {
        logWifiCheck();
        NTP.begin();

        Serial.print("Connected: ");
        Serial.println(WiFi.localIP());
        if (db[kk::show_ip]) runString(WiFi.localIP().toString());
        
        otaCheck();
    });

    WiFiConnector.onError([]() {
        logWifiDown();
        String str("Error! AP: ");
        str += WiFi.softAPSSID();
        Serial.println(str);
        runString(str);
    });
}

void loop() {
    Looper.loop();
}