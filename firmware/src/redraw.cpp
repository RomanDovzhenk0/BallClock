#include "redraw.h"

#include <Arduino.h>
#include <FastLED.h>
#include <GyverNTP.h>
#include <Looper.h>

#include "brezline.h"
#include "config.h"
#include "font_3x5_diag.h"
#include "font_4x5.h"
#include "matrix.h"
#include "palettes.h"
#include "settings.h"

ADCFilt photo(PHOTO_PIN, 14);

struct GradData {
    GradData(int x0, int y0, int w, int h, int angle) {
        uint16_t hypot = sqrt(w * w + h * h) / 2;
        cx = x0 + w / 2;
        cy = y0 + h / 2;
        sx = cos(radians(angle)) * hypot;
        sy = sin(radians(angle)) * hypot;
        len = sqrt(sx * sx + sy * sy) * 2;
    }

    int16_t cx, cy;
    int16_t sx, sy;
    uint16_t i = 0, len;
    uint8_t pal;
    uint8_t bright;
    uint8_t scale;
    uint32_t count;
};

static void applyBright() {
    if (db[kk::auto_bright]) {
        int adc_min = db[kk::adc_min];
        int adc_max = db[kk::adc_max];

        if (adc_min == adc_max) {  // div 0
            matrix.setBright(((int)db[kk::bright_min] + (int)db[kk::bright_max]) / 2);
        } else {
            int bright = map(photo.getFilt(), adc_min, adc_max, db[kk::bright_min], db[kk::bright_max]);
            matrix.setBright(constrain(bright, 0, 255));
        }
    } else {
        matrix.setBright(db[kk::bright]);
    }
}

#define DOT_FADE_PRD 100
#define DOT_ACTIVE_PRD 400

static void dots(int x1, int x2) {
    uint32_t color = matrix.getColor24();
    uint32_t color1 = matrix.getLED(x1, 2);
    uint32_t color2 = matrix.getLED(x2, 4);
    uint16_t ms = NTP.ms();

    switch (ms) {
        case 0 ... DOT_FADE_PRD - 1:
            color1 = (uint32_t)blend(color1, color, ms * 255 / DOT_FADE_PRD);
            color2 = (uint32_t)blend(color2, color, ms * 255 / DOT_FADE_PRD);
            break;

        case DOT_FADE_PRD ... DOT_FADE_PRD + DOT_ACTIVE_PRD - 1:
            color2 = color1 = color;
            break;

        case DOT_FADE_PRD + DOT_ACTIVE_PRD... DOT_ACTIVE_PRD + DOT_FADE_PRD * 2:
            color1 = (uint32_t)blend(color1, color, (DOT_ACTIVE_PRD + DOT_FADE_PRD * 2 - ms) * 255 / DOT_FADE_PRD);
            color2 = (uint32_t)blend(color2, color, (DOT_ACTIVE_PRD + DOT_FADE_PRD * 2 - ms) * 255 / DOT_FADE_PRD);
            break;

        default:
            break;
    }

    matrix.setLED(x1, 2, color1);
    matrix.setLED(x2, 4, color2);
}

static void drawTime(Datime& dt, int font, int cursorX, int cursorY, int dotX, int dotY) {
    matrix.setCursor(cursorX, cursorY);
    if (dt.hour < 10) {
        if (db[kk::clock_style_zero]) {
            matrix.print(dt.hour / 10);
        }
        else {
            matrix.print(" ");
        }
    }
    else {
        matrix.print(dt.hour / 10);
    }
    
    matrix.setCursor(cursorX + 4, cursorY);
    matrix.print(dt.hour % 10);

    matrix.setCursor(cursorX + 10, cursorY);
    matrix.print(dt.minute / 10);

    matrix.setCursor(cursorX + 14, cursorY);
    matrix.print(dt.minute % 10);

    dots(dotX, dotY);
}

