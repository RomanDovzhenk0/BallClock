// Kaya's look per event (firmware v1.6: KAIA-173's catalog in KAIA-172's layout). Each event has its own setting,
// as kaia_wake has for the wake: kaia_listen, kaia_think, kaia_speak, kaia_done, kaia_error, kaia_notify.
//   0 «Как у стиля»: the style's version (kaia_anim); 1–3: the Рябь, Орбита or Искры version with any style;
//   4–8: the new ones below; 9–14 (v1.8): the versions of styles 4–9 (styles.js); 15–17 (v1.9): the versions of
//   styles 10–12 (nature.js), 18–23 those of styles 13–18 (games.js). Look 0 with style 4 or later plays its version.
//   Which look is which style's version is the table look_style (style_look the other way), so later ids can be
//   appended anywhere: looks 24–27 are catalog C's singles (singles.js, v1.9 part 3), four for each event.
//   The wake keeps its ids (wakes.js: 0–11, 12–14 of v1.6, 15–20 of v1.8, 21–29 and 30–33 of v1.9; wake_style).
// The listening after a wake (and under its end) is the listening's look.
//
// For the firmware: as wakes.js, every function here is meant to be copied line by line into kaia.cpp.
// Integers only inside a frame; "x / y | 0" is C's x / y, "& 255" is (uint8_t), "a >> 3" and "Math.imul(…) >>> 24"
// (hash8) are the uint32_t ones; let / const are int (uint32_t for colours), arrays are static const tables or
// small int arrays on the stack. No floats, no closures.
import {
    A_DONE, A_ERROR, A_LISTENING, A_THINKING, A_WAKE, abs, b_ang, b_dist, ballAt, ballRX, C_VIOLET, C_WHITE,
    dimAll, fr, hash8, imax, imin, lensOf, mix, oct, orbitShot, pict, posMod, put, putb, rippleShot, segDist, shot_ms, shotDraw, sin8,
    smooth, SPARK_LEN, SPARKS, spark, sparksShot, stateDraw, tent, track, tracks, voice, wave,
} from "./kaia.js";
import { MX_LED_AMOUNT } from "./matrix.js";
import { single_ms, SINGLE_NAMES, singleShot, singleState, singleWake } from "./singles.js";
import { fam_ms, STYLE_NAMES, styleShot, styleState } from "./styles.js";
import {
    b_row, b_x, bunnyWake, dawnShot, eyeShot, fireworkShot, h1, heartShot, nameWake, powerOnWake, radarShot, rainShot, spiralShot,
    starsShot, wake_from, wake_ms, wake_style, wakeLength, wakeOf, WAKE_NAMES,
} from "./wakes.js";

// ids and Russian names per event, by anim (A_WAKE … A_NOTIFY); the wake's are wakes.js's; 9–23 are the styles' names,
// 24–27 catalog C's singles
const SN = STYLE_NAMES.slice(4);
export const LOOK_NAMES = [
    WAKE_NAMES,
    ["Как у стиля", "Рябь", "Орбита", "Искры", "Эхо", "Прилив", "Сияние", "Взгляд", "Пузырьки", ...SN, ...SINGLE_NAMES[1]],
    ["Как у стиля", "Рябь", "Орбита", "Искры", "Змейка", "Нейроны", "Песочные часы", "Три точки", "Атом", ...SN, ...SINGLE_NAMES[2]],
    ["Как у стиля", "Рябь", "Орбита", "Искры", "Эквалайзер", "Осциллограф", "Лучи", "Динамики", "Губы", ...SN, ...SINGLE_NAMES[3]],
    ["Как у стиля", "Рябь", "Орбита", "Искры", "Галочка", "Шкала", "Конфетти", "Кольцо", "«ОК»", ...SN, ...SINGLE_NAMES[4]],
    ["Как у стиля", "Рябь", "Орбита", "Искры", "Нет-нет", "Крест", "Сбой", "Сирена", "Отключение", ...SN, ...SINGLE_NAMES[5]],
    ["Как у стиля", "Рябь", "Орбита", "Искры", "«!»", "Тук-тук", "Маяк", "Конверт", "Значок", ...SN, ...SINGLE_NAMES[6]],
];
// looks per event but the wake: 0–27
export const LOOK_COUNT = 28;

