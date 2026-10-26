// Kaya's wakes for firmware v1.5 (the KAIA-161 design): kaia_wake picks one apart from the style.
//   0 «Как у стиля»: the style's own wake (1 ripple, 2 orbit, 3 sparks); 1–3 those three with any style;
//   4 and up: the new ones below.
// kaia_wake_speed (50–200 %): the wake runs on u = t·speed/100 and lasts du·100/speed; the listening of the
// style that fades in under it, and that takes over after it, keeps real time.
//
// For the firmware: every function here is meant to be copied line by line into kaia.cpp.
// Integers only inside a frame; "x / y | 0" is C's x / y (and valid C++ as it is), "& 255" is (uint8_t),
// let / const are int (uint32_t for colours), arrays are static const tables. No floats, no closures.
import {
    A_LISTENING, A_WAKE, b_ang, b_dist, C_WHITE, dimAll, fr, imax, imin, lensOf, mix, orbitShot, pict, put,
    rippleShot, smooth, SPARK_LEN, SPARKS, spark, sparksShot, stateDraw, tent, abs,
} from "./kaia.js";
import { ledDiag, MX_DIAG_H, MX_DIAG_W, MX_LED_AMOUNT } from "./matrix.js";

// ids and Russian names in the site's order; base lengths at 100 %, ms (1–3 = shot_ms[style - 1][0])
export const WAKE_NAMES = ["Как у стиля", "Рябь", "Орбита", "Искры", "Рассвет", "Радар", "Спираль", "Сердцебиение", "Глаз", "Звёзды", "Салют", "Дождь"];
export const wake_ms = [0, 1900, 2000, 2000, 2000, 1800, 2000, 1900, 2200, 2000, 2200, 2000];
export const WAKE_COUNT = 12;
// when the listening starts to fade in under wakes 1–3 (the new ones: du - 800)
const wake_from = [0, 1100, 1500, 1600];

// ================= boot tables for the new wakes (one byte a ball) =================

export const b_col = new Uint8Array(MX_LED_AMOUNT);  // x in the diagonal grid, 0..19
export const b_row = new Uint8Array(MX_LED_AMOUNT);  // y, 0 (top) .. 6
export const b_x = new Uint8Array(MX_LED_AMOUNT);    // x across in half-balls: 2·col + 3 − row, 0..38 (19 = the middle)
export const h1 = new Uint8Array(MX_LED_AMOUNT), h2 = new Uint8Array(MX_LED_AMOUNT), h3 = new Uint8Array(MX_LED_AMOUNT);  // a hash of the ball

export function buildWakeTables() {
    for (let y = 0; y < MX_DIAG_H; y++) {
        for (let x = 0; x < MX_DIAG_W; x++) {
            const i = ledDiag(x, y);
            if (i < 0) continue;
            b_col[i] = x;
            b_row[i] = y;
            b_x[i] = 2 * x + 3 - y;
        }
    }
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        // (uint32_t)(i + 1) * 2654435761u >> 24 …
        h1[i] = Math.imul(i + 1, 2654435761) >>> 24;
        h2[i] = Math.imul(i + 1, 2246822519) >>> 24;
        h3[i] = Math.imul(i + 1, 3266489917) >>> 24;
    }
}

export const pict_heart = [0x36, 0x7f, 0x7f, 0x3e, 0x08];  // 7 wide

// ================= the new wakes: (n, t, du, col), t = the wake's own time, 0 .. du =================
// Each fades itself out over its last 400 ms (fo); wakeDraw fades the style's listening in over the last 800.

// 4 · Рассвет: the dawn rises from the bottom row to the top, whiter at its edge, brighter in the middle
export function dawnShot(n, t, du, col) {
    const fo = smooth(du, du - 400, t);
    const F = smooth(0, 1500, t) * 140 / 255 | 0;  // the edge, 1/16 row up from the bottom
    fr.dg = 115;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const dp = F - (6 - b_row[i]) * 16;
        if (dp < -24) continue;
        let a = 0, c = col;
        if (dp < 0) {
            a = 90 * (24 + dp) / 24 | 0;  // the glow above the edge
        } else {
            a = 70 + (185 * imax(0, 96 - dp) / 96 | 0);
            const side = 255 - abs(b_x[i] - 19) * 4;
            a = a * (190 + (65 * side / 255 | 0)) / 255 | 0;
            c = mix(col, C_WHITE, 140 * imax(0, 48 - dp) / 48 | 0);
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// 5 · Радар: one beam turn clockwise from 12 o'clock with a trail; some balls light up as blips
export function radarShot(n, t, du, col) {
    const fo = smooth(du, du - 400, t);
    const th = t * 256 / 1400 | 0;  // the beam's angle, 0..256 a turn
    const hub = t < 400 ? tent(t - 100, 300) : 0;
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const dl = th - b_ang[i], d = b_dist[i];
        let a = 0, c = col;
        if (dl >= 0) {
            if (dl < 96) {
                const x = (96 - dl) * 255 / 96 | 0;
                a = x * x / 255 | 0;
            }
            if (h1[i] < 34 && dl < 150) {
                a = imax(a, 215 * (150 - dl) / 150 | 0);
                c = mix(col, C_WHITE, 160);
            }
            a = a * (150 + (105 * d / 38 | 0)) / 255 | 0;
            if (dl < 12) c = mix(col, C_WHITE, (12 - dl) * 200 / 12 | 0);
        }
        if (hub && d < 10) a = imax(a, hub * (10 - d) / 10 | 0);
        put(i, c, a * fo / 255 | 0);
    }
}

// 6 · Спираль: two arms unwind from the centre to the rim and turn
export function spiralShot(n, t, du, col) {
    const fo = smooth(du, du - 400, t);
    const R = smooth(0, 1250, t) * 46 / 255 | 0;  // the front, quarter-balls
    const rho = t * 256 / 1700 | 0;
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i];
        if (d > R) continue;
        const v = (b_ang[i] * 2 + d * 7 - rho) & 255, dd = imin(v, 256 - v);
        let a = tent(dd, 56);
        if (d < 9 && t < 500) a = imax(a, tent(t - 150, 350) * (9 - d) / 9 | 0);
        if (!a) continue;
        a = a * (255 - d * 3) / 255 | 0;
        const hd = R - d;
        put(i, hd < 7 ? mix(col, C_WHITE, (7 - hd) * 30) : col, a * fo / 255 | 0);
    }
}

