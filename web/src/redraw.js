// firmware/src/redraw.cpp (the clock under the overlay) and brezline.cpp.
import { blend, i16 } from "./lib8.js";
import { font_3x5_diag, font_4x5, gfx_font_3x5, ledXY } from "./matrix.js";
import { inoise16 } from "./noise.js";
import { getPaletteColor } from "./palettes.js";

// brezline.cpp
export function brezLine(x0, y0, x1, y1, add, ctx, set) {
    let dx = x1 - x0, dy = y1 - y0, sx = 1, sy = 1;
    if (dx < 0) dx = -dx, sx = -1;
    if (dy < 0) dy = -dy, sy = -1;
    const dx2 = dx * 2, dy2 = dy * 2;
    set(x0, y0, ctx);
    if (dx > dy) {
        let err = dy2 - dx;
        while (x0 !== x1) {
            x0 += sx;
            if (err >= 0) {
                y0 += sy;
                err -= dx2;
                if (add) set(x0 - sx, y0, ctx);
            }
            err += dy2;
            set(x0, y0, ctx);
        }
    } else {
        let err = dx2 - dy;
        while (y0 !== y1) {
            y0 += sy;
            if (err >= 0) {
                x0 += sx;
                err -= dy2;
                if (add) set(x0, y0 - sy, ctx);
            }
            err += dx2;
            set(x0, y0, ctx);
        }
    }
}

const DEG_TO_RAD = 0.017453292519943295769236907684886;

// struct GradData: doubles from sqrt / cos / sin, stored in int16 / uint16
export function gradData(x0, y0, w, h, angle) {
    const hypot = Math.trunc(Math.sqrt(w * w + h * h) / 2) & 0xffff;
    const sx = i16(Math.trunc(Math.cos(angle * DEG_TO_RAD) * hypot));
    const sy = i16(Math.trunc(Math.sin(angle * DEG_TO_RAD) * hypot));
    return { cx: i16(x0 + ((w / 2) | 0)), cy: i16(y0 + ((h / 2) | 0)), sx, sy, i: 0, len: Math.trunc(Math.sqrt(sx * sx + sy * sy) * 2) & 0xffff, pal: 0, bright: 0, scale: 0, count: 0 };
}

// applyBright: Arduino map() in long, then constrain
export function brightNow(S, light) {
    if (!S.auto_bright) return S.bright & 255;
    if (S.adc_min === S.adc_max) return ((S.bright_min + S.bright_max) / 2) | 0;
    const b = (((light - S.adc_min) * (S.bright_max - S.bright_min)) / (S.adc_max - S.adc_min) | 0) + S.bright_min;
    return b < 0 ? 0 : b > 255 ? 255 : b;
}

// isTimeBetween + isNight; light = photo.getFilt()
export function isTimeBetween(ch, cm, sh, sm, eh, em) {
    const c = ch * 60 + cm, s = sh * 60 + sm, e = eh * 60 + em;
    return s < e ? c >= s && c < e : c >= s || c < e;
}

export function isNight(S, light, hour, minute) {
    if (!S.night_mode || light >= S.night_trsh) return false;
    if (!S.night_mode_auto) return true;
    const a = S.night_mode_auto_since, b = S.night_mode_auto_to;
    return isTimeBetween(hour, minute, ((a / 3600) | 0) % 24, ((a % 3600) / 60) | 0, ((b / 3600) | 0) % 24, ((b % 3600) / 60) | 0);
}

const DOT_FADE_PRD = 100, DOT_ACTIVE_PRD = 400;