// which style each look is the version of (0: none; 1–3 go through stateDraw / shotDraw with the style), by look id
export const look_style = [0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 0, 0, 0, 0];
// and the look of each style's version, by style id (0 for 0–3)
export const style_look = [0, 0, 0, 0, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

// the look an event plays: look 0 with style 4 or later is that style's version (style_look); with 1–3 it stays 0
// (stateDraw and shotDraw take the style)
export function lookOf(style, look) {
    return look || style <= 3 ? look : style_look[style];
}

// the base length of the new one-shots (4–8), ms: done, error, notify
export const look_ms = [
    [1600, 1500, 1800, 1700, 1600],
    [1400, 1600, 1300, 1600, 1500],
    [1500, 1500, 1600, 1700, 1600],
];

// a one-shot's length, ms: look 0 = the style's version, 1–3 that style's version, 4–8 the new ones, 9–23 styles 4–18,
// 24–27 catalog C's singles
export function shotLength(n, look, style) {
    look = lookOf(style, look);
    if (look_style[look]) return fam_ms[look_style[look] - 4][n - A_DONE];
    if (look >= 24) return single_ms[n - A_DONE][look - 24];
    if (look >= 4) return look_ms[n - A_DONE][look - 4];
    return shot_ms[(look ? look : style) - 1][n - A_DONE + 1];
}

// ================= Слушает: (n, t, col, k), k = how far it shows =================
// p = 4·(x − 19), q = 7·(row − 3): the ball from the middle in 1/8 balls

// 4 · Эхо: arcs come in from both sides to the middle; the outer columns keep a faint glow
export function echoListen(n, t, col, k) {
    if (k <= 0) return;
    const ph = t * 76 / 1600 | 0;  // the fronts, 1/8 ball from a point 100 to the side: 24 (the edge) .. 100 (the middle)
    const f1 = 24 + posMod(ph, 76), f2 = 24 + posMod(ph + 38, 76);
    const e1 = (f1 - 24) * (100 - f1) * 210 / 1444 | 0, e2 = (f2 - 24) * (100 - f2) * 210 / 1444 | 0;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const q = 7 * (b_row[i] - 3), dx = 100 - abs(4 * (b_x[i] - 19));
        const dd = dx + (q * q / (2 * dx) | 0);
        let a = imax(tent(dd - f1, 12) * e1 / 255 | 0, tent(dd - f2, 12) * e2 / 255 | 0);
        if (dx <= 40) a += 28;
        put(i, col, a * k / 255 | 0);
    }
}

// 5 · Прилив: water in the bottom rows rises and falls in 4 s, its surface rolls; the crest is whiter
export function tideListen(n, t, col, k) {
    if (k <= 0) return;
    const L = 38 + (wave(t, 64) * 14 / 128 | 0);  // the level, 1/16 row up from the bottom row's foot
    const sp = t * 60 / 1000 | 0;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const s = L + ((sin8((b_x[i] * 14 + sp) & 255) - 128) * 9 / 128 | 0);
        const dp = s - ((6 - b_row[i]) * 16 + 8);  // how deep the ball's centre is under the surface
        if (dp < -10) continue;
        let a = 0, c = col;
        if (dp < 0) {
            a = 40 * (10 + dp) / 10 | 0;
        } else {
            a = 70 + (150 * tent(dp, 28) / 255 | 0);
            c = mix(col, C_WHITE, 100 * tent(dp, 12) / 255 | 0);
        }
        put(i, c, a * k / 255 | 0);
    }
}

// 6 · Сияние: slow curtains of light hang from the top rows and drift
const aur_fall = [255, 215, 150, 70];  // rows 0..3
export function auroraListen(n, t, col, k) {
    if (k <= 0) return;
    const s1 = t * 40 / 1000 | 0, s2 = t * 27 / 1000 | 0;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const r = b_row[i];
        if (r > 3) continue;
        const u = sin8((b_x[i] * 9 + r * 6 + s1) & 255), v = sin8((b_x[i] * 5 - s2 + 64) & 255);
        const a = 40 + (215 * (u * v / 255 | 0) / 255 | 0);
        put(i, mix(col, C_WHITE, 90 * v / 255 | 0), (a * aur_fall[r] / 255 | 0) * k / 255 | 0);
    }
}

// 7 · Взгляд: a soft spot drifts round the display, as if Kaya's attention follows the owner
export function gazeListen(n, t, col, k) {
    if (k <= 0) return;
    const pc = wave(t, 37) * 46 / 128 | 0, qc = wave(t + 900, 61) * 9 / 128 | 0;  // the spot's centre
    const wc = mix(col, C_WHITE, 120);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = oct(4 * (b_x[i] - 19) - pc, 7 * (b_row[i] - 3) - qc);
        if (d >= 26) continue;
        const u = (26 - d) * 255 / 26 | 0;
        put(i, d < 8 ? wc : col, (255 * (u * u / 255 | 0) / 255 | 0) * k / 255 | 0);
    }
}

// 8 · Пузырьки: ten bubbles rise from the bottom and wobble, as if the owner's words go up to Kaya
export const bub_x = [7, 31, 15, 25, 11, 21, 35, 3, 29, 17];  // half-balls across
export function bubblesListen(n, t, col, k) {
    if (k <= 0) return;
    const c = mix(col, C_WHITE, 70);
    for (let j = 0; j < 10; j++) {
        const per = 2200 + (j * 3 % 5) * 260;
        const y = 112 - (posMod(t + j * 470, per) * 128 / per | 0);  // 1/16 row from row 0: 112 (under the plate) .. -16
        const x = bub_x[j] + (wave(t + j * 300, 170) * 2 / 128 | 0);
        const env = ((112 - y) * (y + 16) * 255 / 4096 | 0) * k / 255 | 0;  // 0 at both ends
        const r0 = y >> 4, fy = y & 15, a0 = env * (16 - fy) >> 4;
        putb(ballRX(x, r0), c, a0);
        putb(ballRX(x, r0 + 1), c, env * fy >> 4);
        putb(ballRX(x - 2, r0), col, a0 >> 2);  // a faint rim either side
        putb(ballRX(x + 2, r0), col, a0 >> 2);
    }
}

