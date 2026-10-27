// Kaya's single animations of v1.9, part 3: the owner's picks from catalog C (KAIA-203), all 28 taken. Not a style:
// four new looks for each event and four new wakes, in the catalog's order, which any event takes with any style.
//   looks 24–27   Слушает: Облака, Листопад, Дюны, Нить          Думает: Спиннер, ДНК, Лабиринт, Сортировка
//                 Говорит: Шёлк, Сфера, Телеграф, Брызги         Готово: Радуга, Звезда, Солнце, Кубок
//                 Ошибка: Обвал, Трещина, Тучка, Замыкание       Уведомление: Вибрация, Птица, Стадион, Подарок
//   wakes 30–33   Занавес, Кофе, Будильник, Спидометр
// The wakes fade out over their last 400 ms (wakeDraw fades the listening in under their last 800), the other
// one-shots over their last 350 (Тучка and Подарок 400); the states loop. looks.js sends looks 24–27 here
// (singleState, singleShot, shotLength by single_ms) and wakeDraw wakes 30–33 (singleWake).
//
// For the firmware: as games.js, every function here is meant to be copied line by line into kaia.cpp. Integers only
// inside a frame; "x / y | 0" is C's x / y, "& 255" is (uint8_t); let / const are int (uint32_t for colours), arrays
// are static const tables (PROGMEM) or small int arrays on the stack ("[]" here: the C++ gives them the size the loop
// fills). No floats, no closures. isqrt takes a uint32_t; ">>" on a negative int shifts arithmetically, as in GCC.
// The code is the catalog's own; one deliberate difference, the same frames bit for bit: Замыкание's sparks skip a ball
// outside a spark's 8 × 8 box before they divide (soft(oct(dx, dy), 8, 5) is 0 there, as oct ≥ max(|dx|, |dy|)).
// Обвал reads this frame's digit marks (matrix.marked): ballRX gives −1 off the plate, so it is checked before marked().
import {
    A_DONE, A_ERROR, A_LISTENING, A_THINKING, abs, b_ang, b_dist, ballRX, C_VIOLET, C_WHITE, dimAll, fr, hash8, imax, imin,
    matrix, mix, oct, posMod, put, putb, segDist, sin8, smooth, tent, voice, wave,
} from "./kaia.js";
import { ledDiag, MX_LED_AMOUNT } from "./matrix.js";
import { ell } from "./styles.js";
import { b_row, b_x, h1 } from "./wakes.js";

// the names per event, looks 24–27 (looks.js LOOK_NAMES appends them; the wake's are wakes.js WAKE_NAMES 30–33)
export const SINGLE_NAMES = [
    ["Занавес", "Кофе", "Будильник", "Спидометр"],
    ["Облака", "Листопад", "Дюны", "Нить"],
    ["Спиннер", "ДНК", "Лабиринт", "Сортировка"],
    ["Шёлк", "Сфера", "Телеграф", "Брызги"],
    ["Радуга", "Звезда", "Солнце", "Кубок"],
    ["Обвал", "Трещина", "Тучка", "Замыкание"],
    ["Вибрация", "Птица", "Стадион", "Подарок"],
];
// the one-shots' lengths, ms: done, error, notify by look − 24 (the wakes': wakes.js wake_ms[30..33])
export const single_ms = [
    [1800, 1700, 1800, 1800],
    [1700, 1600, 1900, 1700],
    [1500, 1600, 1800, 1900],
];

// ================= the helpers of catalog C =================
// p = 4·(x − 19), q = 7·(row − 3): a ball from the middle in 1/8 balls (p to the right, q down), as in v1.6

// a soft edge: 255 inside r − w, then (1 − x)² down to 0 at r
export function soft(d, r, w) {
    if (d >= r) return 0;
    if (d <= r - w) return 255;
    const u = (r - d) * 255 / w | 0;
    return u * u / 255 | 0;
}

// the integer square root (uint32_t)
export function isqrt(n) {
    let r = 0, b = 1 << 30;
    while (b > n) b >>= 2;
    while (b) {
        if (n >= r + b) { n -= r + b; r = (r >> 1) + b; } else r >>= 1;
        b >>= 2;
    }
    return r;
}

// a cloud of three puffs round (cx, cy), 0..255
export function cloud(p, q, cx, cy) {
    const dx = p - cx, dy = q - cy;
    if (dx < -32 || dx > 32 || dy < -22 || dy > 16) return 0;
    return imax(imax(soft(oct(dx + 12, dy - 3), 13, 8), soft(oct(dx, dy + 3), 16, 9)), soft(oct(dx - 12, dy - 2), 12, 8));
}

// the y of a broken line at p: its 9 corners ys[0..8] at p = −80, −60 … 80
export function lineY(p, ys) {
    let k = (p + 80) / 20 | 0;
    k = k < 0 ? 0 : k > 7 ? 7 : k;
    const u = p + 80 - k * 20;
    return ys[k] + ((ys[k + 1] - ys[k]) * u / 20 | 0);
}

// ================= Пробуждение: (n, t, du, col), t = the wake's own time; each fades out over its last 400 ms =================

