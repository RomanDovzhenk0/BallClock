#include "settings.h"

#include <GyverNTP.h>
#include <LittleFS.h>
#include <Looper.h>
#include <SettingsESP.h>
#include <WiFiConnector.h>

#include "config.h"
#include "kaia.h"
#include "log.h"
#include "otaboot.h"
#include "palettes.h"
#include "redraw.h"
#include "site.h"

AutoOTA ota(PROJECT_VER, PROJECT_URL);

GyverDBFile db(&LittleFS, "/data.db");
static SettingsESP sett(PROJECT_NAME " v" PROJECT_VER, &db);

static void update(sets::Updater& u) {
    String s;
    s += photo.getRaw();
    s += " [";
    s += db[kk::adc_min].toInt16();
    s += ", ";
    s += db[kk::adc_max].toInt16();
    s += "]";
    u.update("adc_val"_h, s);

    u.update("local_time"_h, NTP.timeToString());
    u.update("synced"_h, NTP.synced());
    if (ota.hasUpdate()) u.update("ota_update"_h, F("Доступно обновление. Обновить прошивку?"));

    Looper.getTimer("redraw")->restart(100);
}

// The page is built inside the /settings request, on the 4 KB cont stack under the web server and the library
// (action=load, and every set that calls b.reload()). -Og gives each temporary its own slot, so one function for
// the whole page took a 1.6 KB frame and v1.6.0 overflowed the stack. One function per group: one group's frame
// at a time. noinline, or the compiler folds them back into build()
#define SETS_GROUP static void __attribute__((noinline))

SETS_GROUP buildClock(sets::Builder& b) {
    sets::Group g(b, "Часы");

    b.Select(kk::clock_style, "Шрифт", "Нет;Тип 1;Тип 2;Тип 3");

    if (b.Switch(kk::clock_style_zero, "Ведущий ноль")) b.reload();

    b.Color(kk::clock_color, "Цвет");
}

SETS_GROUP buildBack(sets::Builder& b) {
    sets::Group g(b, "Фон");

    if (b.Select(kk::back_mode, "Фон", "Нет;Градиент;Перлин")) b.reload();

    if (db[kk::back_mode].toInt()) {
        b.Select(kk::back_pal, "Палитра", getPaletteList());
        b.Slider(kk::back_bright, "Яркость", 0, 255);
        b.Slider(kk::back_speed, "Скорость");
        b.Slider(kk::back_scale, "Масштаб");
        b.Slider(kk::back_angle, "Угол", -180, 180);
    }
}

SETS_GROUP buildBright(sets::Builder& b) {
    sets::Group g(b, "Яркость");
    if (b.Switch(kk::auto_bright, "Автояркость")) b.reload();

    if (db[kk::auto_bright]) {
        b.Label("adc_val"_h, "Сигнал с датчика");
        b.Slider(kk::bright_min, "Мин.", 0, 255);
        b.Slider(kk::bright_max, "Макс.", 0, 255);

        {
            sets::Buttons bt(b);
            if (b.Button(kk::adc_min, "Запомнить мин.")) db[kk::adc_min] = photo.getRaw();
            if (b.Button(kk::adc_max, "Запомнить макс.")) db[kk::adc_max] = photo.getRaw();
        }
    } else {
        b.Slider(kk::bright, "Яркость", 0, 255);
    }
}

SETS_GROUP buildNight(sets::Builder& b) {
    sets::Group g(b, "Ночной режим");

    if (b.Switch(kk::night_mode, "Включен")) b.reload();

    if (db[kk::night_mode]) {
        b.Color(kk::night_color, "Цвет");

        if (b.Switch(kk::night_mode_auto, "Автоматический режим")) b.reload();

        if (db[kk::night_mode_auto]) {
            b.Time(kk::night_mode_auto_since, "Время включения");
            b.Time(kk::night_mode_auto_to, "Время отключения");
        }
    }
}

SETS_GROUP buildTime(sets::Builder& b) {
    sets::Group g(b, "Время");

    b.Input(kk::ntp_gmt, "Часовой пояс");
    b.Input(kk::ntp_host, "NTP сервер");
    b.LED("synced"_h, "Синхронизирован", NTP.synced());
    b.Label("local_time"_h, "Локальное время", NTP.timeToString());
}

SETS_GROUP buildWifi(sets::Builder& b) {
    sets::Group g(b, "WiFi");

    b.Switch(kk::show_ip, "Показывать IP");
    b.Input(kk::wifi_ssid, "SSID");
    b.Pass(kk::wifi_pass, "Pass", "");

    if (b.Button("wifi_save"_h, "Подключить")) {
        Looper.pushEvent("wifi_connect");
    }
}