// ================= Думает: Kaya's colour half violet, as in the 3 styles =================

// 4 · Змейка: a snake runs the rows back and forth (row 0 to the right, row 1 back …), 3.5 s a pass
export function snakeThink(n, t, col, k) {
    if (k <= 0) return;
    const c = mix(col, C_VIOLET, 128), hc = mix(c, C_WHITE, 150);
    const h = posMod(t * 8 / 100 | 0, 280);  // the head on the path, half-balls: 40 a row
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const r = b_row[i], s = r * 40 + ((r & 1) ? 38 - b_x[i] : b_x[i]);
        const d = posMod(h - s, 280);
        let a = 18;
        if (d < 30) {
            const u = (30 - d) * 255 / 30 | 0;
            a = imax(a, u * u / 255 | 0);
        }
        put(i, d < 3 ? hc : c, a * k / 255 | 0);
    }
}

// 5 · Нейроны: every 250 ms a ball fires somewhere and a ring spreads three balls out from it
export function neuronThink(n, t, col, k) {
    if (k <= 0) return;
    const c = mix(col, C_VIOLET, 128), wc = mix(c, C_WHITE, 170);
    const j0 = t / 250 | 0, cp = [0, 0, 0], cq = [0, 0, 0], age = [-1, -1, -1];
    for (let m = 0; m < 3; m++) {
        const j = j0 - m;
        if (j < 0) continue;
        const b = hash8(j) >> 1;
        cp[m] = 4 * (b_x[b] - 19);
        cq[m] = 7 * (b_row[b] - 3);
        age[m] = t - j * 250;
    }
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = 14, cc = c;
        for (let m = 0; m < 3; m++) {
            if (age[m] < 0) continue;
            const d = oct(p - cp[m], q - cq[m]);
            if (age[m] < 120 && d < 5) {
                a = 255;
                cc = wc;
                continue;
            }
            a = imax(a, tent(d - (age[m] * 26 / 750 | 0), 7) * (255 - (age[m] * 255 / 750 | 0)) / 255 | 0);
        }
        put(i, cc, a * k / 255 | 0);
    }
}

// 6 · Песочные часы: sand runs from the top bulb to the bottom one in 2.7 s, then the glass turns over (0.3 s)
export function hourglassThink(n, t, col, k) {
    if (k <= 0) return;
    const c = mix(col, C_VIOLET, 128);
    const ph = posMod(t, 3000), P = smooth(0, 2700, ph), F = smooth(2700, 3000, ph);
    const lv = P * 48 / 255 | 0;  // 1/16 row: how far the top has sunk, how high the heap stands
    const flow = P > 0 && P < 255;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const r = b_row[i], ax = abs(b_x[i] - 19), w = abs(r - 3) * 6 + 1;  // the glass, half-balls each side
        if (ax > w) continue;
        let a = ax >= w - 1 ? 30 : 0;
        if (r < 3) {
            const s = r * 16 + 8 >= lv ? 255 : 0;
            a = imax(a, (s + ((255 - s) * F / 255 | 0)) * 200 / 255 | 0);
        } else if (r > 3) {
            const s = (6 - r) * 16 + 8 <= lv ? 255 : 0;
            a = imax(a, (s * (255 - F) / 255 | 0) * 200 / 255 | 0);
        }
        if (flow && ax <= 1 && r >= 3 && r <= 5 && ((h1[i] + (t / 60 | 0)) & 1)) a = imax(a, 170);
        put(i, c, a * k / 255 | 0);
    }
}

// 7 · Три точки: the «typing» dots in the bottom rows jump one after another, 1.2 s a round
export function dotsThink(n, t, col, k) {
    if (k <= 0) return;
    const c = mix(mix(col, C_VIOLET, 128), C_WHITE, 60), wc = mix(c, C_WHITE, 140);
    const ph = posMod(t, 1200);
    for (let j = 0; j < 3; j++) {
        const x = 11 + 8 * j, b = tent(ph - 200 * j - 180, 180);  // the jump, 0..255
        const up = (150 + (105 * b / 255 | 0)) * k / 255 | 0, cc = b > 128 ? wc : c;
        putb(ballRX(x, 6), c, (150 * (255 - b) / 255 | 0) * k / 255 | 0);
        putb(ballRX(x - 1, 5), cc, up);
        putb(ballRX(x + 1, 5), cc, up);
        putb(ballRX(x, 4), wc, b * k / 255 | 0);
    }
}

// 8 · Атом: three electrons run round three tilted ellipses with short tails; the nucleus throbs
const atom_sh = [-40, 0, 40];  // the tilt: q += sh·p/256
export function atomThink(n, t, col, k) {
    if (k <= 0) return;
    const c = mix(col, C_VIOLET, 128), wc = mix(c, C_WHITE, 150);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        if (b_dist[i] < 5) put(i, wc, (110 + (wave(t, 300) * 50 / 128 | 0)) * k / 255 | 0);
    }
    for (let j = 0; j < 3; j++) {
        const th0 = (t * 256 / (1300 + 200 * j) | 0) + j * 85;
        for (let q2 = 3; q2 >= 0; q2--) {  // the tail first, the head last
            const th = th0 - q2 * 9;
            const p = 56 * (sin8((th + 64) & 255) - 128) / 128 | 0;
            const q = (12 * (sin8(th & 255) - 128) / 128 | 0) + (atom_sh[j] * p / 256 | 0);
            putb(ballAt(p, q), q2 ? c : wc, (255 - q2 * 60) * k / 255 | 0);
        }
    }
}