// Занавес: closed curtains with deep folds part from the middle (the hems lead, the bottoms lag); a light on the stage behind
export function curtainWake(n, t, du, col) {
    const fo = smooth(du, du - 400, t);
    const op = smooth(300, 1350, t), g = smooth(0, 250, t), lag = op * (255 - op) / 255 | 0;
    const st = smooth(500, 1100, t) * (255 - smooth(1200, 1800, t)) / 255 | 0;
    const wc = mix(col, C_WHITE, 190);
    fr.dg = 150;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3), ax = abs(p);
        const E = imax(0, (op * 82 / 255 | 0) - (lag * b_row[i] / 40 | 0));  // the inner edge in this row
        let a = 0, c = col;
        if (ax >= E) {  // on a curtain: the folds gather towards the side
            const u = (ax - E) * 256 / (83 - E) | 0;
            a = 25 + (sin8((u * 5 + 40) & 255) * 205 / 255 | 0);
            if (u < 20) { a = 235; c = wc; }  // the hem
            a = a * g / 255 | 0;
        }
        if (b_row[i] === 0) a = imax(a, 130 * g / 255 | 0);  // the pelmet
        if (st && ax < E) {  // the stage light
            const v = (soft(oct(p, (q + 3) * 2), 54, 46) * 170 / 255 | 0) * st / 255 | 0;
            if (v > a) { a = v; c = wc; }
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// Кофе: a cup fades in at the bottom; three wisps of steam rise from it one by one, sway and thin out at the top
export function coffeeWake(n, t, du, col) {
    const fo = smooth(du, du - 400, t);
    const g = smooth(0, 350, t), wc = mix(col, C_WHITE, 170), sc = mix(col, C_WHITE, 120);
    fr.dg = 140;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3), x = p + 6;
        let a = 0, c = col;
        if (q >= 0) {  // the cup, rows 3–6, narrower at its foot; the rim whiter, the inside dark
            const e = abs(x) - (19 - (q * 6 / 21 | 0));
            a = e > 2 ? 0 : e > -5 || q === 21 ? 220 : 30;
            if (a && q === 0) { a = 240; c = wc; }
            if (x > 18) a = imax(a, tent(oct(x - 24, q - 9) - 7, 4) * 200 / 255 | 0);  // the handle
            a = a * g / 255 | 0;
        } else {  // the steam
            for (let j = 0; j < 3; j++) {
                const env = smooth(350 + j * 220, 850 + j * 220, t);
                if (!env) continue;
                const sw = (sin8((q * 13 + (t * 95 / 1000 | 0) + j * 80) & 255) - 128) * 6 / 128 | 0;
                const band = soft(abs(x - (j - 1) * 11 - sw), 7, 5);
                const puff = sin8((q * 11 + (t * 170 / 1000 | 0) + j * 90) & 255);  // brighter puffs that rise
                const v = ((band * (90 + (puff * 150 / 255 | 0)) / 255 | 0) * (q + 36) / 36 | 0) * env / 255 | 0;
                if (v > a) { a = v; c = sc; }
            }
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// Будильник: an alarm clock with two bells rings: it shakes, its bells rock, sound marks either side; then it stops
const al_h1 = [0, 0, 0, -11], al_h2 = [0, 0, 8, 3];  // the hands from the face's centre, 1/8 ball
export function alarmWake(n, t, du, col) {
    const fo = smooth(du, du - 400, t);
    const env = smooth(250, 320, t) * (255 - smooth(1150, 1250, t)) / 255 | 0;
    const odd = (t / 50 | 0) & 1, sh = (odd ? 3 : -3) * env / 255 | 0;  // a shake every frame while it rings
    const g = smooth(0, 250, t), wc = mix(col, C_WHITE, 170);
    fr.dg = 140;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3), x = p - sh, y = q - 3;
        const d = oct(x, y);
        let a = tent(d - 15, 5) * 230 / 255 | 0, c = col;  // the rim
        if (d < 13) a = imax(a, 26);
        if (d < 12) {  // the hands
            const hd = imin(segDist(x, y, al_h1, 256), segDist(x, y, al_h2, 256));
            if (hd < 5) { a = imax(a, soft(hd, 5, 3) * 220 / 255 | 0); c = wc; }
        }
        const bl = imax(soft(oct(x + 13, q + 18 + sh), 8, 4), soft(oct(x - 13, q + 18 - sh), 8, 4));  // the bells rock
        if (bl > a) { a = bl; c = wc; }
        a = imax(a, soft(imin(oct(x + 12, q - 21), oct(x - 12, q - 21)), 6, 3) * 140 / 255 | 0);  // the feet
        if (env && abs(q) < 13) {
            for (let m = 0; m < 2; m++) {
                const v = (soft(abs(abs(p) - (31 + m * 9) + (q * q / 40 | 0)), 5, 3) * (200 - m * 80) / 255 | 0) * env / 255 | 0;
                if (v > a) { a = v; c = col; }
            }
        }
        put(i, c, (a * g / 255 | 0) * fo / 255 | 0);
    }
}

// Спидометр: a gauge arc over the bottom middle; the needle sweeps up past the top almost to the end, falls back, swings, settles straight up
export function gaugeWake(n, t, du, col) {
    const fo = smooth(du, du - 400, t);
    let th = -64 + (smooth(150, 800, t) * 112 / 255 | 0);  // the needle, 256 a turn from straight up
    if (t > 800) {
        const u = t - 800, am = 48 * imax(0, 750 - u) / 750 | 0;
        th = am * (sin8(((u * 256 / 600 | 0) + 64) & 255) - 128) / 128 | 0;
    }
    const ex = 31 * (sin8(th & 255) - 128) / 128 | 0, ey = 21 - (31 * (sin8((th + 64) & 255) - 128) / 128 | 0);
    const nd = [0, 21, ex, ey], g = smooth(0, 200, t), wc = mix(col, C_WHITE, 190), nc = mix(col, C_WHITE, 90);
    fr.dg = 140;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3), dy = 21 - q;
        const r = isqrt(p * p + dy * dy), pa = p * 64 / (abs(p) + dy + 1) | 0;  // the ball's angle, roughly: −64 .. 64
        let a = 0, c = col;
        const ab = tent(r - 38, 6);  // the arc
        if (ab) {
            const on = pa <= th, hot = on && th - pa < 10;
            a = ab * (hot ? 255 : on ? 190 : 50) / 255 | 0;
            if (hot) c = wc;
            if (((pa + 68) & 15) < 2) a = imax(a, ab * 120 / 255 | 0);  // the ticks
        }
        const nv = soft(segDist(p, q, nd, 256), 6, 4);  // the needle
        if (nv > a) { a = nv; c = oct(p - ex, q - ey) < 8 ? wc : nc; }
        const hb = soft(oct(p, q - 21), 9, 5);  // the hub
        if (hb > a) { a = hb; c = wc; }
        put(i, c, (a * g / 255 | 0) * fo / 255 | 0);
    }
}

// ================= Слушает: (n, t, col, k), k = how far it shows =================

// Облака: three clouds drift across, each at its own pace; their tops whiter; they wrap round out of sight
const cl_y = [-10, 6, -3], cl_v = [11, 8, 14], cl_o = [0, 90, 175], cl_a = [150, 175, 215];
export function cloudsListen(n, t, col, k) {
    if (k <= 0) return;
    const cx = [0, 0, 0];
    for (let j = 0; j < 3; j++) cx[j] = posMod((t * cl_v[j] / 1000 | 0) + cl_o[j], 260) - 130;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = 0, w = 0;
        for (let j = 0; j < 3; j++) {
            const v = cloud(p, q, cx[j], cl_y[j]) * cl_a[j] / 255 | 0;
            if (v > a) { a = v; w = imin(170, 40 + imax(0, cl_y[j] - q) * 9); }
        }
        put(i, mix(col, C_WHITE, w), a * k / 255 | 0);
    }
}