// Kaya's look per event (v1.6), the labels in flash too: every byte of RAM counts for the update boot
SETS_GROUP buildKaiaLooks(sets::Builder& b) {
    b.Select(kk::kaia_listen, F("Слушает"), FPSTR(kaia_listen_names));
    b.Select(kk::kaia_think, F("Думает"), FPSTR(kaia_think_names));
    b.Select(kk::kaia_speak, F("Говорит"), FPSTR(kaia_speak_names));
    b.Select(kk::kaia_done, F("Готово"), FPSTR(kaia_done_names));
    b.Select(kk::kaia_error, F("Ошибка"), FPSTR(kaia_error_names));
    b.Select(kk::kaia_notify, F("Уведомление"), FPSTR(kaia_notify_names));
}

// the Digit fade (v1.7): the time fades out while Kaya's animation plays; flash labels as the looks'
SETS_GROUP buildKaiaHide(sets::Builder& b) {
    b.Switch(kk::kaia_hide, F("Прятать цифры"));
    b.Slider(kk::kaia_hide_out, F("Исчезают за"), 100, 3000, 100, F("мс"));
    b.Slider(kk::kaia_hide_in, F("Появляются за"), 100, 5000, 100, F("мс"));
    b.Slider(kk::kaia_hide_hold, F("Пауза перед появлением"), 0, 5000, 100, F("мс"));
    b.Slider(kk::kaia_hide_keep, F("Остаётся от цифр"), 0, 100, 1, F("%"));
}

SETS_GROUP buildKaia(sets::Builder& b) {
    sets::Group g(b, "K.A.I.A.");

    b.Select(kk::kaia_anim, "Анимации", FPSTR(kaia_style_names));  // v1.8: Kaya's styles 4–9, v1.9: 10–18; the names in flash
    b.Color(kk::kaia_color, "Цвет Каи");
    b.Slider(kk::kaia_bright, "Яркость", 0, 255);
    b.Select(kk::kaia_wake, "Пробуждение", FPSTR(kaia_wake_names));
    b.Slider(kk::kaia_wake_speed, "Скорость пробуждения", 50, 200, 1, "%");
    buildKaiaLooks(b);
    buildKaiaHide(b);
    b.Select(kk::kaia_night, "Ночью", "Как обычно;Тусклее;Не показывать");
    b.Pass(kk::page_pass, "Пароль страницы", "");
    b.Input(kk::log_host, "Сервер логов");
}

SETS_GROUP buildUpdate(sets::Builder& b) {
    sets::Group g(b, "Update");
    b.Label("current_version"_h, "Текущая версия прошивки", PROJECT_VER);
    if (b.Button("check_updates"_h, "Проверить обновления")) {
        Looper.pushEvent("check_updates");
    }
}

static void build(sets::Builder& b) {
    buildClock(b);
    buildBack(b);
    buildBright(b);
    buildNight(b);
    buildTime(b);
    buildWifi(b);
    buildKaia(b);
    buildUpdate(b);

    if (b.Confirm("ota_update"_h)) {
        if (b.build.value.toBool()) {
            Serial.println("OTA update!");
            // not here: a running clock has no heap for the download. It restarts and updates first thing
            otaBootRequest(db[kk::wifi_ssid].toString(), db[kk::wifi_pass].toString());
        }
    }

    if (b.build.isAction()) {
        switch (b.build.id) {
            case kk::ntp_gmt: NTP.setGMT(b.build.value); break;
            case kk::ntp_host: NTP.setHost(b.build.value); break;
            case kk::page_pass: sett.setPass(b.build.value); break;
            case kk::log_host: {
                String v = b.build.value.toString();
                if (!logSetTarget(v.c_str())) LOGF(LG_WARN, "error", "what=\"log_host: IP:port\"");
                if (v != logTarget()) {  // not valid, or written in full
                    db[kk::log_host] = logTarget();
                    b.reload();
                }
            } break;
        }
    }

    Looper.getTimer("redraw")->restart(100);
    // if (b.Button("restart"_h, "restart")) ESP.restart();
}

LP_LISTENER_("wifi_connect", []() {
    db.update();
    WiFiConnector.connect(db[kk::wifi_ssid], db[kk::wifi_pass]);
});