// ================= Говорит: voice(t), the pseudo-voice of kaia.cpp =================

// 4 · Эквалайзер: 13 bars across the display grow up and down from the middle row with the voice
export function eqSpeak(n, t, col, k) {
    if (k <= 0) return;
    const wc = mix(col, C_WHITE, 150), lvb = [];
    for (let b = 0; b < 13; b++) lvb[b] = voice(t - ((b * 5 + 3) % 13) * 23) * (255 - abs(b - 6) * 20) / 255 | 0;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const dr = abs(b_row[i] - 3), e = lvb[b_x[i] / 3 | 0] - dr * 64;  // > 0: inside the bar
        if (e <= -16) continue;
        put(i, dr && e < 40 ? wc : col, imin(230, (e + 16) * 4) * k / 255 | 0);
    }
}

// 5 · Осциллограф: a wave line along the middle; its height follows the voice, spreading from the centre out
export function scopeSpeak(n, t, col, k) {
    if (k <= 0) return;
    const ph = t * 300 / 1000 | 0, wc = mix(col, C_WHITE, 110);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const amp = voice(t - abs(b_x[i] - 19) * 14) * 19 / 255 | 0;  // 1/8 ball
        const y = amp * (sin8((b_x[i] * 18 - ph) & 255) - 128) / 128 | 0;
        const d = abs(7 * (b_row[i] - 3) - y);
        if (d >= 9) continue;
        put(i, d < 3 ? wc : col, (tent(d, 9) * 240 / 255 | 0) * k / 255 | 0);
    }
}

// 6 · Лучи: 18 rays from the centre along the spark paths; each one's length follows the voice a little later
export function raysSpeak(n, t, col, k) {
    if (k <= 0) return;
    const wc = mix(col, C_WHITE, 160);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        if (b_dist[i] < 4) put(i, wc, 150 * k / 255 | 0);
    }
    for (let s = 0; s < SPARKS; s++) {
        let len = 0;
        while (len < SPARK_LEN && spark[s][len] !== 255) len++;
        const L = voice(t - ((s * 7) % SPARKS) * 17) * len * 16 / 255 | 0;  // the ray, 1/16 ball from the centre
        for (let j = 0; j < len; j++) {  // the path read from its end: centre → rim
            const e = L - j * 16;
            if (e <= 0) break;
            put(spark[s][len - 1 - j], e < 16 ? wc : col, imin(220, e * 14) * k / 255 | 0);
        }
    }
}

// 7 · Динамики: two speakers left and right; their cones push out with the voice (the right one 60 ms later)
export function speakersSpeak(n, t, col, k) {
    if (k <= 0) return;
    const vl = voice(t), vr = voice(t - 60), wc = mix(col, C_WHITE, 140);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const v = b_x[i] < 19 ? vl : vr;
        const d = oct(abs(4 * (b_x[i] - 19)) - 52, 7 * (b_row[i] - 3));  // both speakers at ±52 (6½ balls)
        const r = 10 + (v * 12 / 255 | 0);  // the cone's edge
        let a = d < 22 ? 24 : d < 27 ? 40 : 0, c = col;
        a = imax(a, tent(d - r, 7) * (130 + (v * 125 / 255 | 0)) / 255 | 0);
        if (d < 5) {
            a = 120 + (v * 135 / 255 | 0);
            c = wc;
        }
        put(i, c, a * k / 255 | 0);
    }
}

// 8 · Губы: lips across the middle part as Kaya talks: a line in a pause, open with the voice
export function lipsSpeak(n, t, col, k) {
    if (k <= 0) return;
    const h = 2 + (voice(t) * 17 / 255 | 0);  // how far they part at the middle, 1/8 ball
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19);
        if (abs(p) > 60) continue;
        const dxn = abs(p) * 255 / 60 | 0, H = h * (255 - (dxn * dxn / 255 | 0)) / 255 | 0;
        const e = abs(7 * (b_row[i] - 3)) - H;  // 0 on a lip
        let a = tent(e, 7) * 235 / 255 | 0;
        if (e < 0) a = imax(a, 30);
        put(i, col, a * k / 255 | 0);
    }
}

// ================= Готово: (n, t, du, col), green unless the call gives a colour =================