// Листопад: six leaves sway down like pendulums, tilting with the swing; widest and lowest at its bottom
const lf_x = [-56, -30, -4, 22, 46, 68];
export function leavesListen(n, t, col, k) {
    if (k <= 0) return;
    const lx = [0, 0, 0, 0, 0, 0], ly = [0, 0, 0, 0, 0, 0], lw = [0, 0, 0, 0, 0, 0], ls = [0, 0, 0, 0, 0, 0];
    for (let j = 0; j < 6; j++) {
        const per = 4800 + (j * 5 % 6) * 400, u = posMod(t + j * 1730, per), sw = wave(t + j * 530, 72);
        const fl = 128 - abs(sw);  // 128 at the bottom of the swing
        lx[j] = lf_x[j] + (sw * 13 / 128 | 0);
        ly[j] = -44 + (u * 88 / per | 0) + (fl * 3 / 128 | 0);
        lw[j] = 6 + (fl * 6 / 128 | 0);
        ls[j] = sw;  // the tilt follows the swing
    }
    const wc = mix(col, C_WHITE, 110);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = 0, c = col;
        for (let j = 0; j < 6; j++) {
            const dx = p - lx[j], dy = q - ly[j];
            if (dx < -20 || dx > 20 || dy < -16 || dy > 16) continue;
            const e = ell(dx, dy + (dx * ls[j] / 200 | 0), lw[j], 5);
            if (e >= 640) continue;
            const u = imin(255, (640 - e) * 255 / 400 | 0), v = u * u / 255 | 0;
            if (v > a) { a = v; c = lw[j] > 10 ? wc : col; }
        }
        put(i, c, (a * 210 / 255 | 0) * k / 255 | 0);
    }
}

// Дюны: sand ridges creep sideways: a long windward slope, a short steep lee; only the ridge tops glow, the crest whiter, dark between
export function dunesListen(n, t, col, k) {
    if (k <= 0) return;
    const sp = t * 34 / 1000 | 0, wv = t * 11 / 1000 | 0, wc = mix(col, C_WHITE, 160);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        const s = (p * 3 + q * 5 + ((sin8((q * 7 + wv) & 255) - 128) * 12 / 128 | 0) - sp) & 255;
        const h = s < 184 ? s * 255 / 184 | 0 : (255 - s) * 255 / 71 | 0;
        const a = smooth(150, 255, h);
        if (a) put(i, h > 215 ? mix(col, wc, (h - 215) * 6) : col, (a * 230 / 255 | 0) * k / 255 | 0);
    }
}

// Нить: a glowing thread weaves slowly across, light runs along it; a bead (the needle) glides back and forth on it
export function threadListen(n, t, col, k) {
    if (k <= 0) return;
    const A = 11 + (wave(t, 23) * 4 / 128 | 0), ph = t * 38 / 1000 | 0, run = t * 90 / 1000 | 0, wc = mix(col, C_WHITE, 200);
    const bp = [0, 0, 0], bq = [0, 0, 0];
    for (let m = 0; m < 3; m++) {  // the bead and its trail, 90 ms apart
        bp[m] = wave(t - m * 90, 30) * 64 / 128 | 0;
        bq[m] = A * (sin8((bp[m] * 3 - ph) & 255) - 128) / 128 | 0;
    }
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        const y = A * (sin8((p * 3 - ph) & 255) - 128) / 128 | 0;
        let a = soft(abs(q - y), 7, 5) * (120 + ((sin8((p * 2 - run) & 255) * 80) >> 8)) / 255 | 0, c = col;
        for (let m = 0; m < 3; m++) {
            const v = soft(oct(p - bp[m], q - bq[m]), 13 - m * 2, 8) * (255 - m * 80) / 255 | 0;
            if (v > a) { a = v; c = m ? col : wc; }
        }
        put(i, c, a * k / 255 | 0);
    }
}

// ================= Думает: Kaya's colour half violet =================

// Спиннер: a loading arc round the middle; its head runs ahead, its tail catches up, and the whole ring turns
export function spinnerThink(n, t, col, k) {
    if (k <= 0) return;
    const c = mix(col, C_VIOLET, 128), wc = mix(c, C_WHITE, 170);
    const cy = t / 1400 | 0, u = t - cy * 1400, base = cy * 200 + (t * 256 / 2400 | 0);
    const hd = base + 20 + (200 * smooth(0, 700, u) / 255 | 0), L = hd - base - (200 * smooth(700, 1400, u) / 255 | 0);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i], rb = soft(abs(d - 10), 4, 3);  // the ring, 2½ balls out
        if (!rb) continue;
        const v = (hd - b_ang[i]) & 255;  // how far behind the head
        let a = 0;
        if (v < L) a = (255 - (v * 150 / L | 0)) * imin(255, (L - v) * 40) / 255 | 0;
        else if (v >= 246) a = (v - 246) * 22;
        put(i, v < 14 || v >= 246 ? wc : c, (a * rb / 255 | 0) * k / 255 | 0);
    }
}

// ДНК: a double helix turns along the display; each strand bright and whiter in front, fading out behind; faint rungs between
export function dnaThink(n, t, col, k) {
    if (k <= 0) return;
    const c = mix(col, C_VIOLET, 128), wc = mix(c, C_WHITE, 150), rot = t * 230 / 1000 | 0;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        const th = (p * 3 + rot) & 255, z = sin8((th + 64) & 255) - 128;  // z > 0: strand 1 in front
        const y = 15 * (sin8(th) - 128) / 128 | 0;
        const f1 = imax(0, 140 + (z * (z > 0 ? 115 : 140) / 128 | 0)), f2 = imax(0, 140 - (z * (z < 0 ? 115 : 140) / 128 | 0));
        const a1 = soft(abs(q - y), 6, 4) * f1 / 255 | 0, a2 = soft(abs(q + y), 6, 4) * f2 / 255 | 0;
        let a = imax(a1, a2);
        const cc = (a1 > a2 ? f1 : f2) > 220 ? wc : c;
        if (((b_x[i] + 1) >> 1) % 4 === 0 && abs(q) < abs(y) - 3) a = imax(a, 30);  // a rung
        if (a) put(i, cc, a * k / 255 | 0);
    }
}