// ms: NTP.ms(), the clock's ms within the second
function dots(m, x1, x2, ms) {
    const color = m.getColor24();
    let color1 = m.getXY(x1, 2), color2 = m.getXY(x2, 4);
    if (ms < DOT_FADE_PRD) {
        color1 = blend(color1, color, ((ms * 255) / DOT_FADE_PRD) | 0);
        color2 = blend(color2, color, ((ms * 255) / DOT_FADE_PRD) | 0);
    } else if (ms < DOT_FADE_PRD + DOT_ACTIVE_PRD) {
        color2 = color1 = color;
    } else if (ms <= DOT_ACTIVE_PRD + DOT_FADE_PRD * 2) {
        color1 = blend(color1, color, (((DOT_ACTIVE_PRD + DOT_FADE_PRD * 2 - ms) * 255) / DOT_FADE_PRD) | 0);
        color2 = blend(color2, color, (((DOT_ACTIVE_PRD + DOT_FADE_PRD * 2 - ms) * 255) / DOT_FADE_PRD) | 0);
    }
    m.setXY(x1, 2, color1);
    m.setXY(x2, 4, color2);
}

function drawTime(m, S, t, cursorX, cursorY, dotX, dotY) {
    m.setCursor(cursorX, cursorY);
    if (t.hour < 10) {
        if (S.clock_style_zero) m.print((t.hour / 10) | 0);
        else m.print(" ");
    } else {
        m.print((t.hour / 10) | 0);
    }
    m.setCursor(cursorX + 4, cursorY);
    m.print(t.hour % 10);
    m.setCursor(cursorX + 10, cursorY);
    m.print((t.minute / 10) | 0);
    m.setCursor(cursorX + 14, cursorY);
    m.print(t.minute % 10);
    dots(m, dotX, dotY, t.ms);
}

// t: {synced, hour, minute, ms}
export function drawClock(m, S, t) {
    const font = S.clock_style;
    if (!font) return;
    m.setModeDiag();
    if (!t.synced) {
        m.setFont(gfx_font_3x5);
        m.setCursor(1, 1);
        m.print("--");
        m.setCursor(12, 1);
        m.print("--");
        return;
    }
    switch (font) {
        case 1:
            m.setFont(gfx_font_3x5);
            drawTime(m, S, t, 1, 1, 9, 9);
            break;
        case 2:
            m.setFont(font_3x5_diag);
            drawTime(m, S, t, 1, 1, 9, 9);
            break;
        case 3:
            m.setFont(font_4x5);
            drawTime(m, S, t, 1, 1, 9, 10);
            break;
    }
}

// millis: the clock's millis(); backScale: kaiaBackScale()
export function drawBack(m, S, millis, backScale) {
    const count = (Math.floor(millis / 64) * S.back_speed) >>> 0;
    const pal = S.back_pal & 255, scale = S.back_scale & 255;
    const bright = ((S.back_bright * backScale) / 255) & 255;
    m.setModeXY();
    switch (S.back_mode) {
        case 0:
            m.clear();
            break;
        case 1: {
            const data = gradData(0, 0, m.w, m.h, S.back_angle);
            data.pal = pal;
            data.bright = bright;
            data.count = count;
            data.scale = scale;
            brezLine(data.cx - data.sx, data.cy + data.sy, data.cx + data.sx, data.cy - data.sy, false, data, (x, y, d) => {
                // (uint32_t)i * (0xffff / 64) * scale / len + count * 2, as uint16
                const idx = (Math.floor((d.i * 1023 * d.scale) / d.len) + d.count * 2) & 0xffff;
                const color = getPaletteColor(d.pal, idx, d.bright);
                d.i = (d.i + 1) & 0xffff;
                brezLine(x - d.sy, y - d.sx, x + d.sy, y + d.sx, true, color, (x2, y2, c) => m.setXY(x2, y2, c));
            });
            break;
        }
        case 2:
            for (let y = 0; y < m.h; y++) {
                for (let x = 0; x < m.w; x++) {
                    if (ledXY(x, y) < 0) continue;
                    const col = getPaletteColor(pal, inoise16(x * scale * 64, y * scale * 64, Math.imul(count, 32) >>> 0), bright);
                    m.setXY(x, y, col);
                }
            }
            break;
    }
}