// 4 · Галочка: a big check is drawn stroke by stroke with a white pen (0.1–0.7 s), flashes and holds; the time steps back
const chk_s1 = [-44, -2, -14, 18], chk_s2 = [-14, 18, 46, -20];  // 1/8 ball: 36 and 71 long
export function checkDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t);
    const L = smooth(100, 700, t) * 107 / 255 | 0;  // the pen along both strokes
    const v1 = imin(256, L * 256 / 36 | 0), v2 = L > 36 ? (L - 36) * 256 / 71 | 0 : -1;
    const tx = v2 < 0 ? -44 + (30 * v1 / 256 | 0) : -14 + (60 * v2 / 256 | 0);  // the pen's tip
    const ty = v2 < 0 ? -2 + (20 * v1 / 256 | 0) : 18 - (38 * v2 / 256 | 0);
    const pen = t > 100 && t < 720, fl = tent(t - 780, 160);
    dimAll(255 - ((190 * smooth(0, 200, t) / 255 | 0) * fo / 255 | 0));
    fr.dg = 255;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let d = v1 > 0 ? segDist(p, q, chk_s1, v1) : 99;
        if (v2 >= 0) d = imin(d, segDist(p, q, chk_s2, v2));
        if (d >= 10) continue;
        const w = pen && oct(p - tx, q - ty) < 9 ? 230 : 200 * fl / 255 | 0;
        put(i, mix(col, C_WHITE, w), imin(255, tent(d, 10) * 3 / 2 | 0) * fo / 255 | 0);
    }
}

// 5 · Шкала: a bar fills the display left to right with a rolling front (0–0.8 s), flashes at 100 % and holds
export function barDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t);
    const F = (smooth(0, 800, t) * 44 / 255 | 0) - 2;  // the front, half-balls
    const fl = tent(t - 900, 180), sp = t * 500 / 1000 | 0;
    const fc = mix(col, C_WHITE, 120), flc = mix(col, C_WHITE, 160 * fl / 255 | 0);
    fr.dg = 153;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const e = F + ((sin8((b_row[i] * 40 + sp) & 255) - 128) * 2 / 128 | 0) - b_x[i];  // > 0: filled
        if (e < 0) continue;
        let a = 120, c = col;
        if (e < 4 && t < 820) {
            a = 255;
            c = fc;
        }
        if (fl) {
            a = imax(a, fl);
            c = flc;
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// 6 · Конфетти: 16 bits of confetti burst from the middle, fly up and out, turn and fall; green, light green, white
const conf_v = [[-60, -40], [-45, -52], [-30, -30], [-18, -48], [-8, -36], [6, -54], [16, -42], [28, -50], [40, -34], [55, -46], [-50, -24], [48, -22], [-24, -58], [22, -60], [-36, -44], [34, -40]];  // 1/8 ball a second
export function confettiDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t);
    const pop = tent(t - 60, 160), pc = mix(col, C_WHITE, 200);
    fr.dg = 153;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        if (pop && b_dist[i] < 10) put(i, pc, pop * (10 - b_dist[i]) / 10 | 0);
    }
    for (let j = 0; j < 16; j++) {
        const c = j % 3 === 0 ? mix(col, C_WHITE, 190) : j % 3 === 1 ? mix(col, C_WHITE, 80) : col;
        for (let q2 = 1; q2 >= 0; q2--) {  // a trail 60 ms behind, then the bit
            const u = t - (j * 3 % 5) * 30 - q2 * 60;
            if (u <= 0) continue;
            const p = conf_v[j][0] * u / 1000 | 0, q = (conf_v[j][1] * u / 1000 | 0) + (32 * (u * u / 1000 | 0) / 1000 | 0);
            putb(ballAt(p, q), c, (q2 ? 70 : 255) * fo / 255 | 0);
            if (!q2 && ((h1[j] + (u / 90 | 0)) & 1)) putb(ballAt(p + 8, q), c, 200 * fo / 255 | 0);  // it turns: two balls, then one
        }
    }
}

// 7 · Кольцо: a ring round the middle closes from 12 o'clock both ways (0–0.6 s), its inside flashes, a wave goes out
export function ringDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t);
    const nt = tracks.len, pr = smooth(0, 600, t) * nt * 128 / 255 | 0;  // how far each arc has run, 1/256 ball
    const fl = tent(t - 700, 220), age = t - 650;
    const r = 160 + (age * 640 / 1000 | 0), fw = age > 0 ? imax(0, 255 - (age * 255 / 700 | 0)) : 0;
    const wc = mix(col, C_WHITE, 160);
    fr.dg = 153;
    for (let m = 0; m < nt; m++) {
        const d = imin(m, nt - m) * 256;  // from 12 o'clock either way
        if (d <= pr) put(track[m], t < 650 && d > pr - 512 ? wc : col, 240 * fo / 255 | 0);
    }
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const l = lensOf(i);
        let a = l >= 2 ? 230 * fl / 255 | 0 : 0;
        if (fw) a = imax(a, (150 * tent(b_dist[i] * 16 - r, 90) / 255 | 0) * fw / 255 | 0);
        if (a) put(i, l >= 2 ? wc : col, a * fo / 255 | 0);
    }
}

// 8 · «ОК»: «OK» is stamped in white with a shock ring, then turns green; the time steps back while it shows
const pict_ok = [0x0c9, 0x12a, 0x12c, 0x12a, 0x0c9];  // 9 wide
export function okDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t);
    dimAll(255 - ((200 * smooth(0, 120, t) / 255 | 0) * fo / 255 | 0));
    fr.dg = 255;
    const r = (t - 80) * 700 / 1000 | 0, fw = t > 80 ? imax(0, 608 - r) * 255 / 608 | 0 : 0;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        if (fw) put(i, col, (140 * tent(b_dist[i] * 16 - r, 80) / 255 | 0) * fw / 255 | 0);
    }
    pict(pict_ok, 9, mix(col, C_WHITE, 255 - smooth(60, 500, t)), smooth(40, 90, t) * fo / 255 | 0, 0);
}