// Лабиринт: corridors in rows 0, 2, 4, 6, faint walls in 1, 3, 5 with gaps; a light searches its way, backs out of two dead ends (they go dark), finds the exit
const mz_gap = [14, 34, 4, 24, 12, 32];  // the gaps of rows 1, 3, 5 (b_x)
const mz_seg = [3, 0, 13, 0, 0, 13, 0, 15, 2, 0, 15, 2, 25, 2, 0, 25, 2, 37, 2, 1, 25, 2, 23, 4, 0, 23, 4, 1, 4, 1, 23, 4, 31, 4, 0, 31, 4, 33, 6, 0, 33, 6, 35, 6, 0];  // x0, row0, x1, row1, dead end
export function mazeThink(n, t, col, k) {
    if (k <= 0) return;
    const c = mix(col, C_VIOLET, 128), wc = mix(c, C_WHITE, 180), wl = mix(c, C_WHITE, 130);
    const u = posMod(t, 5200), s = u * 32 / 1000 | 0;  // the head on the path, half-balls: the exit (110) at 3.44 s
    const fl = tent(u - 3650, 300), out = (255 - smooth(4300, 4900, u)) * k / 255 | 0;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {  // the walls
        const r = b_row[i];
        if (!(r & 1) || b_x[i] === mz_gap[r - 1] || b_x[i] === mz_gap[r]) continue;
        put(i, wl, (8 + (60 * fl / 255 | 0)) * k / 255 | 0);
    }
    let at = 0, hp = 0, hq = 0;
    for (let m = 0; m < 9; m++) {
        const x0 = mz_seg[m * 5], r0 = mz_seg[m * 5 + 1], x1 = mz_seg[m * 5 + 2], r1 = mz_seg[m * 5 + 3], dead = mz_seg[m * 5 + 4];
        const dr = r1 - r0, L = dr ? 2 * dr : abs(x1 - x0), sx = x1 > x0 ? 1 : -1, len = dead ? 2 * L : L;
        if (s >= at && s < at + len) {  // the head is on this one (on a dead end, out and back)
            const v = s - at > L ? 2 * L - (s - at) : s - at;
            hp = 4 * (x0 - 19) + sx * (dr ? 2 * v : 4 * v);
            hq = 7 * (r0 - 3) + (dr ? v * 7 / 2 | 0 : 0);
        }
        for (let o = m ? 2 : 0; o <= L; o += 2) {  // its balls, o half-balls from its start
            const pass = at + o;
            if (s < pass) break;
            let a = 150 + (105 * soft(s - pass, 16, 16) / 255 | 0);
            if (dead && s >= at + 2 * L - o) a = 120 * soft(s - (at + 2 * L - o), 24, 24) / 255 | 0;  // backed out: it goes dark
            putb(ballRX(dr ? x0 + sx * (o >> 1) : x0 + sx * o, dr ? r0 + (o >> 1) : r0), fl > 90 ? wc : c, imax(a, fl) * out / 255 | 0);
        }
        at += len;
    }
    if (s < at) {  // the searching light
        for (let i = 0; i < MX_LED_AMOUNT; i++) {
            const v = soft(oct(4 * (b_x[i] - 19) - hp, 7 * (b_row[i] - 3) - hq), 12, 6);
            if (v) put(i, wc, v * out / 255 | 0);
        }
    }
}

// Сортировка: nine bars sort themselves (bubble sort), two compared at a time; a swap morphs their heights; sorted, a shine runs over them, they sink, new ones rise
export function sortThink(n, t, col, k) {
    if (k <= 0) return;
    const c = mix(col, C_VIOLET, 128), wc = mix(c, C_WHITE, 170);
    const cy = t / 7000 | 0, u = t - cy * 7000;
    const v = [0, 1, 2, 3, 4, 5, 6, 7, 8], H = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let j = 8; j > 0; j--) { const r = hash8(cy * 9 + j) % (j + 1), x = v[j]; v[j] = v[r]; v[r] = x; }  // this round's shuffle
    const st = imin(36, imax(0, u - 300) / 160 | 0), e = smooth(20, 140, u - 300 - st * 160);  // the step, 160 ms each
    let cj = -1, sw = 0, m = 0;
    for (let p0 = 0; p0 < 8 && cj < 0; p0++) {
        for (let j = 0; j < 8 - p0; j++) {
            if (m === st) { cj = j; sw = v[j] > v[j + 1] ? 1 : 0; break; }
            if (v[j] > v[j + 1]) { const x = v[j]; v[j] = v[j + 1]; v[j + 1] = x; }
            m++;
        }
    }
    const g = smooth(0, 300, u) * (255 - smooth(6600, 7000, u)) / 255 | 0;  // they rise, and sink at the end
    for (let j = 0; j < 9; j++) H[j] = (16 + v[j] * 12) * g / 255 | 0;  // 1/16 row
    if (sw) { const a0 = H[cj], a1 = H[cj + 1]; H[cj] = a0 + ((a1 - a0) * e / 255 | 0); H[cj + 1] = a1 + ((a0 - a1) * e / 255 | 0); }
    const s16 = u >= 6060 ? ((u - 6060) * 176 / 540 | 0) - 16 : -99;  // the shine, 1/16 bar
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const j = (b_x[i] - 1) >> 2;
        if (j < 0 || j > 8) continue;
        const h = H[j] - (6 - b_row[i]) * 16;
        if (h <= 0) continue;
        let a = h >= 16 ? 170 : h * 170 / 16 | 0, cc = c;
        if (j === cj || j === cj + 1) { a = a * 3 / 2 | 0; cc = wc; }
        const sv = tent(j * 16 - s16, 26);
        if (sv) { a = imax(a, (h >= 16 ? 255 : h * 16) * sv / 255 | 0); cc = mix(c, C_WHITE, 180 * sv / 255 | 0); }
        put(i, cc, a * k / 255 | 0);
    }
}

// ================= Говорит: voice(t), the pseudo-voice of kaia.cpp =================

// Шёлк: three silk ribbons wave across, each at its own pace; how far they swing is the voice, each a moment later
const silk_f = [3, 5, 2], silk_w = [320, -230, 150], silk_d = [0, 80, 170], silk_h = [17, 13, 10];
export function silkSpeak(n, t, col, k) {
    if (k <= 0) return;
    const A = [0, 0, 0], ph = [0, 0, 0], cc = [col, mix(col, C_WHITE, 90), mix(col, C_WHITE, 170)];
    for (let j = 0; j < 3; j++) { A[j] = 2 + (voice(t - silk_d[j]) * silk_h[j] / 255 | 0); ph[j] = t * silk_w[j] / 1000 | 0; }
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = 0, c = col;
        for (let j = 0; j < 3; j++) {
            const y = A[j] * (sin8((p * silk_f[j] + ph[j]) & 255) - 128) / 128 | 0;
            const v = soft(abs(q - y), 6, 4) * (240 - j * 75) / 255 | 0;
            if (v > a) { a = v; c = cc[j]; }
        }
        put(i, c, a * k / 255 | 0);
    }
}