static void drawClock() {
    uint8_t font = db[kk::clock_style].toInt();
    if (!font) return;

    matrix.setModeDiag();

    if (!NTP.synced()) {
        matrix.setFont(gfx_font_3x5);
        matrix.setCursor(1, 1);
        matrix.print("--");
        matrix.setCursor(12, 1);
        matrix.print("--");
        return;
    }

    Datime dt(NTP);

    switch (font) {
        case 1:
            matrix.setFont(gfx_font_3x5);
            drawTime(dt, font, 1, 1, 9, 9);
            break;

        case 2:
            matrix.setFont(font_3x5_diag);
            drawTime(dt, font, 1, 1, 9, 9);
            break;

        case 3:
            matrix.setFont(font_4x5);
            drawTime(dt, font, 1, 1, 9, 10);
            break;
    }
}

static void drawBack() {
    uint32_t count = (millis() / 64) * db[kk::back_speed].toInt();
    uint8_t pal = db[kk::back_pal];
    uint8_t scale = db[kk::back_scale];
    uint8_t bright = db[kk::back_bright];

    matrix.setModeXY();

    switch (db[kk::back_mode].toInt()) {
        // none
        case 0:
            matrix.clear();
            break;

        // grad
        case 1: {
            GradData data(0, 0, matrix.width(), matrix.height(), db[kk::back_angle]);
            data.pal = pal;
            data.bright = bright;
            data.count = count;
            data.scale = scale;

            brezLine(data.cx - data.sx, data.cy + data.sy, data.cx + data.sx, data.cy - data.sy, false, &data, [](int x, int y, void* vdata) {
                GradData& data = *((GradData*)vdata);
                uint32_t color = getPaletteColor(data.pal, (uint32_t)data.i * (0xffff / 64) * data.scale / data.len + data.count * 2, data.bright);
                data.i++;

                brezLine(x - data.sy, y - data.sx, x + data.sy, y + data.sx, true, &color, [](int x, int y, void* color) {
                    matrix.setLED(x, y, *((uint32_t*)color));
                });
            });
        } break;

        // perlin
        case 2:
            for (int y = 0; y < matrix.height(); y++) {
                for (int x = 0; x < matrix.width(); x++) {
                    if (matrix.ledXY(x, y) < 0) continue;
                    uint32_t col = getPaletteColor(pal, inoise16(x * scale * 64, y * scale * 64, count * 32), bright);
                    matrix.setLED(x, y, col);
                }
            }
            break;
    }
}

bool isTimeBetween(int currentHour, int currentMinute, int startHour, int startMinute, int endHour, int endMinute) {
    // Преобразуем всё в минуты с начала суток
    int currentTime = currentHour * 60 + currentMinute;
    int startTime = startHour * 60 + startMinute;
    int endTime = endHour * 60 + endMinute;

    // Если диапазон времени не переходит через полночь
    if (startTime < endTime) {
        return (currentTime >= startTime && currentTime < endTime);
    }
    // Если диапазон времени переходит через полночь
    else {
        return (currentTime >= startTime || currentTime < endTime);
    }
}

LP_TIMER_("redraw", 50, []() {
    Looper.thisTimer()->restart(50);
    
    applyBright();

    if (db[kk::night_mode] && photo.getFilt() < db[kk::night_trsh].toInt()) {
        if (db[kk::night_mode_auto]) {
            Datime dt(NTP);

            // Получаем время начала и конца авто ночного режима в секундах
            long startTimeSeconds = db[kk::night_mode_auto_since].toInt();
            long endTimeSeconds = db[kk::night_mode_auto_to].toInt();

            // Преобразуем время в секунды в часы и минуты
            int startHour = (startTimeSeconds / 3600) % 24; // 3600 секунд в часе
            int startMinute = (startTimeSeconds % 3600) / 60; // остаток от часов делим на 60
            int endHour = (endTimeSeconds / 3600) % 24;
            int endMinute = (endTimeSeconds % 3600) / 60;

            if (isTimeBetween(dt.hour, dt.minute, startHour, startMinute, endHour, endMinute)) {
                // Время находится в диапазоне, включаем ночной режим
                matrix.clear();
                matrix.setColor24(db[kk::night_color]);
                drawClock();
            } else {
                // Время вне диапазона, обычный режим
                drawBack();
                matrix.setColor24(db[kk::clock_color]);
                drawClock();
            }
        } else {
            matrix.clear();
            matrix.setColor24(db[kk::night_color]);
            drawClock();    
        }
    } else {
        drawBack();
        matrix.setColor24(db[kk::clock_color]);
        drawClock();
    }

    matrix.update();
});