// ================= Ошибка: red unless the call gives a colour =================

// 4 · Нет-нет: a red ring round the middle shakes its head left and right, three times, smaller each time
export function shakeError(n, t, du, col) {
    const fo = smooth(du, du - 300, t);
    const dx = wave(t, 700) * (26 * imax(0, 1100 - t) / 1100 | 0) / 128 | 0;  // the shift, 1/8 ball
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19) - dx, q = 7 * (b_row[i] - 3);
        const e = (p * p * 256 / 1600 | 0) + (q * q * 256 / 400 | 0);  // 256 on the ellipse 5 × 2½ balls
        const a = imax(tent(e - 256, 110), e < 256 ? 50 : 0);
        put(i, col, (a * 240 / 255 | 0) * fo / 255 | 0);
    }
}

// 5 · Крест: a big cross is drawn stroke by stroke (0.1–0.4 s, 0.45–0.75 s), then blinks twice; the time steps back
const crs_s1 = [-30, -20, 30, 20], crs_s2 = [30, -20, -30, 20];  // 1/8 ball
export function crossError(n, t, du, col) {
    const fo = smooth(du, du - 300, t);
    const v1 = smooth(100, 400, t) * 256 / 255 | 0, v2 = t > 450 ? smooth(450, 750, t) * 256 / 255 | 0 : -1;
    const on = t < 850 || (t >= 1000 && t < 1150) || t >= 1300;  // two blinks
    dimAll(255 - ((200 * smooth(0, 150, t) / 255 | 0) * fo / 255 | 0));
    fr.dg = 255;
    if (!on) return;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let d = v1 > 0 ? segDist(p, q, crs_s1, v1) : 99;
        if (v2 > 0) d = imin(d, segDist(p, q, crs_s2, v2));
        if (d >= 10) continue;
        put(i, col, imin(255, tent(d, 10) * 3 / 2 | 0) * fo / 255 | 0);
    }
}

// 6 · Сбой: the display glitches for 1 s: rows tear in bursts of 70 ms, some frames flash, the time flickers out
export function glitchError(n, t, du, col) {
    const fo = smooth(du, du - 300, t);
    const busy = t < 1000, sl = t / 70 | 0, hs = hash8(sl * 7 + 3);
    if (busy && !(hs & 3)) dimAll(60);
    fr.dg = 200;
    const wc = mix(col, C_WHITE, 170), hr = [0, 0, 0, 0, 0, 0, 0];
    for (let r = 0; r < 7; r++) hr[r] = hash8(sl * 13 + r * 7 + 1);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const h = hr[b_row[i]], x0 = h * 5 % 38, x = b_x[i];
        let a = busy ? 0 : 90, c = col;
        if (busy && h < 120 && x >= x0 && x < x0 + 6 + (h & 15)) {
            a = 230;
            if (h & 1) c = wc;
        }
        if (busy && hs < 30) a = imax(a, 140);
        put(i, c, a * fo / 255 | 0);
    }
}

// 7 · Сирена: two beams 180° apart turn round the middle, 2½ turns in 1.6 s; one red, one whitish; a lamp in the middle
export function sirenError(n, t, du, col) {
    const fo = smooth(du, du - 300, t);
    const th = t * 400 / 1000 | 0;  // the beams' angle, 256 a turn
    const wc = mix(col, C_WHITE, 150);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i], da = abs(((b_ang[i] - th + 128) & 255) - 128);  // 0..128 from beam A
        const a1 = tent(da, 30), a2 = tent(128 - da, 30);
        let a = imax(a1, a2) * (150 + (105 * d / 38 | 0)) / 255 | 0, c = a2 > a1 ? wc : col;
        if (d < 5) {
            a = 200 + (wave(t, 800) * 55 / 128 | 0);
            c = col;
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// 8 · Отключение: like an old TV switched off: a red flash, the picture squeezes into a line, the line into a dot, out
export function powerOffError(n, t, du, col) {
    dimAll(255 - ((225 * smooth(0, 120, t) / 255 | 0) * smooth(du, du - 300, t) / 255 | 0));
    fr.dg = 255;
    const hv = 56 - (smooth(150, 550, t) * 56 / 255 | 0);  // half the picture's height, 1/16 row
    const hw = 20 - (smooth(550, 900, t) * 20 / 255 | 0);  // half the line's length, half-balls
    const wc = mix(col, C_WHITE, 180);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const dv = abs(b_row[i] - 3) * 16, dh = abs(b_x[i] - 19);
        let a = 0, c = col;
        if (t < 150) {
            a = 230 * smooth(0, 60, t) / 255 | 0;
        } else if (t < 550) {
            a = dv <= hv ? 230 : dv < hv + 16 ? 230 * (hv + 16 - dv) / 16 | 0 : 0;
            c = mix(col, C_WHITE, 150 * smooth(150, 550, t) / 255 | 0);
        } else if (t < 900) {
            if (!dv && dh <= hw + 1) a = 240;
            c = wc;
        } else if (b_dist[i] < 3) {
            a = 255 - smooth(950, 1300, t);
            c = mix(col, C_WHITE, 200 * a / 255 | 0);
        }
        put(i, c, a);
    }
}