// Сфера: a glowing orb in the middle; its rim swells with the voice and goes whiter; a soft halo round it
export function orbSpeak(n, t, col, k) {
    if (k <= 0) return;
    const v = voice(t), R = 56 + (v * 120 / 255 | 0);  // the rim, 1/16 quarter-ball
    const rc = mix(col, C_WHITE, 60 + (150 * v / 255 | 0)), cc = mix(col, C_WHITE, 200);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i] * 16;
        let a = 0, c = col;
        if (d < R) { a = 70 + (60 * (R - d) / R | 0); if (d < 40) { a = imax(a, 200 - d * 2); c = cc; } }  // the body, the core
        const rm = tent(d - R, 44) * (150 + (105 * v / 255 | 0)) / 255 | 0;
        if (rm > a) { a = rm; c = rc; }
        if (d > R) a = imax(a, soft(d - R, 90, 90) * 50 / 255 | 0);  // the halo
        put(i, c, a * k / 255 | 0);
    }
}

// Телеграф: the voice keys dots and dashes at the right end of the middle row; they run left; rows 1 and 5 carry its echo
export function telegraphSpeak(n, t, col, k) {
    if (k <= 0) return;
    const wc = mix(col, C_WHITE, 180);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const r = b_row[i];
        if (r !== 1 && r !== 3 && r !== 5) continue;
        const mid = r === 3, te = t - (38 - b_x[i]) * 45 - (mid ? 0 : r === 1 ? 300 : 600);  // when this place was keyed: 22 half-balls a second
        const a = smooth(80, 150, voice(te)) * (mid ? 245 : 130) / 255 | 0;
        if (a) put(i, mid && b_x[i] >= 34 && a > 60 ? wc : col, a * k / 255 | 0);
    }
}

// Брызги: every syllable throws three droplets up from the middle; they arc out and fall; louder syllables throw brighter ones
export function splashSpeak(n, t, col, k) {
    if (k <= 0) return;
    const v = voice(t), wc = mix(col, C_WHITE, 170);
    const ph = (t * 469 / 1000 | 0) + (wave(t, 86) * 41 / 128 | 0) + 128;  // voice()'s own phase: a syllable each 128
    const dp = [0, 0, 0, 0, 0, 0, 0, 0, 0], dq = [0, 0, 0, 0, 0, 0, 0, 0, 0], da = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let m = 0; m < 3; m++) {
        const sy = (ph >> 7) - m, age = ((ph & 127) + m * 128) * 1000 / 469 | 0;  // the syllable and its age, ms
        const g = voice(t - age + 136);  // how loud it was at its peak
        for (let j = 0; j < 3; j++) {
            const x = m * 3 + j, vx = (hash8(sy * 3 + j) - 128) * 72 / 128 | 0, vy = -(72 + (hash8(sy * 3 + j + 101) & 63));  // 1/8 ball a second
            dp[x] = vx * age / 1000 | 0;
            dq[x] = 6 + (vy * age / 1000 | 0) + (130 * (age * age / 1000 | 0) / 1000 | 0);
            da[x] = g < 70 ? 0 : g * (820 - imin(820, age)) / 820 | 0;
        }
    }
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = soft(oct(p, q - 6), 8 + (v * 12 / 255 | 0), 8) * v / 255 | 0, c = col;  // the mouth
        for (let x = 0; x < 9; x++) {
            if (!da[x]) continue;
            const w = soft(oct(p - dp[x], q - dq[x]), 8, 5) * da[x] / 255 | 0;
            if (w > a) { a = w; c = w > 180 ? wc : col; }
        }
        put(i, c, a * k / 255 | 0);
    }
}

// ================= Готово: (n, t, du, col), green unless the call gives a colour =================

// Радуга: a rainbow arcs over the display, drawn from its left foot to the right one; its green band is the call's colour
const rb_col = [0xff3b30, 0xff9a1f, 0xffe04a, 0, 0x2f8bff, 0x9b5cff];  // outer to inner; 0 = the call's colour
export function rainbowDone(n, t, du, col) {
    const fo = smooth(du, du - 350, t);
    const F = -300 + (smooth(60, 900, t) * 600 / 255 | 0);  // the drawing front over the arc's angle: −256 left foot .. 256 right
    const sh = t > 950 ? -300 + ((t - 950) * 600 / 600 | 0) : -999;  // a shine runs over it
    const gl = smooth(700, 1100, t);
    fr.dg = 200;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3), dq = 56 - q, d = isqrt(p * p + dq * dq);
        if (d < 34) { put(i, col, (50 * gl / 255 | 0) * fo / 255 | 0); continue; }  // the green glow under the arch
        if (d > 86) continue;
        const b = imin(5, imax(0, (d - 36) >> 3)), pa = p * 256 / (abs(p) + dq) | 0;
        if (pa >= F) continue;
        const edge = imin(255, imin(d - 33, 87 - d) * 70), fa = imin(255, (F - pa) * 6);
        const w = imax(soft(F - pa, 60, 60) * 200 / 255 | 0, tent(pa - sh, 50) * 170 / 255 | 0);
        put(i, mix(rb_col[5 - b] ? rb_col[5 - b] : col, C_WHITE, w), ((230 * edge / 255 | 0) * fa / 255 | 0) * fo / 255 | 0);
    }
}

// Звезда: a four-pointed star bursts from the middle with a bounce, then twinkles: its arms stretch in turn; glints flash round it
const st_gl = [-52, -12, 700, 50, 10, 820, -28, 15, 960, 60, -14, 1080];  // glints: p, q, when (ms)
export function starDone(n, t, du, col) {
    const fo = smooth(du, du - 350, t);
    const sc = (smooth(60, 400, t) * 300 / 255 | 0) - (smooth(400, 620, t) * 44 / 255 | 0);  // 1/256: past full size, then settles
    const tw = t > 620 ? wave(t - 620, 700) : 0;
    const W = 72 * (sc + (tw * 40 / 128 | 0)) / 256 | 0, H = 26 * (sc - (tw * 40 / 128 | 0)) / 256 | 0, C = 12 * sc / 256 | 0;
    fr.dg = 200;
    dimAll(255 - ((120 * smooth(0, 200, t) / 255 | 0) * fo / 255 | 0));
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3), ap = abs(p), aq = abs(q);
        let a = 0, w = imax(40, 210 - oct(p, q) * 3);
        if (ap < W) a = soft(aq, 8 * (W - ap) / W + 3 | 0, 4);  // the long arms
        if (aq < H) a = imax(a, soft(ap, 10 * (H - aq) / H + 3 | 0, 4));  // the short ones
        a = imax(a, soft(oct(p, q), C + 4, 6));
        if (ap < C * 2) a = imax(a, soft(abs(ap - aq), 4, 3) * (C * 2 - ap) / (C * 2) | 0);  // the little diagonals
        for (let j = 0; j < 4; j++) {
            const v = soft(oct(p - st_gl[j * 3], q - st_gl[j * 3 + 1]), 9, 6) * tent(t - st_gl[j * 3 + 2], 150) / 255 | 0;
            if (v > a) { a = v; w = 200; }
        }
        if (a) put(i, mix(col, C_WHITE, w), a * fo / 255 | 0);
    }
}