// 7 · Сердцебиение: a 7×5 heart beats twice (lub-dub) with the rest dimmed, the time hidden on purpose
export function heartShot(n, t, du, col) {
    const fo = smooth(du, du - 400, t);
    let env = 0;
    for (let k = 0; k < 2; k++) {  // the beats at 150 and 540 ms
        const q = t - (k ? 540 : 150), pk = k ? 190 : 255;
        const b = q < 0 ? 0 : q < 90 ? pk * q / 90 | 0 : imax(0, pk - (pk * (q - 90) / 380 | 0));
        env = imax(env, b);
    }
    const hide = smooth(0, 140, t) * fo / 255 | 0;
    dimAll(255 - (200 * hide / 255 | 0));
    fr.dg = 255;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        if (lensOf(i) === 1) put(i, col, (70 * env / 255 | 0) * hide / 255 | 0);
    }
    pict(pict_heart, 7, mix(col, C_WHITE, 110 * env / 255 | 0), (60 + (195 * env / 255 | 0)) * hide / 255 | 0, 0);
}

// 8 · Глаз: a slit along the middle row opens into an eye; the pupil looks left, right and back; a blink
export function eyeShot(n, t, du, col) {
    const fo = smooth(du, du - 400, t);
    const o = smooth(250, 950, t) * (255 - (215 * smooth(1750, 1980, t) / 255 | 0)) / 255 | 0;  // how open
    const w = smooth(0, 250, t) * 17 / 255 | 0;  // the slit's half-length, half-balls
    const hd = smooth(0, 300, t) * fo / 255 | 0;
    dimAll(255 - (170 * hd / 255 | 0));
    fr.dg = 89;
    // the pupil's offset in quarter half-balls: 0 → -5 → +5 → 0
    const off = (-20 * smooth(1000, 1200, t) + 40 * smooth(1250, 1450, t) - 20 * smooth(1500, 1700, t)) / 255 | 0;
    const pk = smooth(550, 850, t);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const ax = abs(b_x[i] - 19), dr = b_row[i] - 3;
        let a = 0, c = col;
        if (ax <= w) {
            const dxn = ax * 255 / 17 | 0;
            const H = o * (255 - (dxn * dxn / 255 | 0)) / 255 | 0, mg = H - abs(dr) * 85;
            if (mg >= 0) a = 45;  // the white
            a = imax(a, 230 * tent(mg, 64) / 255 | 0);  // the lid
        }
        if (o > 110 && pk) {
            const px = 4 * (b_x[i] - 19) - off, d2 = px * px + 49 * dr * dr;
            if (d2 < 340) {
                const pa = d2 <= 169 ? 255 : (340 - d2) * 255 / 171 | 0, core = imax(0, (110 - d2) * 255 / 110 | 0);
                if (pa > a || core) {
                    a = imax(a, pa * pk / 255 | 0);
                    c = mix(col, C_WHITE, 60 + (150 * core / 255 | 0));
                }
            }
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// 9 · Звёзды: stars twinkle denser and denser, then one flash from the centre
export function starsShot(n, t, du, col) {
    const fo = smooth(du, du - 400, t);
    const dth = (smooth(0, 1250, t) * 240 / 255 | 0) + 10;
    const fl = t > 1300 ? tent(t - 1500, 200) : 0;
    fr.dg = 140;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        let a = 0, c = mix(col, C_WHITE, (h1[i] & 1) ? 150 : 60);
        if (h1[i] < dth) {
            const ph = (h2[i] + (t * (220 + (h3[i] & 63)) / 1000 | 0)) & 255, s = 255 - abs(ph - 128) * 2;
            a = s * s / 255 | 0;
        }
        if (fl) {
            const fl2 = fl * (255 - b_dist[i] * 3) / 255 | 0;
            if (fl2 > a) {
                a = fl2;
                c = mix(col, C_WHITE, 210);
            }
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// 10 · Салют: a rocket up the middle column to the centre, a burst along the 18 spark paths, then glitter
export function fireworkShot(n, t, du, col) {
    const fo = smooth(du, du - 400, t);
    const trail = [255, 153, 77, 31];
    fr.dg = 115;
    if (t < 780) {
        const hr = 96 - (smooth(0, 720, t) * 48 / 255 | 0);  // the head, 1/16 row
        for (let i = 0; i < MX_LED_AMOUNT; i++) {
            if (abs(b_x[i] - 19) > 1) continue;
            const df = b_row[i] * 16 - hr;
            if (df < -8 || df > 48) continue;
            const a = df < 8 ? 255 : (48 - df) * 255 / 48 | 0;
            put(i, df < 8 ? mix(col, C_WHITE, 170) : col, (a * a / 255 | 0) * fo / 255 | 0);
        }
    }
    const q = t - 780;
    if (q < 0) return;
    if (q < 260) {
        const fl = 255 * tent(q - 70, 160) / 255 | 0;
        for (let i = 0; i < MX_LED_AMOUNT; i++) put(i, mix(col, C_WHITE, 200), (fl * tent(b_dist[i], 16) / 255 | 0) * fo / 255 | 0);
    }
    const xf = imin(q, 650) * 256 / 650 | 0, j256 = xf * (512 - xf) / 256 | 0;  // ease out, 0..256
    for (let k = 0; k < SPARKS; k++) {
        let len = 0;
        while (len < SPARK_LEN && spark[k][len] !== 255) len++;
        const head = (len - 1) * j256 / 256 | 0;  // the path read from its end: centre → rim
        for (let q2 = 0; q2 < 4 && head - q2 >= 0; q2++) put(spark[k][len - 1 - (head - q2)], (k & 1) ? mix(col, C_WHITE, 170) : col, trail[q2] * fo / 255 | 0);
    }
    if (q > 400) {
        for (let i = 0; i < MX_LED_AMOUNT; i++) {
            const t2 = q - 400 - (h2[i] * 5 / 3 | 0);
            if (t2 >= 0 && t2 < 500 && h3[i] < 120 && b_dist[i] > 10) put(i, mix(col, C_WHITE, 120), (220 * (500 - t2) / 500 | 0) * fo / 255 | 0);
        }
    }
}

// 11 · Дождь: drops run down both diagonals of the grid, leaving a faint trail
export function rainShot(n, t, du, col) {
    const fo = smooth(du, du - 400, t);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const kA = b_col[i], kB = b_col[i] - b_row[i] + 6;  // the two diagonals through the ball
        let a = 0, c = col;
        const dfA = ((t - ((kA * 37 + 11) & 31) * 26) * 128 / 1000 | 0) - 16 - b_row[i] * 16;
        if (dfA >= 0) {
            if (dfA < 96) {
                const x = (96 - dfA) * 255 / 96 | 0;
                a = x * x / 255 | 0;
                if (dfA < 20) c = mix(col, C_WHITE, (20 - dfA) * 9);
            } else {
                a = 26;
            }
        }
        const dfB = ((t - ((kB * 29 + 5) & 31) * 26 - 110) * 128 / 1000 | 0) - 16 - b_row[i] * 16;
        if (dfB >= 0) {
            let a2 = 26;
            if (dfB < 96) {
                const x = (96 - dfB) * 255 / 96 | 0;
                a2 = x * x / 255 | 0;
            }
            if (a2 > a) {
                a = a2;
                c = mix(col, C_WHITE, dfB < 20 ? (20 - dfB) * 6 + 110 : 110);
            }
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// ================= the wake with its speed =================

// the wake's real length at the speed, ms
export function wakeLength(id, speed) {
    return wake_ms[id] * 100 / speed | 0;
}

// t: ms since the wake started (real time); style: the listening's style (1–3); wake: kaia_wake (0 = the style's)
export function wakeDraw(style, wake, speed, t, col) {
    const id = wake ? wake : style;
    const du = wake_ms[id];
    let u = t * speed / 100 | 0;  // the wake's own time
    if (u > du) u = du;
    fr.lt = t - wakeLength(id, speed);  // the listening's time: it goes on at its own pace after the wake
    fr.ls = style;

    switch (id) {
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
        default: rainShot(A_WAKE, u, du, col); break;
    }

    if (id <= 3) {
        // the sparks mark settles into its own breath; any other pair fades the style's listening in
        if (!(id === 3 && style === 3)) stateDraw(style, A_LISTENING, fr.lt, col, smooth(wake_from[id], du, u));
    } else {
        fr.dg = 89;
        stateDraw(style, A_LISTENING, fr.lt, col, smooth(du - 800, du, u));
    }
}

buildWakeTables();