// ================= Уведомление: amber unless the call gives a colour =================

// 4 · «!»: a big «!» in the middle columns blinks three times, each blink starting white; the side columns flash with it
export function bangNotify(n, t, du, col) {
    const fo = smooth(du, du - 300, t);
    const ph = t % 350, on = t >= 1050 || ph < 240;  // three blinks, then it stays
    const wh = t < 1050 ? tent(ph - 40, 80) : 0;
    const c = mix(col, C_WHITE, 200 * wh / 255 | 0);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const r = b_row[i], ax = abs(b_x[i] - 19);
        let a = 0;
        if (on && (r < 3 ? ax <= 2 : r === 3 ? ax <= 1 : r === 5 ? ax === 1 : r === 6 && !ax)) a = 255;
        if (ax >= 16) a = imax(a, 200 * wh / 255 | 0);
        put(i, c, a * fo / 255 | 0);
    }
}

// 5 · Тук-тук: two knocks, a pause, two knocks: each one flashes the bottom row and sends an arc up from under it
const knock_t = [0, 180, 620, 800];
export function knockNotify(n, t, du, col) {
    const fo = smooth(du, du - 300, t);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const q = 7 * (b_row[i] - 3), d = oct(4 * (b_x[i] - 19), 28 - q);  // from a point under the bottom edge
        let a = 0;
        for (let j = 0; j < 4; j++) {
            const age = t - knock_t[j];
            if (age < 0 || age >= 600) continue;
            const pk = j & 1 ? 255 : 210;
            a = imax(a, (tent(d - (age * 80 / 600 | 0), 10) * (600 - age) / 600 | 0) * pk / 255 | 0);
            if (b_row[i] === 6) a = imax(a, tent(age - 30, 90));
        }
        put(i, col, a * fo / 255 | 0);
    }
}

// 6 · Маяк: a lighthouse beam from under the bottom edge sweeps left to right; it flashes the display as it faces you
export function beaconNotify(n, t, du, col) {
    const g = smooth(0, 150, t) * smooth(du, du - 300, t) / 255 | 0;
    const phi = -43 + (smooth(100, 1400, t) * 86 / 255 | 0);  // from straight up, 256 a turn: −60° .. +60°
    const sx = sin8(phi & 255) - 128, cy = sin8((phi + 64) & 255) - 128;
    const fl = tent(phi, 8) * 150 / 255 | 0, wc = mix(col, C_WHITE, 120);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const dx = 4 * (b_x[i] - 19), dy = 40 - 7 * (b_row[i] - 3);  // from the lamp, 5 balls under the middle
        const al = dx * sx + dy * cy, cr = abs(dx * cy - dy * sx);
        const a = imax(al > 0 ? tent(cr * 256 / al | 0, 80) : 0, fl);
        put(i, a > 200 ? wc : col, a * g / 255 | 0);
    }
}

// 7 · Конверт: an envelope slides in from the left (0–0.5 s), settles, its flap flashes white; the time steps back
const pict_mail = [0x1ff, 0x183, 0x145, 0x129, 0x1ff], pict_flap = [0, 0x082, 0x044, 0x028, 0];  // 9 wide
export function mailNotify(n, t, du, col) {
    const fo = smooth(du, du - 300, t);
    dimAll(255 - ((190 * smooth(0, 200, t) / 255 | 0) * fo / 255 | 0));
    fr.dg = 255;
    const dx = -15 + (smooth(0, 500, t) * 16 / 255 | 0) - (smooth(520, 680, t) > 127 ? 1 : 0);
    if (t < 500) pict(pict_mail, 9, col, 90 * fo / 255 | 0, dx - 1);  // the blur behind it
    pict(pict_mail, 9, col, fo, dx);
    pict(pict_flap, 9, C_WHITE, tent(t - 850, 150) * fo / 255 | 0, dx);
}

// 8 · Значок: a badge drops into the top right corner, bounces, pings twice and stays lit, as on a phone's icon
export function badgeNotify(n, t, du, col) {
    const fo = smooth(du, du - 300, t);
    let y = -18;  // the badge's centre, 1/8 ball
    if (t < 300) y = -50 + (32 * (t * t / 300 | 0) / 300 | 0);
    else if (t < 500) y = -18 - (8 * (10000 - (t - 400) * (t - 400)) / 10000 | 0);
    const wc = mix(col, C_WHITE, 140);
    fr.dg = 153;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = oct(4 * (b_x[i] - 19) - 56, 7 * (b_row[i] - 3) - y);
        let a = d < 11 ? 255 : d < 15 ? 255 * (15 - d) / 4 | 0 : 0;
        for (let j = 0; j < 2; j++) {  // the pings at 550 and 950 ms
            const age = t - 550 - 400 * j;
            if (age > 0 && age < 600) a = imax(a, (tent(d - 12 - (age * 40 / 600 | 0), 6) * (600 - age) / 600 | 0) * 200 / 255 | 0);
        }
        put(i, d < 6 ? wc : col, a * fo / 255 | 0);
    }
}

// ================= the event in its look =================