// Солнце: a warm sun bursts in the middle and throws out twelve rays, long and short in turn; a glow runs out along them
export function sunDone(n, t, du, col) {
    const fo = smooth(du, du - 350, t);
    const Rc = (smooth(0, 260, t) * 150 / 255 | 0) - (smooth(260, 420, t) * 40 / 255 | 0);  // the disc, 1/16 quarter-ball
    const L = Rc + (smooth(200, 700, t) * 500 / 255 | 0), rot = t * 24 / 1000 | 0;
    const pr = t > 650 ? (t - 650) * 600 / 1000 | 0 : -999;
    const warm = mix(0xffd36b, C_WHITE, 110);
    fr.dg = 200;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i] * 16;
        let a = soft(d, Rc + 20, 24), c = mix(col, warm, Rc > 0 ? imin(255, 60 + imax(0, (Rc - d) * 255 / Rc | 0)) : 0);
        const s = ((b_ang[i] + rot) * 12) & 255, rw = tent(s < 128 ? s : 256 - s, 72);
        const Lr = (((b_ang[i] + rot) * 12 + 128) >> 8) & 1 ? Rc + ((L - Rc) * 3 / 5 | 0) : L;
        if (rw && d > Rc - 16 && d < Lr) {
            const v = rw * (255 - (imax(0, d - Rc) * 140 / (Lr - Rc + 1) | 0)) / 255 | 0, gl = tent(d - pr, 100) * rw / 255 | 0;
            if (imax(v, gl) > a) { a = imax(v, gl); c = gl > 60 ? mix(col, C_WHITE, gl * 3 / 4 | 0) : col; }
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// Кубок: a cup with handles builds up from its foot, a gleam sweeps across it, glints flash at its rim; the time steps back
const pict_cup = [0x1ff, 0x17d, 0x0ba, 0x010, 0x07c];  // 9 wide, drawn like a clock glyph
export function cupDone(n, t, du, col) {
    const fo = smooth(du, du - 350, t);
    dimAll(255 - ((200 * smooth(0, 180, t) / 255 | 0) * fo / 255 | 0));
    fr.dg = 255;
    const gx = -70 + ((t - 550) * 170 / 450 | 0), x0 = (194 - 90) / 20 | 0;
    for (let gy = 0; gy < 5; gy++) {
        const up = smooth((4 - gy) * 70, (4 - gy) * 70 + 180, t);  // from the foot up
        for (let x = 0; x < 9; x++) {
            if (!((pict_cup[gy] >> (8 - x)) & 1)) continue;
            const led = ledDiag(x0 + x + (gy >> 1), 1 + gy);
            if (led < 0) continue;
            const gl = t > 550 && t < 1050 ? tent(4 * (b_x[led] - 19) + 7 * (b_row[led] - 3) - gx, 18) : 0;
            put(led, mix(col, C_WHITE, 40 + (200 * gl / 255 | 0)), up * fo / 255 | 0);
        }
    }
    for (let i = 0; i < MX_LED_AMOUNT; i++) {  // glints at the rim's ends
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        const v = imax(soft(oct(p + 38, q + 18), 10, 6) * tent(t - 1080, 180) / 255 | 0, soft(oct(p - 46, q + 18), 10, 6) * tent(t - 1240, 180) / 255 | 0);
        if (v) put(i, mix(col, C_WHITE, 210), v * fo / 255 | 0);
    }
}

// ================= Ошибка: red unless the call gives a colour =================

// Обвал: the time's own balls turn red and fall to the bottom, the lowest first; each lands on the pile and bounces
export function collapseError(n, t, du, col) {
    const fo = smooth(du, du - 350, t);
    dimAll(255 - ((225 * smooth(0, 160, t) / 255 | 0) * fo / 255 | 0));
    fr.dg = 255;
    const wc = mix(col, C_WHITE, 170);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {  // the floor
        if (b_row[i] === 6) put(i, col, (40 * smooth(350, 700, t) / 255 | 0) * fo / 255 | 0);
    }
    for (let j = 0; j < MX_LED_AMOUNT; j++) {
        if (!matrix.marked(j)) continue;
        const r0 = b_row[j], x = b_x[j], dir = h1[j] & 1 ? 1 : -1;  // it falls down its own zigzag
        let below = 0;
        for (let m = 1; r0 + m <= 6; m++) {
            const b = ballRX(x + (m & 1 ? dir : 0), r0 + m);
            if (b >= 0 && matrix.marked(b)) below++;  // −1 off the plate: the C++ marked() takes no −1
        }
        const D = (6 - below - r0) * 16, u = t - (6 - r0) * 50 - (h1[j] & 63);  // the drop, 1/16 row; the lowest start first
        let y = 0, hit = 999;
        if (u > 0 && D > 0) {
            y = 480 * (u * u / 1000 | 0) / 1000 | 0;
            if (y >= D) {
                const v = u - isqrt(D * 2083);  // since it landed, ms
                hit = v;
                y = D - (v < 170 ? 40 * v * (170 - v) / 28900 | 0 : v < 280 ? 16 * (v - 170) * (280 - v) / 12100 | 0 : 0);
            }
        }
        const rr = y >> 4, fy = y & 15, c = hit < 120 ? wc : col;
        putb(ballRX(x + (rr & 1 ? dir : 0), r0 + rr), c, (255 * (16 - fy) >> 4) * fo / 255 | 0);
        if (fy) putb(ballRX(x + ((rr + 1) & 1 ? dir : 0), r0 + rr + 1), c, (255 * fy >> 4) * fo / 255 | 0);
    }
}

// Трещина: a crack runs across, white-hot at its tip; two branches split off; it cools to red and throbs once
const crk_y = [-13, -4, -10, 2, -3, 9, 1, 11, 5], crk_b1 = [-20, 2, -8, -20], crk_b2 = [40, 1, 54, 21];
export function crackError(n, t, du, col) {
    const fo = smooth(du, du - 350, t);
    dimAll(255 - ((190 * smooth(0, 150, t) / 255 | 0) * fo / 255 | 0));
    fr.dg = 255;
    const F = -84 + (smooth(60, 480, t) * 168 / 255 | 0), bv = smooth(440, 660, t) * 256 / 255 | 0;
    const hot = 255 - smooth(480, 950, t), th = tent(t - 1050, 220);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = 0, w = 0;
        if (p <= F + 6) {
            a = soft(abs(q - lineY(p, crk_y)), 6, 4) * imin(255, (F + 6 - p) * 30) / 255 | 0;
            w = imax(soft(F - p, 28, 28), hot * 80 / 255 | 0);
        }
        if (bv > 0) {
            const v = soft(imin(segDist(p, q, crk_b1, bv), segDist(p, q, crk_b2, bv)), 5, 3) * 210 / 255 | 0;
            if (v > a) { a = v; w = hot * 120 / 255 | 0; }
        }
        if (!a) continue;
        a = imin(255, a + (a * th / 400 | 0));
        put(i, mix(col, C_WHITE, imin(230, w)), a * fo / 255 | 0);
    }
}