const char* otaError() {
    switch (ota.getError()) {
        case AutoOTA::Error::None: return "ok";
        case AutoOTA::Error::Connect: return "connect";
        case AutoOTA::Error::Timeout: return "timeout";
        case AutoOTA::Error::HTTP: return "http";
        case AutoOTA::Error::NoVersion: return "noversion";
        case AutoOTA::Error::NoPlatform: return "noplatform";
        case AutoOTA::Error::NoPath: return "nopath";
        case AutoOTA::Error::NoUpdates: return "none";
        case AutoOTA::Error::NoFile: return "nofile";
        case AutoOTA::Error::OtaStart: return "otastart";
        case AutoOTA::Error::OtaEnd: return "otaend";
        case AutoOTA::Error::Size: return "size";
    }
    return "unknown";
}

void otaCheck() {
    bool found = ota.checkUpdate();
    bool failed = !found && ota.getError() != AutoOTA::Error::NoUpdates;
    LOGF(failed ? LG_WARN : LG_INFO, "ota", "check result=%s", found ? "update" : otaError());
}

LP_LISTENER_("check_updates", []() {
    otaCheck();
});

// the ticker's first run. A function of its own: inline, its 1.3 KB frame (-Og, one slot per db.init temporary)
// stayed under every web request the ticker serves
static void __attribute__((noinline)) settingsBegin() {
    bool fs = LittleFS.begin();
    db.begin();

    db.init(kk::wifi_ssid, "");
    db.init(kk::wifi_pass, "");
    db.init(kk::show_ip, true);

    db.init(kk::ntp_host, "pool.ntp.org");
    db.init(kk::ntp_gmt, 3);

    db.init(kk::bright, 100);
    db.init(kk::auto_bright, false);
    db.init(kk::bright_min, 10);
    db.init(kk::bright_max, 255);
    db.init(kk::adc_min, 0);
    db.init(kk::adc_max, 1023);

    db.init(kk::night_mode, false);
    db.init(kk::night_mode_auto, false);
    db.init(kk::night_mode_auto_since, 0);
    db.init(kk::night_mode_auto_to, 0);
    db.init(kk::night_color, 0xff0000);
    db.init(kk::night_trsh, 50);

    db.init(kk::clock_style, 1);
    db.init(kk::clock_style_zero, false);
    db.init(kk::clock_color, 0xffffff);

    db.init(kk::back_mode, 1);
    db.init(kk::back_pal, 0);
    db.init(kk::back_bright, 200);
    db.init(kk::back_speed, 50);
    db.init(kk::back_scale, 50);
    db.init(kk::back_angle, 0);

    db.init(kk::kaia_anim, 1);
    db.init(kk::kaia_color, 0x00d1ff);
    db.init(kk::kaia_bright, 255);
    db.init(kk::kaia_night, 1);
    db.init(kk::kaia_wake, 0);
    db.init(kk::kaia_wake_speed, 100);
    db.init(kk::kaia_listen, 0);
    db.init(kk::kaia_think, 0);
    db.init(kk::kaia_speak, 0);
    db.init(kk::kaia_done, 0);
    db.init(kk::kaia_error, 0);
    db.init(kk::kaia_notify, 0);
    db.init(kk::kaia_hide, 1);
    db.init(kk::kaia_hide_out, 600);
    db.init(kk::kaia_hide_in, 1200);
    db.init(kk::kaia_hide_hold, 1000);
    db.init(kk::kaia_hide_keep, 0);
    db.init(kk::page_pass, "");
    db.init(kk::log_host, "");
    db.init(kk::ota_last, "");

    logBegin(db[kk::log_host].toString().c_str());
    if (!fs) LOGF(LG_ERROR, "error", "what=\"LittleFS\"");
    otaBootStore();

    WiFiConnector.connect(db[kk::wifi_ssid], db[kk::wifi_pass]);
    kaiaBegin(sett.server);  // first: its check of /settings set and click goes before the library's handler
    siteBegin(sett.server);
    sett.begin();
    sett.onBuild(build);
    sett.onUpdate(update);
    sett.setPass(db[kk::page_pass].toString());  // empty = no password
    logHttpAttach(sett.server);

    NTP.setHost(db[kk::ntp_host]);
    NTP.setGMT(db[kk::ntp_gmt]);
}

LP_TICKER([]() {
    if (Looper.thisSetup()) settingsBegin();

    WiFiConnector.tick();
    sett.tick();
    logHttpEnd();
    otaBootTick();
    NTP.tick();
});

LP_TIMER(24ul * 60 * 60 * 1000, []() {
    otaCheck();
});

// LP_TIMER(1000, []() {
//     Serial.println(ESP.getFreeHeap());
// });