// a state in its look; style: kaia_anim (1–18), look: the event's setting, k: how far it shows (255 = all)
export function stateLook(style, look, n, t, col, k) {
    look = lookOf(style, look);
    if (look < 4) {
        stateDraw(look ? look : style, n, t, col, k);
        return;
    }
    if (look_style[look]) {
        styleState(look_style[look], n, t, col, k);
        return;
    }
    if (look >= 24) {
        singleState(look, n, t, col, k);
        return;
    }
    if (n === A_LISTENING) {
        switch (look) {
            case 4: echoListen(n, t, col, k); break;
            case 5: tideListen(n, t, col, k); break;
            case 6: auroraListen(n, t, col, k); break;
            case 7: gazeListen(n, t, col, k); break;
            default: bubblesListen(n, t, col, k); break;
        }
    } else if (n === A_THINKING) {
        switch (look) {
            case 4: snakeThink(n, t, col, k); break;
            case 5: neuronThink(n, t, col, k); break;
            case 6: hourglassThink(n, t, col, k); break;
            case 7: dotsThink(n, t, col, k); break;
            default: atomThink(n, t, col, k); break;
        }
    } else {
        switch (look) {
            case 4: eqSpeak(n, t, col, k); break;
            case 5: scopeSpeak(n, t, col, k); break;
            case 6: raysSpeak(n, t, col, k); break;
            case 7: speakersSpeak(n, t, col, k); break;
            default: lipsSpeak(n, t, col, k); break;
        }
    }
}

// a one-shot (done, error, notify) in its look, t = 0 .. shotLength
export function shotLook(style, look, n, t, col) {
    const du = shotLength(n, look, style);
    look = lookOf(style, look);
    if (look < 4) {
        shotDraw(look ? look : style, n, t, du, col);
        return;
    }
    if (look_style[look]) {
        styleShot(look_style[look], n, t, du, col);
        return;
    }
    if (look >= 24) {
        singleShot(look, n, t, du, col);
        return;
    }
    if (n === A_DONE) {
        switch (look) {
            case 4: checkDone(n, t, du, col); break;
            case 5: barDone(n, t, du, col); break;
            case 6: confettiDone(n, t, du, col); break;
            case 7: ringDone(n, t, du, col); break;
            default: okDone(n, t, du, col); break;
        }
    } else if (n === A_ERROR) {
        switch (look) {
            case 4: shakeError(n, t, du, col); break;
            case 5: crossError(n, t, du, col); break;
            case 6: glitchError(n, t, du, col); break;
            case 7: sirenError(n, t, du, col); break;
            default: powerOffError(n, t, du, col); break;
        }
    } else {
        switch (look) {
            case 4: bangNotify(n, t, du, col); break;
            case 5: knockNotify(n, t, du, col); break;
            case 6: beaconNotify(n, t, du, col); break;
            case 7: mailNotify(n, t, du, col); break;
            default: badgeNotify(n, t, du, col); break;
        }
    }
}

// the wake with its speed (v1.5's wakeDraw, the listening now in its look)
// t: ms since the wake started (real time); style: kaia_anim (1–18); wake: kaia_wake (0 = the style's: wakeOf);
// lk: kaia_listen, the look of the listening that fades in under the wake and goes on after it
export function wakeDraw(style, wake, lk, speed, t, col) {
    const id = wakeOf(style, wake);
    const du = wake_ms[id];
    let u = t * speed / 100 | 0;  // the wake's own time
    if (u > du) u = du;
    fr.lt = t - wakeLength(id, speed);  // the listening's time: it goes on at its own pace after the wake
    fr.ls = lk >= 4 ? 0 : lk ? lk : style <= 3 ? style : 0;  // the listening's style (0: a new look or a new style)

    if (wake_style[id]) styleShot(wake_style[id], A_WAKE, u, du, col);
    else if (id >= 30) singleWake(id, A_WAKE, u, du, col);
    else switch (id) {
        case 1: rippleShot(A_WAKE, u, du, col); break;
        case 2: orbitShot(A_WAKE, u, du, col); break;
        case 3: sparksShot(A_WAKE, u, du, col); break;
        case 4: dawnShot(A_WAKE, u, du, col); break;
        case 5: radarShot(A_WAKE, u, du, col); break;
        case 6: spiralShot(A_WAKE, u, du, col); break;
        case 7: heartShot(A_WAKE, u, du, col); break;
        case 8: eyeShot(A_WAKE, u, du, col); break;
        case 9: starsShot(A_WAKE, u, du, col); break;
        case 10: fireworkShot(A_WAKE, u, du, col); break;
        case 11: rainShot(A_WAKE, u, du, col); break;
        case 12: powerOnWake(A_WAKE, u, du, col); break;
        case 13: bunnyWake(A_WAKE, u, du, col); break;
        default: nameWake(A_WAKE, u, du, col); break;
    }

    if (id <= 3) {
        // the sparks mark settles into its own breath; any other pair fades the listening in
        if (!(id === 3 && fr.ls === 3)) stateLook(style, lk, A_LISTENING, fr.lt, col, smooth(wake_from[id], du, u));
    } else {
        fr.dg = 89;
        stateLook(style, lk, A_LISTENING, fr.lt, col, smooth(du - 800, du, u));
    }
}