// Тучка: a red cloud comes down over the top rows and rains; drops fall straight down with short trails, a puddle gathers
export function rainCloudError(n, t, du, col) {
    const fo = smooth(du, du - 400, t);
    const cy = -36 + (smooth(0, 380, t) * 26 / 255 | 0), sx = wave(t, 60) * 4 / 128 | 0;
    const wc = mix(col, C_WHITE, 150);
    fr.dg = 200;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = cloud(p, q, sx, cy) * 200 / 255 | 0, c = mix(col, C_WHITE, imin(140, imax(0, cy - q) * 10));
        if (b_row[i] === 6) a = imax(a, 26 * smooth(500, 900, t) / 255 | 0);  // the puddle
        for (let j = 0; j < 12; j++) {  // the drops
            const u = t - 330 - j * 85 - (hash8(j) & 63);
            if (u < 0 || u >= 520) continue;
            const dx = abs(p - ((hash8(j + 50) * 48 >> 8) - 24 + sx));
            if (dx > 5) continue;
            const dy = cy + 8 + (u * 95 / 1000 | 0) - q;  // > 0: the ball is above the drop's head
            const w = dy >= -4 && dy < 18 ? (dy < 4 ? 255 : (18 - dy) * 255 / 14 | 0) * (6 - dx) / 6 | 0 : 0;
            if (w > a) { a = w; c = dy < 4 ? wc : col; }
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// Замыкание: an arc crackles between two contacts at the ends of the middle row; a bang, sparks fly and fall, then dark
export function shortError(n, t, du, col) {
    const fo = smooth(du, du - 350, t);
    const wc = mix(col, C_WHITE, 200), ep = t / 60 | 0, arc = t >= 80 && t < 640;
    const ys = [0, 0, 0, 0, 0, 0, 0, 0, 0], sp = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], sq = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    if (arc) for (let m = 1; m < 8; m++) ys[m] = (hash8(ep * 11 + m) - 128) * 15 / 128 | 0;  // a new zigzag every 60 ms
    const ab = arc ? imin(255, 170 + (hash8(ep + 77) & 63) + (85 * smooth(80, 600, t) / 255 | 0)) : 0;
    const bang = tent(t - 690, 150), us = t - 700;
    if (us >= 0 && us < 700) {
        for (let j = 0; j < 10; j++) {  // the sparks
            sp[j] = ((hash8(j * 2 + 5) - 128) * 90 / 128 | 0) * us / 1000 | 0;
            sq[j] = (-(40 + (hash8(j * 2 + 6) & 63)) * us / 1000 | 0) + (170 * (us * us / 1000 | 0) / 1000 | 0);
        }
    }
    dimAll(255 - (imax(130 * smooth(0, 150, t) / 255 | 0, 240 * smooth(700, 950, t) / 255 | 0) * fo / 255 | 0));
    fr.dg = 255;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = 0, c = col;
        if (t < 720) a = soft(imin(oct(p + 72, q), oct(p - 72, q)), 11, 6) * (arc ? 230 : 150) / 255 | 0;  // the contacts
        if (arc && p > -72 && p < 72) {
            const d = abs(q - lineY(p, ys)), v = soft(d, 7, 4) * ab / 255 | 0;
            if (v > a) { a = v; c = d < 3 ? wc : col; }
        }
        if (bang) { const v = bang * imax(0, 255 - b_dist[i] * 12) / 255 | 0; if (v > a) { a = v; c = wc; } }
        if (us >= 0 && us < 700) {
            for (let j = 0; j < 10; j++) {
                const dx = p - sp[j], dy = q - sq[j];
                if (dx <= -8 || dx >= 8 || dy <= -8 || dy >= 8) continue;  // outside the spark's box: soft() would give 0
                const v = soft(oct(dx, dy), 8, 5) * (700 - us) / 700 | 0;
                if (v > a) { a = v; c = mix(col, C_WHITE, 150); }
            }
        }
        if (t > 950 && b_dist[i] < 4) a = imax(a, 90 * (255 - smooth(950, 1500, t)) / 255 | 0);  // an ember
        put(i, c, a * fo / 255 | 0);
    }
}

// ================= Уведомление: amber unless the call gives a colour =================

// Вибрация: a phone in the middle buzzes twice: it shakes side to side, vibration marks either side
export function buzzNotify(n, t, du, col) {
    const fo = smooth(du, du - 350, t);
    const e1 = smooth(100, 150, t) * (255 - smooth(480, 530, t)) / 255 | 0, e2 = smooth(700, 750, t) * (255 - smooth(1080, 1130, t)) / 255 | 0;
    const env = imax(e1, e2), dx = ((t / 50 | 0) & 1 ? 4 : -4) * env / 255 | 0;  // a shake each frame while it buzzes
    const g = smooth(0, 120, t) * fo / 255 | 0, wc = mix(col, C_WHITE, 150);
    dimAll(255 - (170 * g / 255 | 0));
    fr.dg = 255;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3), x = p - dx;
        const ex = abs(x) - 15, ey = abs(q) - 16, e = ex > 0 && ey > 0 ? oct(ex, ey) : imax(ex, ey);  // < 0 inside the phone
        let a = e < -5 ? 0 : tent(e + 1, 5), c = col;  // the frame; the screen dark
        if (env && abs(q) < 13) {
            for (let m = 0; m < 2; m++) {
                const v = (soft(abs(abs(p) - (28 + m * 9) + (q * q / 40 | 0)), 5, 3) * (200 - m * 80) / 255 | 0) * env / 255 | 0;
                if (v > a) { a = v; c = wc; }
            }
        }
        put(i, c, a * g / 255 | 0);
    }
}

// Птица: a bird flies across, beating its wings about three times a second, with a gentle swoop
export function birdNotify(n, t, du, col) {
    const fo = smooth(du, du - 350, t);
    const bx = -104 + (imin(t, 1400) * 208 / 1400 | 0), by = -1 + (wave(t, 170) * 7 / 128 | 0);
    const fl = wave(t, 780) * 11 / 128 | 0, sy = by - 5 + (fl >> 1), ty = by - 9 + fl;  // the beat: the tips from −11 (up) to 11
    const s1 = [bx, by, bx - 10, sy], s2 = [bx - 10, sy, bx - 21, ty], s3 = [bx, by, bx + 10, sy], s4 = [bx + 10, sy, bx + 21, ty];
    const wc = mix(col, C_WHITE, 170);
    fr.dg = 200;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        if (p - bx < -40 || p - bx > 30 || abs(q - by) > 24) continue;
        const d = imin(imin(segDist(p, q, s1, 256), segDist(p, q, s2, 256)), imin(segDist(p, q, s3, 256), segDist(p, q, s4, 256)));
        let a = imax(soft(d, 7, 4), soft(oct(p - bx + 20, q - by), 12, 12) * 45 / 255 | 0), c = col;  // the wings, a faint trail
        const b = soft(oct(p - bx - 2, q - by), 8, 5);  // the body
        if (b > a * 3 / 4) { a = imax(a, b); c = wc; }
        put(i, c, a * fo / 255 | 0);
    }
}

// Стадион: a Mexican wave: column by column the display stands up, raised hands whiter; a second, smaller wave follows
export function stadiumNotify(n, t, du, col) {
    const fo = smooth(du, du - 350, t);
    const f1 = -110 + (t * 220 / 1000 | 0), f2 = -110 + ((t - 650) * 220 / 1000 | 0);
    const wc = mix(col, C_WHITE, 180);
    fr.dg = 170;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), r = b_row[i];
        const w1 = smooth(0, 255, tent(p - f1, 30)), w2 = t > 650 ? smooth(0, 255, tent(p - f2, 30)) * 170 / 255 | 0 : 0;
        const h = imax(w1, w2), e = (h * 112 / 255 | 0) - (6 - r) * 16;  // > 0: this ball stands
        let a = r === 6 ? 40 : 0, c = col;
        if (e > 0) { a = imax(a, e >= 16 ? 215 : e * 13); if (e < 20 && h > 120) c = wc; }
        put(i, c, a * fo / 255 | 0);
    }
}

// Подарок: a gift box shakes harder and harder, the lid pops up and melts, light and sparkles spring out
export function giftNotify(n, t, du, col) {
    const fo = smooth(du, du - 400, t);
    dimAll(255 - ((190 * smooth(0, 150, t) / 255 | 0) * fo / 255 | 0));
    fr.dg = 255;
    const sh = t >= 150 && t < 800 ? wave(t, 1150) * (1 + ((t - 150) * 4 / 650 | 0)) / 128 | 0 : 0;
    const L = smooth(800, 950, t) * 16 / 255 | 0, lid = 255 - smooth(1000, 1350, t), bm = tent(t - 1000, 330);
    const wc = mix(col, C_WHITE, 200), us = t - 980;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3), x = p - sh, ax = abs(x);
        let a = 0, c = col;
        if (q >= -2) {  // the box, rows 3–6, and its ribbon
            a = ax <= 14 ? 170 : ax < 20 ? 170 * (20 - ax) / 6 | 0 : 0;
            if (a && (ax < 3 || abs(q - 14) < 3)) { a = imax(a, 230 * a / 170 | 0); c = wc; }
        }
        if (abs(q + 7 + L) < 4 && ax < 22) {  // the lid, lifted by L
            const v = (ax <= 17 ? 230 : 230 * (22 - ax) / 5 | 0) * lid / 255 | 0;
            if (v > a) { a = v; c = ax < 3 ? wc : col; }
        }
        const bw = imax(soft(oct(x + 6, q + 15 + L), 6, 4), soft(oct(x - 6, q + 15 + L), 6, 4)) * lid / 255 | 0;  // the bow
        if (bw > a) { a = bw; c = wc; }
        if (bm && q < 0) {  // the light from inside
            const v = (bm * soft(ax, 24, 18) / 255 | 0) * (150 + q * 4) / 255 | 0;
            if (v > a) { a = v; c = wc; }
        }
        if (us > 0 && us < 800) {
            for (let j = 0; j < 6; j++) {  // the sparkles rise
                const v = soft(oct(p - (hash8(j + 9) * 40 >> 8) + 20, q + 4 + (us * (50 + (hash8(j + 19) & 31)) / 1000 | 0)), 8, 5) * tent(us - 150 - j * 60, 300) / 255 | 0;
                if (v > a) { a = v; c = wc; }
            }
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// ================= the event in a single look =================

// a state in look 24–27
export function singleState(look, n, t, col, k) {
    if (n === A_LISTENING) {
        switch (look) {
            case 24: cloudsListen(n, t, col, k); break;
            case 25: leavesListen(n, t, col, k); break;
            case 26: dunesListen(n, t, col, k); break;
            default: threadListen(n, t, col, k); break;
        }
    } else if (n === A_THINKING) {
        switch (look) {
            case 24: spinnerThink(n, t, col, k); break;
            case 25: dnaThink(n, t, col, k); break;
            case 26: mazeThink(n, t, col, k); break;
            default: sortThink(n, t, col, k); break;
        }
    } else {
        switch (look) {
            case 24: silkSpeak(n, t, col, k); break;
            case 25: orbSpeak(n, t, col, k); break;
            case 26: telegraphSpeak(n, t, col, k); break;
            default: splashSpeak(n, t, col, k); break;
        }
    }
}

// a one-shot (done, error, notify) in look 24–27, t = 0 .. du
export function singleShot(look, n, t, du, col) {
    if (n === A_DONE) {
        switch (look) {
            case 24: rainbowDone(n, t, du, col); break;
            case 25: starDone(n, t, du, col); break;
            case 26: sunDone(n, t, du, col); break;
            default: cupDone(n, t, du, col); break;
        }
    } else if (n === A_ERROR) {
        switch (look) {
            case 24: collapseError(n, t, du, col); break;
            case 25: crackError(n, t, du, col); break;
            case 26: rainCloudError(n, t, du, col); break;
            default: shortError(n, t, du, col); break;
        }
    } else {
        switch (look) {
            case 24: buzzNotify(n, t, du, col); break;
            case 25: birdNotify(n, t, du, col); break;
            case 26: stadiumNotify(n, t, du, col); break;
            default: giftNotify(n, t, du, col); break;
        }
    }
}

// wake 30–33, t = the wake's own time 0 .. du
export function singleWake(id, n, t, du, col) {
    switch (id) {
        case 30: curtainWake(n, t, du, col); break;
        case 31: coffeeWake(n, t, du, col); break;
        case 32: alarmWake(n, t, du, col); break;
        default: gaugeWake(n, t, du, col); break;
    }
}
