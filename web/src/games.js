// Kaya's styles of v1.9, part 2: the owner's picks from catalog B (KAIA-202, «игры и механика»), all six taken whole.
// As styles.js: a style is a whole visual language, its own version of all 7 events; kaia_anim 13–18 picks one as the
// style, and its versions join every event's gallery (looks 18–23, wakes 24–29; looks.js look_style, wakes.js wake_style).
//   13 Аркада, 14 Тетрис, 15 Механизм, 16 Неон, 17 Маятник, 18 Гирлянда
// The wakes fade out over their last 400 ms (wakeDraw fades the listening in under their last 800), the other
// one-shots over their last 300 ms; the states loop. The code is the catalog's own, unchanged.
//
// For the firmware: as styles.js, every function here is meant to be copied line by line into kaia.cpp. Integers only
// inside a frame; "x / y | 0" is C's x / y, "& 255" is (uint8_t); let / const are int (uint32_t for colours), arrays are
// static const tables or small int arrays on the stack ("[]" here: the C++ gives them the size the loop fills).
// No floats, no closures. ">>" on a negative int (tetPlace's (v + 64) >> 7, tetStack's k off the left end, Маятник ·
// Обрыв's sx >> 1 and (sy − 45) >> 1) shifts arithmetically in JS (rounds down: −4 >> 3 is −1), and GCC does the same
// for int: keep it ">>", never "/ 2" or "/ 8", which round towards 0.
// Two deliberate differences from the catalog's code, the same frames bit for bit: Аркада · Погоня and Гирлянда ·
// Бегущие огни take t modulo the period of a term whose t · w would overflow a 32-bit int within an hour of one state.
import {
    abs, b_ang, b_pos, C_VIOLET, C_WHITE, fr, imax, imin, mix, oct, posMod, put, ring_len, ringOf, segDist, sin8, smooth, tent, voice, wave,
} from "./kaia.js";
import { MX_LED_AMOUNT } from "./matrix.js";
import { b_row, b_x } from "./wakes.js";

// ================= the helpers of catalog B =================
// p = 4·(x − 19), q = 7·(row − 3): a ball from the middle in 1/8 balls (p to the right, q down), as in KAIA-173

// the sine and cosine of an angle (256 a turn), −128..127
export function psin(a) { return sin8(a & 255) - 128; }
export function pcos(a) { return sin8((a + 64) & 255) - 128; }

// the angle of (dx, dy) clockwise from 12 o'clock without atan, 0..255: exact on the axes and diagonals, a few off between
export function pang(dx, dy) {
    const s = abs(dx) + abs(dy);
    if (!s) return 0;
    return (dx >= 0 ? 64 + (dy * 64 / s | 0) : 192 - (dy * 64 / s | 0)) & 255;
}

// ================= 13 · Аркада: an 8-bit chomper with ghosts and dots, in Kaya's colour =================

// the chomper at (dp, dq) from its centre, radius r, facing dir (1 right, −1 left, 0 up),
// its mouth m (0 shut, 256 = ±45°, 2560 = all but a sliver): 0..255; the centre ball is never cut
export function chomp(dp, dq, r, dir, m) {
    const d = oct(dp, dq);
    if (d >= r + 7) return 0;
    const a = d <= r ? 255 : (r + 7 - d) * 255 / 7 | 0;
    const fw = dir ? dp * dir : -dq, sd = dir ? abs(dq) : abs(dp);  // ahead of the centre, and to the side
    if (fw <= 0 || m <= 0) return a;
    const e = (fw * m >> 8) - sd;  // > 0 inside the mouth
    return e <= -4 ? a : e >= 4 ? 0 : a * (4 - e) >> 3;
}

// a ghost at (dp, dq) from its centre: a dome of seven balls, its two feet wiggling out of step: 0..255
// (the caller whitens the two balls on top, dq < −3: the eyes)
export function ghost(dp, dq, t) {
    const d = oct(dp, dq);
    if (d >= 16) return 0;
    const a = d <= 9 ? 255 : (16 - d) * 255 / 7 | 0;
    return dq > 3 ? a * (170 + ((dp < 0 ? 85 : -85) * wave(t, 768) / 128 | 0)) / 255 | 0 : a;
}

// the dots: every other ball of the middle row; the one at the left edge is a power dot and pulses
export function arcDot(i, p, t) {
    if (b_row[i] !== 3 || (b_x[i] & 3)) return 0;
    return p === -76 ? 150 + (wave(t, 160) * 80 / 128 | 0) : 80;
}

// Пробуждение · Забег: the dots come up along the middle row; the chomper runs in from the left eating them,
// slowing to the patrol's pace, and is in the middle at the end (the patrol goes on from there)
export function arcWake(n, t, du, col) {
    const fo = smooth(du, du - 400, t), g = smooth(0, 250, t), dc = mix(col, C_WHITE, 170);
    const x = -100 + (t * 31 / 1000 | 0) + ((t * (3600 - t) / 3600 | 0) * 491 / 10000 | 0), m = abs(wave(t, 512)) * 3;
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = p > x ? arcDot(i, p, t) * g / 255 | 0 : 0, c = dc;
        const v = chomp(p - x, q, 12, 1, m);
        if (v > a) { a = v; c = col; }
        put(i, c, a * fo / 255 | 0);
    }
}

// Слушает · Патруль: the chomper walks the middle row there and back (4.4 s a way), its mouth shut at the turns;
// the dots it ate come back behind it 0.7–1.7 s later
export function arcListen(n, t, col, k) {
    if (k <= 0) return;
    const s = posMod(t + 2200, 8800), dir = s < 4400 ? 1 : -1, x = s < 4400 ? -68 + (s * 136 / 4400 | 0) : 68 - ((s - 4400) * 136 / 4400 | 0);
    const m = abs(wave(t, 384)) * 3 * smooth(68, 52, abs(x)) / 255 | 0, dc = mix(col, C_WHITE, 170);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = arcDot(i, p, t), c = dc;
        if (a && p > -76) {
            const sr = (p + 68) * 4400 / 136 | 0, sl = 8800 - sr;  // when it passes the dot: going right, going left
            a = a * smooth(700, 1700, imin(posMod(s - sr, 8800), posMod(s - sl, 8800))) / 255 | 0;
        }
        const v = chomp(p - x, q, 12, dir, m);
        if (v > a) { a = v; c = col; }
        put(i, c, a * k / 255 | 0);
    }
}

// Думает · Погоня: a violet ghost chases the chomper along the middle row, now closing in, now falling back;
// out at the right and in again at the left (2.6 s a round); the dots are eaten and grow again
export function arcThink(n, t, col, k) {
    if (k <= 0) return;
    const h = t * 80 / 1000 | 0, xc = -104 + posMod(h, 208), xg = -104 + posMod(h - 40 - (wave(t, 98) * 14 / 128 | 0), 208), gy = wave(t, 300) * 3 / 128 | 0;
    // (v1.9: wave(t, 640) repeats every 400 ms and the ghost's wave(t, 768) every 1000, so t goes in modulo those: the
    // same frames, and t · 768 never overflows a 32-bit int in a long state)
    const cc = mix(col, C_VIOLET, 64), gc = mix(C_VIOLET, C_WHITE, 50), ec = mix(gc, C_WHITE, 170), dc = mix(col, C_WHITE, 170), m = abs(wave(posMod(t, 400), 640)) * 3;
    const tg = posMod(t, 1000);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = b_row[i] === 3 && !(b_x[i] & 3) ? 80 * smooth(900, 1700, posMod(t - ((p + 104) * 25 / 2 | 0), 2600)) / 255 | 0 : 0, c = dc;
        let v = chomp(p - xc, q, 12, 1, m);
        if (v > a) { a = v; c = cc; }
        v = ghost(p - xg, q - gy, tg);
        if (v > a) { a = v; c = q - gy < -3 ? ec : gc; }
        put(i, c, a * k / 255 | 0);
    }
}

// Говорит · Ам-ам: the chomper bites with the voice in the middle; a chain of dots flows into its mouth from the right
export function arcSpeak(n, t, col, k) {
    if (k <= 0) return;
    const v = voice(t), x = -16 + (wave(t, 30) * 8 / 128 | 0), m = 40 + (v * 420 / 255 | 0), off = t * 40 / 1000 | 0, dc = mix(col, C_WHITE, 170);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = b_row[i] === 3 && p > x + 10 ? tent(posMod(p + off, 16) - 8, 8) * 90 / 255 | 0 : 0, c = dc;  // the dots, two balls apart, sliding left
        const w = chomp(p - x, q, 12, 1, m);
        if (w > a) { a = w; c = col; }
        put(i, c, a * k / 255 | 0);
    }
}

// Готово · Энерджайзер: the chomper runs at a big pulsing power dot and eats it (0.52 s): the display flashes,
// a ring goes out, the chomper glows, grows and runs off
export function arcDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t), e = t - 520, x = e < 0 ? -84 + (t * 104 / 520 | 0) : 20 + (e * 50 / 1000 | 0);
    const m = abs(wave(t, 640)) * 3, gl = e > 0 ? smooth(0, 300, e) : 0, cc = mix(col, C_WHITE, 110 * gl / 255 | 0), wc = mix(col, C_WHITE, 150);
    const pd = e < 0 ? 170 + (wave(t, 700) * 85 / 128 | 0) : 0, fl = tent(e - 60, 220) * 235 / 255 | 0, rr = e * 120 / 1000 | 0, rf = e > 0 ? 255 - smooth(0, 700, e) : 0;
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = fl, c = wc;
        if (pd) a = imax(a, tent(oct(p - 20, q), 11) * pd / 255 | 0);
        if (rf) a = imax(a, tent(oct(p - 20, q) - rr, 8) * rf / 255 | 0);
        const v = chomp(p - x, q, 12 + (3 * gl / 255 | 0), 1, m);
        if (v > a) { a = v; c = cc; }
        put(i, c, a * fo / 255 | 0);
    }
}

// Ошибка · Пойман: a violet ghost flies at the chomper head on and catches it (0.56 s); it freezes, its mouth opens
// upwards wider and wider while it shrinks to a dot, and pops
export function arcError(n, t, du, col) {
    const fo = smooth(du, du - 300, t), tc = imin(t, 560), xc = -40 + (tc * 40 / 1000 | 0), xg = 70 - (tc * 120 / 1000 | 0);
    const e = smooth(800, 1400, t), r = 12 - (12 * e / 255 | 0), m = t < 560 ? abs(wave(t, 512)) * 3 : t < 800 ? 0 : 256 + e * 9, dir = t < 800 ? 1 : 0;
    const g = 255 - smooth(1380, 1460, t), gf = 255 - smooth(700, 1000, t), pop = tent(t - 1450, 180), pr = imax(0, t - 1400) * 60 / 1000 | 0;
    const gc = mix(C_VIOLET, C_WHITE, 50), ec = mix(gc, C_WHITE, 170), pc = mix(col, C_WHITE, 120);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = pop ? tent(oct(p - xc, q) - pr, 6) * pop / 255 | 0 : 0, c = pc;
        let v = chomp(p - xc, q, r, dir, m) * g / 255 | 0;
        if (v > a) { a = v; c = col; }
        if (gf) {
            v = ghost(p - xg, q, t) * gf / 255 | 0;
            if (v > a) { a = v; c = q < -3 ? ec : gc; }
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// Уведомление · Бонус: a pair of cherries on green stems pops up in the middle and blinks three times, whiter on each blink
const arc_ch = [-8, 7, 8, 7, 4, -14];  // the two cherries and where their stems meet, (p, q)
const C_STEM = 0x5fd05a;
export function arcNotify(n, t, du, col) {
    const fo = smooth(du, du - 300, t), g = smooth(0, 150, t), b = imax(imax(tent(t - 250, 200), tent(t - 650, 200)), tent(t - 1050, 200));
    const a0 = (110 + (145 * b / 255 | 0)) * g / 255 | 0, cc = mix(col, C_WHITE, 120 * b / 255 | 0);
    const s1 = [arc_ch[0], arc_ch[1], arc_ch[4], arc_ch[5]], s2 = [arc_ch[2], arc_ch[3], arc_ch[4], arc_ch[5]];
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = tent(imin(oct(p - arc_ch[0], q - arc_ch[1]), oct(p - arc_ch[2], q - arc_ch[3])), 11) * a0 / 255 | 0, c = cc;
        const v = tent(imin(segDist(p, q, s1, 256), segDist(p, q, s2, 256)), 5) * (g * 3 >> 2) / 255 | 0;  // the stems
        if (v > a) { a = v; c = C_STEM; }
        put(i, c, a * fo / 255 | 0);
    }
}

// ================= 14 · Тетрис: blocks in the diagonal grid, a stack in the three bottom rows =================

// the stack: rows 4, 5, 6, bit k = the k-th ball of the row from the left (row r starts at p = −76 + 4·(r − 3)); its brightness by row
const tet_st = [0x18007, 0x3e0cf, 0x1f7ff], tet_sh = [205, 165, 130];
export function tetStack(r, p) {
    if (r < 4 || r > 6) return 0;
    const k = (p + 76 - 4 * (r - 3)) >> 3;
    return k >= 0 && k < 20 ? (tet_st[r - 4] >> k) & 1 : 0;
}

// the stack's block at (r, p) when it is in quarter j (from the left): its brightness, else 0
export function tetQ(r, p, j) {
    if (!tetStack(r, p)) return 0;
    return (p < -36 ? 0 : p < 0 ? 1 : p < 36 ? 2 : 3) === j ? tet_sh[r - 4] : 0;
}

// a piece of 4 blocks (tet_pc, from its centre) turned by ang (256 a turn, 43 ≈ 60°: the grid maps onto itself), centre (x, y):
// its blocks into xs, ys from j0
const tet_pc = [-8, 0, 0, 0, 8, 0, 4, -7];
export function tetPlace(xs, ys, j0, x, y, ang) {
    const cs = pcos(ang), sn = psin(ang);
    for (let j = 0; j < 4; j++) {
        const ox = tet_pc[2 * j], oy = tet_pc[2 * j + 1];
        xs[j0 + j] = x + ((ox * cs - oy * sn + 64) >> 7);
        ys[j0 + j] = y + ((ox * sn + oy * cs + 64) >> 7);
    }
}

// n blocks at (p, q): the nearest one, a ball wide (between two balls both share it)
export function tetAt(p, q, xs, ys, n) {
    let a = 0;
    for (let j = 0; j < n; j++) {
        const dx = p - xs[j];
        if (dx > -8 && dx < 8) a = imax(a, tent(oct(dx, q - ys[j]), 8));
    }
    return a;
}

// Пробуждение · Стопка: the stack falls in four chunks, one after another, row by row from above the top
// (each row down moves it half a ball, as the grid wants); each lands with a soft white flash
const tet_dt = [380, 0, 570, 190];  // when each quarter (from the left) starts to fall, ms
export function tetWake(n, t, du, col) {
    const fo = smooth(du, du - 400, t), sc = mix(col, C_WHITE, 40), off = [0, 0, 0, 0], fl = [0, 0, 0, 0];
    for (let j = 0; j < 4; j++) {
        const u = imin(imax(0, t - tet_dt[j]), 480), lt = t - tet_dt[j] - 480;
        off[j] = 1792 - (1792 * u * u / 230400 | 0);  // 7 rows above, in 1/256 row, falling with gravity
        fl[j] = lt >= 0 ? tent(lt, 200) : 0;
    }
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), r = b_row[i];
        let a = 0, c = sc;
        for (let j = 0; j < 4; j++) {
            if (t < tet_dt[j]) continue;
            const R = off[j] >> 8, w = off[j] & 255;
            const v = (tetQ(r + R, p - 4 * (R & 1), j) * (256 - w) + tetQ(r + R + 1, p - 4 * ((R + 1) & 1), j) * w) >> 8;
            if (v > a) { a = v; c = fl[j] ? mix(sc, C_WHITE, fl[j] * 150 / 255 | 0) : sc; }
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// Слушает · Фигура: one piece drifts down from above the top, turning twice by 60° on the way, and melts into the stack;
// then the next one, in another column (6 s each)
const tet_cx = [-28, 20, -4, 28];
export function tetListen(n, t, col, k) {
    if (k <= 0) return;
    const u = posMod(t, 6000), x = tet_cx[((t - u) / 6000 | 0) & 3], y = -34 + (34 * smooth(0, 5000, u) / 255 | 0);
    const g = smooth(0, 700, u) * smooth(6000, 5100, u) / 255 | 0, ang = (43 * smooth(1000, 1700, u) + 43 * smooth(2800, 3500, u)) / 255 | 0;
    const xs = [0, 0, 0, 0], ys = [0, 0, 0, 0], sc = mix(col, C_WHITE, 40), pc = mix(col, C_WHITE, 110), glow = tent(u - 5600, 500) * 40 / 255 | 0;
    tetPlace(xs, ys, 0, x, y, ang);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3), r = b_row[i];
        let a = tetStack(r, p) ? tet_sh[r - 4] + glow : 0, c = sc;
        const v = tetAt(p, q, xs, ys, 4) * g / 255 | 0;
        if (v > a) { a = v; c = pc; }
        put(i, c, a * k / 255 | 0);
    }
}

// Думает · Ливень: pieces rain into three columns, each falling in 0.6 s and flashing as it goes into the stack; violet
const tet_lx = [-44, 4, 44], tet_la = [0, 43, 128];
export function tetThink(n, t, col, k) {
    if (k <= 0) return;
    const pc = mix(col, C_VIOLET, 140), sc = mix(col, C_WHITE, 40), xs = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], ys = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], fl = [0, 0, 0];
    for (let m = 0; m < 3; m++) {
        const u = posMod(t - m * 300, 900);
        tetPlace(xs, ys, 4 * m, tet_lx[m], u < 600 ? -42 + (42 * u * u / 360000 | 0) : -99, tet_la[m]);
        fl[m] = tent(u - 650, 150);
    }
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3), r = b_row[i];
        let a = 0, c = sc;
        if (tetStack(r, p)) {
            const m = p < -20 ? 0 : p < 24 ? 1 : 2, fv = fl[m] * tent(p - tet_lx[m], 24) / 255 | 0;
            a = imax(tet_sh[r - 4], fv);
            if (fv) c = mix(sc, C_WHITE, fv * 150 / 255 | 0);
        }
        const v = tetAt(p, q, xs, ys, 12);
        if (v > a) { a = v; c = pc; }
        put(i, c, a * k / 255 | 0);
    }
}

// Говорит · Верхний ряд: the top of the stack lights with the voice, from the middle out; when loud, a glow rises over it
export function tetSpeak(n, t, col, k) {
    if (k <= 0) return;
    const v = [voice(t), voice(t - 90), voice(t - 180)], sc = mix(col, C_WHITE, 40);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), r = b_row[i], e = v[abs(p) < 28 ? 0 : abs(p) < 56 ? 1 : 2];
        let a = 0, c = sc;
        if (tetStack(r, p)) {
            a = tet_sh[r - 4] * 3 >> 2;
            if (!tetStack(r - 1, p - 4) && !tetStack(r - 1, p + 4)) {  // a top block: nothing over it
                a = 90 + (165 * e / 255 | 0);
                c = mix(col, C_WHITE, 60 + (120 * e / 255 | 0));
            }
        } else if (r >= 3 && (tetStack(r + 1, p - 4) || tetStack(r + 1, p + 4))) {
            a = imax(0, e - 150) * 110 / 105 | 0;  // just over the top, only when loud
            c = col;
        }
        put(i, c, a * k / 255 | 0);
    }
}

// Готово · Линия: a block falls into the gap of the bottom row; the full row flashes white and melts from the gap outwards;
// the stack over it drops a row
export function tetDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t), y = t < 450 ? -28 + (49 * t * t / 202500 | 0) : 21, x = 24 + (abs(posMod(y, 14) - 7) * 4 / 7 | 0);
    const fl = smooth(430, 520, t) * (255 - smooth(700, 1000, t)) / 255 | 0, e = smooth(1000, 1250, t), sc = mix(col, C_WHITE, 40), bc = mix(col, C_WHITE, 90);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3), r = b_row[i];
        let a = 0, c = sc;
        if (r === 6 && (tetStack(6, p) || t >= 450)) {  // the bottom row, full once the block is in: white, then gone from the gap out
            const g = 255 - smooth(700 + abs(p - 24) * 3, 820 + abs(p - 24) * 3, t);
            a = imax(tet_sh[2], fl) * g / 255 | 0;
            if (fl) c = mix(sc, C_WHITE, fl * 200 / 255 | 0);
        }
        if (r >= 4) {  // rows 4–5 as they are, and one row lower (down-left) as e goes to 255
            const here = r < 6 && tetStack(r, p) ? tet_sh[r - 4] : 0, up = r > 4 && tetStack(r - 1, p + 4) ? tet_sh[r - 5] : 0;
            const s = (here * (255 - e) + up * e) / 255 | 0;
            if (s > a) { a = s; c = sc; }
        }
        if (t < 450) {
            const v = tent(oct(p - x, q - y), 8);
            if (v > a) { a = v; c = bc; }
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// Ошибка · Конец игры: the stack grows row after row up to the top; the full display flashes, then empties from the top down
export function tetError(n, t, du, col) {
    const fo = smooth(du, du - 300, t), fl = tent(t - 900, 160), sc = mix(col, C_WHITE, 40), wc = mix(sc, C_WHITE, 170 * fl / 255 | 0);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), r = b_row[i], up = (6 - r) * 120;
        let a = imax(tetStack(r, p) ? tet_sh[r - 4] : 0, (210 - r * 10) * smooth(up, up + 140, t) / 255 | 0);
        a = imax(a, fl * 230 / 255 | 0) * (255 - smooth(1050 + r * 70, 1250 + r * 70, t)) / 255 | 0;
        put(i, wc, a * fo / 255 | 0);
    }
}

// Уведомление · Новая фигура: a piece appears at the top and blinks three times, whiter on each blink, over a dim stack
export function tetNotify(n, t, du, col) {
    const fo = smooth(du, du - 300, t), b = imax(imax(tent(t - 200, 200), tent(t - 600, 200)), tent(t - 1000, 200)), g = smooth(0, 120, t);
    const xs = [0, 0, 0, 0], ys = [0, 0, 0, 0], pc = mix(col, C_WHITE, 150 * b / 255 | 0), a0 = (90 + (165 * b / 255 | 0)) * g / 255 | 0;
    tetPlace(xs, ys, 0, 0, -21, 128);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3), r = b_row[i];
        let a = tetStack(r, p) ? tet_sh[r - 4] >> 2 : 0, c = col;
        const v = tetAt(p, q, xs, ys, 4) * a0 / 255 | 0;
        if (v > a) { a = v; c = pc; }
        put(i, c, a * fo / 255 | 0);
    }
}

// ================= 15 · Механизм: it is a clock, so gears: two big wheels meshed in the middle, a pinion at each edge =================

// a gear on the axle ball (x0 half-balls across, row r0): its teeth on the hex ring R balls out (6R balls, a clean loop on this
// grid) with a dim rim between them, a bar across the ring 1 out (on the big wheels), the axle; turned by th (256 a turn): 0..255
export function gear(i, x0, r0, R, N, th) {
    const dr = b_row[i] - r0, dx = b_x[i] - x0, ar = abs(dr), ax = abs(dx), h = ar >= ax ? ar : (ax + ar) >> 1;  // the hex distance, balls
    if (h > R) return 0;
    if (!h) return 255;  // the axle
    const a = pang(4 * dx, 7 * dr) + th;
    if (h === R) {  // the ring: a tooth, or the rim between two
        const v = (a * N) & 255, w = v < 128 ? v : 256 - v;
        return 50 + (smooth(80, 36, w) * 190 / 255 | 0);
    }
    if (h > 1) return 0;
    const s = (a * 2) & 255, ws = s < 128 ? s : 256 - s;  // the bar: two spokes
    return smooth(48, 16, ws) * 160 / 255 | 0;
}

// the mechanism at ball i: two big wheels (6 teeth on rings of 18 balls) round the balls 3 to each side of the middle, meshed
// where they touch, and a pinion (2 teeth on 6 balls) at each edge, three times as fast; th turns the left wheel, the rest follow
export function gears(i, th) {
    const x = b_x[i];
    if (x < 5) return gear(i, 2, 3, 1, 2, 64 - 3 * th) * 190 / 255 | 0;
    if (x < 19) return gear(i, 12, 3, 3, 6, th);
    if (x < 34) return gear(i, 26, 3, 3, 6, 21 - th);
    return gear(i, 36, 3, 1, 2, 1 + 3 * th) * 190 / 255 | 0;
}

// Пробуждение · Завод: the big wheels come up, then the pinions, and the mechanism starts to turn, speeding up to the listening's pace
// (the angle −21 + 21·t²/du² ends where the listening starts, at its speed)
export function gearWake(n, t, du, col) {
    const fo = smooth(du, du - 400, t), al = (21 * t * t / 4000000 | 0) - 21, g0 = smooth(0, 450, t), g1 = smooth(350, 850, t), wc = mix(col, C_WHITE, 140);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const x = b_x[i], a = gears(i, al) * (x < 5 || x >= 34 ? g1 : g0) / 255 | 0;
        put(i, a > 240 ? wc : col, a * fo / 255 | 0);
    }
}

// Слушает · Ход: the gears turn slowly, meshed (a big wheel 12 s a turn, the pinions three times faster); a soft light breathes on them
export function gearListen(n, t, col, k) {
    if (k <= 0) return;
    const th = t * 256 / 12000 | 0, br = 215 + (wave(t, 45) * 40 / 128 | 0), wc = mix(col, C_WHITE, 140);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const a = gears(i, th);
        put(i, a > 240 ? wc : col, (a * br / 255 | 0) * k / 255 | 0);
    }
}

// Думает · Быстрый ход: the same gears spin fast (1.5 s a turn of a big wheel); violet
export function gearThink(n, t, col, k) {
    if (k <= 0) return;
    const c = mix(col, C_VIOLET, 128), wc = mix(c, C_WHITE, 140), th = t * 256 / 1500 | 0;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const a = gears(i, th);
        put(i, a > 240 ? wc : c, a * k / 255 | 0);
    }
}

// Говорит · Тик: the mechanism ticks with the voice: the gears jerk forward on its peaks (up to a third of a tooth) and glow brighter
export function gearSpeak(n, t, col, k) {
    if (k <= 0) return;
    const v = voice(t), th = (t * 256 / 12000 | 0) + (v * 14 / 255 | 0);
    const br = 140 + (v * 115 / 255 | 0), c = mix(col, C_WHITE, v * 60 / 255 | 0), wc = mix(col, C_WHITE, 80 + (v * 120 / 255 | 0));
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const a = gears(i, th);
        put(i, a > 240 ? wc : c, (a * br / 255 | 0) * k / 255 | 0);
    }
}

// Готово · Щелчок: the gears turn a quarter, overshoot a little and click into place; a chime: a flash and a ring from where they mesh
export function gearDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t), g = smooth(0, 150, t), th = (70 * smooth(0, 520, t) - 6 * smooth(520, 640, t)) / 255 | 0;
    const fl = tent(t - 600, 220), e = t - 600, rr = e * 110 / 1000 | 0, rf = e > 0 ? 255 - smooth(0, 800, e) : 0;
    const c = mix(col, C_WHITE, 150 * fl / 255 | 0), wc = mix(col, C_WHITE, 180);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = (gears(i, th) * (170 + (85 * fl / 255 | 0)) / 255 | 0) * g / 255 | 0, cc = a > 240 ? wc : c;
        if (rf) {
            const v = tent(oct(p, q) - rr, 7) * rf / 255 | 0;
            if (v > a) { a = v; cc = wc; }
        }
        put(i, cc, a * fo / 255 | 0);
    }
}

// Ошибка · Заклинило: the gears turn, then jam (0.35 s): they shake on the spot, sparks where the teeth meet, the mechanism dims
export function gearError(n, t, du, col) {
    const fo = smooth(du, du - 300, t), sh = (wave(t, 2000) * 5 / 128 | 0) * (255 - smooth(350, 1100, t)) / 255 | 0;
    const th = (imin(t, 350) * 256 / 2000 | 0) + (t > 350 ? sh : 0), sp = tent(t - 380, 250), wc = mix(col, C_WHITE, 170), g = 255 - (110 * smooth(500, 1200, t) / 255 | 0);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = gears(i, th) * g / 255 | 0, c = a > 240 ? wc : col;
        const v = tent(imin(oct(p, q), oct(abs(p) - 56, q)), 12) * sp / 255 | 0;  // the sparks where the teeth jam
        if (v > a) { a = v; c = wc; }
        put(i, c, a * fo / 255 | 0);
    }
}

// Уведомление · Кукушка: over the still mechanism a door opens at the top between the wheels and the cuckoo pops out twice;
// a soft ring on each «ку»
export function gearNotify(n, t, du, col) {
    const fo = smooth(du, du - 300, t), u = t < 650 ? t - 100 : t - 750;  // the two pops, 500 ms each
    const y = -34 + ((22 * smooth(0, 130, u) + 5 * tent(u - 170, 90) - 22 * smooth(330, 480, u)) / 255 | 0);
    const rr = imax(0, u - 150) * 80 / 1000 | 0, rf = u > 150 ? 255 - smooth(150, 500, u) : 0, wc = mix(col, C_WHITE, 170), dr = 40 + (100 * smooth(-34, -24, y) / 255 | 0);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = gears(i, 0) * 50 / 255 | 0, c = col;
        if (q === -21 && abs(p) <= 12) a = imax(a, dr);  // the door
        if (rf) a = imax(a, tent(oct(p, q - y) - 14 - rr, 6) * rf / 400 | 0);
        const v = tent(oct(p, q - y), 12);
        if (v > a) { a = v; c = tent(oct(p - 7, q - y + 3), 7) > 150 ? wc : col; }  // the beak whiter
        put(i, c, a * fo / 255 | 0);
    }
}

// ================= 16 · Неон: neon tubes in the dark: a white-hot core, a faint glow round it =================
// the sign's frame is the rim, its second tube (pink) the ring inside
const C_PINK = 0xff3fa8;

// a tube d (1/8 ball) from its line: the core (d < 3), a faint glow round it to 11: 0..255
export function neon(d) {
    return d < 3 ? 255 : d < 11 ? (11 - d) * 70 / 8 | 0 : 0;
}

// the circuit: a closed trace along the grid's lines (0° and 60°): its corners (p, q) and the lengths of its sides (272 in all)
const neon_pt = [-44, -14, 44, -14, 56, 7, 16, 7, 12, 0, -20, 0, -28, 14, -60, 14], neon_len = [88, 24, 40, 8, 32, 16, 32, 32];
// the circuit at (p, q) with its bright head at h along it, a cooling trail 150 behind: 0..255
export function neonTrace(p, q, h) {
    let best = 0, at = 0;
    for (let j = 0; j < 8; j++) {
        const x0 = neon_pt[2 * j], y0 = neon_pt[2 * j + 1], x1 = neon_pt[(2 * j + 2) & 15], y1 = neon_pt[(2 * j + 3) & 15];
        if (p >= imin(x0, x1) - 10 && p <= imax(x0, x1) + 10) {
            const dx = x1 - x0, dy = y1 - y0;
            let u = ((p - x0) * dx + (q - y0) * dy) * 256 / (dx * dx + dy * dy) | 0;
            u = u < 0 ? 0 : u > 256 ? 256 : u;
            const d = oct(p - x0 - (dx * u / 256 | 0), q - y0 - (dy * u / 256 | 0));
            if (d < 11) {
                const e = posMod(h - at - (neon_len[j] * u >> 8), 272), w = e < 150 ? (150 - e) * 255 / 150 | 0 : 0;
                best = imax(best, neon(d) * (w * w / 255 | 0) / 255 | 0);
            }
        }
        at += neon_len[j];
    }
    return best;
}

// Пробуждение · Зажигание: the frame stutters twice, then the light runs round it from 12 o'clock both ways (white at its front);
// the pink tube catches with its own stutter
export function neonWake(n, t, du, col) {
    const fo = smooth(du, du - 400, t), fc = mix(col, C_WHITE, 110), hc = mix(col, C_WHITE, 220), pc = mix(C_PINK, C_WHITE, 90);
    const st = imax(tent(t - 130, 60) * 150 / 255 | 0, tent(t - 300, 50) * 200 / 255 | 0), fs = smooth(430, 800, t), n0 = ring_len[0];
    const g2 = imax(imax(tent(t - 920, 60) * 150 / 255 | 0, tent(t - 1060, 50) * 200 / 255 | 0), 120 * smooth(1150, 1300, t) / 255 | 0);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const r = ringOf(i);
        if (r === 0) {
            const m = imin(b_pos[i], n0 - b_pos[i]), F = (n0 / 2 + 3) * fs / 255 | 0;
            put(i, fs < 255 && m >= F - 3 && m < F ? hc : fc, imax(st, m < F ? 185 : 0) * fo / 255 | 0);
        } else if (r === 2) put(i, pc, g2 * fo / 255 | 0);
    }
}

// Слушает · Гул: the sign hums: the frame burns evenly, two slightly brighter zones creep round it (6.4 s); the pink tube breathes;
// dark between them
export function neonListen(n, t, col, k) {
    if (k <= 0) return;
    const n0 = ring_len[0], fc = mix(col, C_WHITE, 110), pc = mix(C_PINK, C_WHITE, 90), g2 = 120 + (wave(t, 37) * 30 / 128 | 0);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const r = ringOf(i);
        if (r === 0) put(i, fc, (185 + (psin((b_pos[i] * 512 / n0 | 0) - (t * 40 / 1000 | 0)) * 30 / 128 | 0)) * k / 255 | 0);
        else if (r === 2) put(i, pc, g2 * k / 255 | 0);
    }
}

// Думает · Схема: a bright head runs round a closed circuit trace, a cooling trail behind it: the circuit keeps tracing itself; violet
export function neonThink(n, t, col, k) {
    if (k <= 0) return;
    const c = mix(col, C_VIOLET, 128), wc = mix(c, C_WHITE, 150), h = t * 120 / 1000 | 0;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const v = neonTrace(4 * (b_x[i] - 19), 7 * (b_row[i] - 3), h);
        put(i, v > 200 ? wc : c, v * k / 255 | 0);
    }
}

// Говорит · Пульс трубок: both tubes beat with the voice, the frame at once, the pink one a beat later; loud, the cores go white
export function neonSpeak(n, t, col, k) {
    if (k <= 0) return;
    const v = voice(t), v2 = voice(t - 120), fc = mix(col, C_WHITE, 60 + (v * 120 / 255 | 0)), pc = mix(C_PINK, C_WHITE, 40 + (v2 * 120 / 255 | 0));
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const r = ringOf(i);
        if (r === 0) put(i, fc, (70 + (v * 185 / 255 | 0)) * k / 255 | 0);
        else if (r === 2) put(i, pc, (50 + (v2 * 205 / 255 | 0)) * k / 255 | 0);
    }
}

// Готово · Неоновая галочка: a check of tube along the grid's lines catches with two stutters, burns with a white core and flashes
const neon_ck = [-16, -7, -4, 14, 16, -21];
export function neonDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t), s = imax(imax(tent(t - 110, 50) * 160 / 255 | 0, tent(t - 250, 50) * 210 / 255 | 0), smooth(360, 440, t)), fl = tent(t - 700, 250);
    const s1 = [neon_ck[0], neon_ck[1], neon_ck[2], neon_ck[3]], s2 = [neon_ck[2], neon_ck[3], neon_ck[4], neon_ck[5]], cc = mix(col, C_WHITE, 90 + (120 * fl / 255 | 0));
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3), d = imin(segDist(p, q, s1, 256), segDist(p, q, s2, 256));
        put(i, d < 3 ? cc : col, (neon(d) * s / 255 | 0) * fo / 255 | 0);
    }
}

// Ошибка · Искрит: the frame sparks at the top right, three white sparks, the tube by them stutters; then it dies from there
// both ways round, and the pink tube goes out with a last flicker
export function neonError(n, t, du, col) {
    const fo = smooth(du, du - 300, t), D = 140 * smooth(650, 1250, t) / 255 | 0, sk = imax(imax(tent(t - 220, 60), tent(t - 390, 50)), tent(t - 560, 70));
    const fc = mix(col, C_WHITE, 110), pc = mix(C_PINK, C_WHITE, 90), g2 = 120 - (120 * smooth(750, 950, t) / 255 | 0) + (tent(t - 1000, 50) * 90 / 255 | 0), dip = 255 - (sk >> 1);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3), r = ringOf(i), da = abs(((b_ang[i] - 44 + 128) & 255) - 128);
        let a = 0, c = col;
        if (r === 0) {
            a = 185 * (da < D ? 0 : da < D + 12 ? (da - D) * 255 / 12 | 0 : 255) / 255 | 0;
            if (da < 24) a = a * dip / 255 | 0;
            c = fc;
        } else if (r === 2) { a = g2; c = pc; }
        const v = tent(oct(p - 44, q + 21), 12) * sk / 255 | 0;
        if (v > a) { a = v; c = C_WHITE; }
        put(i, c, a * fo / 255 | 0);
    }
}

// Уведомление · Стрелка: a neon arrow to the right blinks three times, stepping a ball forward on each blink
const neon_ar = [-36, 0, 20, 0, 12, -14, 20, 0, 12, 14, 20, 0];
export function neonNotify(n, t, du, col) {
    const fo = smooth(du, du - 300, t), j = t < 380 ? 0 : t < 760 ? 1 : 2, u = t - j * 380, dx = j * 8;
    const g = smooth(0, 50, u) * (j < 2 ? smooth(300, 250, u) : 255) / 255 | 0, cc = mix(col, C_WHITE, 120), s = [0, 0, 0, 0];
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let d = 99;
        for (let m = 0; m < 3; m++) {
            s[0] = neon_ar[4 * m] + dx; s[1] = neon_ar[4 * m + 1]; s[2] = neon_ar[4 * m + 2] + dx; s[3] = neon_ar[4 * m + 3];
            d = imin(d, segDist(p, q, s, 256));
        }
        put(i, d < 3 ? cc : col, (neon(d) * g / 255 | 0) * fo / 255 | 0);
    }
}

// ================= 17 · Маятник: physics: a pendulum hung above the top edge =================
// at (x, −45), 53 long: the bob hangs in the middle of row 4

// the bob of a pendulum hung at px, turned by th (256 a turn, + to the right)
export function pendX(px, th) { return px + (53 * psin(th) / 128 | 0); }
export function pendY(th) { return -45 + (53 * pcos(th) / 128 | 0); }

// Пробуждение · Толчок: the pendulum fades in hanging still; at 0.35 s a push (a ring off the bob) and it swings wider and wider
// into the listening's swing (its phase, the amplitude growing)
export function pendWake(n, t, du, col) {
    const fo = smooth(du, du - 400, t), g = smooth(0, 300, t), e = smooth(350, 1700, t), fl = tent(t - 380, 160);
    const th = (wave(t - du, 91) * 28 / 128 | 0) * e / 255 | 0, bx = pendX(0, th), by = pendY(th), s = [0, -45, bx, by];
    const rr = imax(0, t - 350) * 70 / 1000 | 0, rf = t > 350 ? 255 - smooth(350, 900, t) : 0, hc = mix(col, C_WHITE, 90 + (fl * 150 / 255 | 0));
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = tent(segDist(p, q, s, 256), 5) * 40 / 255 | 0, c = col;
        const d = oct(p - bx, q - by), v = tent(d, 10);
        if (rf) a = imax(a, tent(d - 10 - rr, 6) * rf / 300 | 0);
        if (v > a) { a = v; c = d < 4 ? hc : col; }
        put(i, c, (a * g / 255 | 0) * fo / 255 | 0);
    }
}

// Слушает · Качание: one pendulum swings slowly (2.8 s there and back, ±39°) with a soft trail; the string glows faintly
export function pendListen(n, t, col, k) {
    if (k <= 0) return;
    const bx = [0, 0, 0], by = [0, 0, 0], wc = mix(col, C_WHITE, 150), s = [0, -45, 0, 0];
    for (let m = 0; m < 3; m++) {
        const th = wave(t - m * 70, 91) * 28 / 128 | 0;
        bx[m] = pendX(0, th);
        by[m] = pendY(th);
    }
    s[2] = bx[0]; s[3] = by[0];
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = tent(segDist(p, q, s, 256), 5) * 40 / 255 | 0, c = col;
        for (let m = 0; m < 3; m++) {
            const d = oct(p - bx[m], q - by[m]), v = tent(d, m ? 8 : 10) * (m ? 120 - m * 40 : 255) / 255 | 0;
            if (v > a) { a = v; c = !m && d < 4 ? wc : col; }
        }
        put(i, c, a * k / 255 | 0);
    }
}

// Думает · Колыбель Ньютона: five balls hang in a row; the right one swings out on its string and clicks back, the left one flies out; violet
export function pendThink(n, t, col, k) {
    if (k <= 0) return;
    const c = mix(col, C_VIOLET, 128), s = posMod(t, 1200), ln = [0, -45, 0, 0];
    const thR = s < 600 ? psin(s * 128 / 600 | 0) * 24 / 128 | 0 : 0, thL = s >= 600 ? -(psin((s - 600) * 128 / 600 | 0) * 24 / 128 | 0) : 0;
    const ck = imax(imax(tent(s, 90), tent(s - 600, 90)), tent(s - 1200, 90)), wc = mix(c, C_WHITE, 200 * ck / 255 | 0), hc = mix(c, C_WHITE, 90);
    const j = s < 600 ? 4 : 0, th = j ? thR : thL, mx = pendX(-32 + 16 * j, th), my = pendY(th);  // the ball that swings now
    ln[0] = -32 + 16 * j; ln[2] = mx; ln[3] = my;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = th ? tent(segDist(p, q, ln, 256), 4) * 36 / 255 | 0 : 0, cc = c;  // its string
        for (let b = 0; b < 5; b++) {
            const x = b === j ? mx : -32 + 16 * b, y = b === j ? my : 7, d = oct(p - x, q - y);
            if (d < 8) {
                const v = tent(d, 8);
                if (v > a) { a = v; cc = d < 4 ? (b && b < 4 ? wc : hc) : c; }
            }
        }
        put(i, cc, a * k / 255 | 0);
    }
}

// Говорит · Прыжки: the five balls on their strings jump with the voice: the middle one at once, its neighbours a beat and two later
export function pendSpeak(n, t, col, k) {
    if (k <= 0) return;
    const v = [voice(t - 140), voice(t - 70), voice(t)], wc = mix(col, C_WHITE, 160);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = 0, c = col;
        for (let j = 0; j < 5; j++) {
            const e = v[j < 2 ? j : 4 - j], x = -32 + 16 * j, y = 7 - (e * 16 / 255 | 0);
            if (q < y - 4 && p === x) a = imax(a, 24);  // the string, straight up
            const d = oct(p - x, q - y), w = tent(d, 8) * (150 + (e * 105 / 255 | 0)) / 255 | 0;
            if (w > a) { a = w; c = d < 4 && e > 150 ? wc : col; }
        }
        put(i, c, a * k / 255 | 0);
    }
}

// Готово · В такт: all five balls swing out to the right together and come back as one; the click: a flash and a ring
export function pendDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t), g = smooth(0, 150, t), th = t < 900 ? psin(t * 128 / 900 | 0) * 26 / 128 | 0 : 0, fl = tent(t - 920, 240);
    const ox = pendX(0, th), y = pendY(th), rr = imax(0, t - 900) * 90 / 1000 | 0, rf = t > 900 ? 255 - smooth(900, 1500, t) : 0;
    const wc = mix(col, C_WHITE, 170), hc = mix(col, C_WHITE, 60 + (150 * fl / 255 | 0)), s = [0, -45, 0, y];
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = 0, c = col;
        for (let j = 0; j < 5; j++) {
            const x0 = -32 + 16 * j, x = x0 + ox;
            if (th) { s[0] = x0; s[2] = x; a = imax(a, tent(segDist(p, q, s, 256), 4) * 30 / 255 | 0); }
            const d = oct(p - x, q - y), v = tent(d, 8) * (170 + (85 * fl / 255 | 0)) / 255 | 0;
            if (v > a) { a = v; c = d < 4 || fl > 120 ? hc : col; }
        }
        if (rf) {
            const v = tent(oct(p, q - 7) - rr, 7) * rf / 255 | 0;
            if (v > a) { a = v; c = wc; }
        }
        put(i, c, (a * g / 255 | 0) * fo / 255 | 0);
    }
}

// Ошибка · Обрыв: the pendulum swings down from the left; near the bottom (0.6 s) the string snaps with a white flash and the ball
// flies on to the right and falls off the bottom edge; the stub of the string fades
export function pendError(n, t, du, col) {
    const fo = smooth(du, du - 300, t), g = smooth(0, 100, t), th = -(28 * pcos(imin(t, 600) * 128 / 1400 | 0) / 128 | 0), sx = pendX(0, th), sy = pendY(th), w = t - 600;
    const bx = w > 0 ? sx + (w * 82 / 1000 | 0) : sx, by = w > 0 ? sy + (w * 12 / 1000 | 0) + (w * w * 64 / 1000000 | 0) : sy;
    const sg = w > 0 ? 40 * (255 - smooth(0, 500, w)) / 255 | 0 : 40, s = [0, -45, w > 0 ? sx >> 1 : sx, w > 0 ? (sy - 45) >> 1 : sy], fl = w >= 0 ? tent(w, 160) : 0, wc = mix(col, C_WHITE, 170), hc = mix(col, C_WHITE, 90);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = sg ? tent(segDist(p, q, s, 256), 5) * sg / 255 | 0 : 0, c = col;
        if (fl) {
            const v = tent(oct(p - s[2], q - s[3]), 10) * fl / 255 | 0;
            if (v > a) { a = v; c = wc; }
        }
        const d = oct(p - bx, q - by), v = tent(d, 10);
        if (v > a) { a = v; c = d < 4 ? hc : col; }
        put(i, c, (a * g / 255 | 0) * fo / 255 | 0);
    }
}

// Уведомление · Тик-так: the pendulum gives two quick short swings, right and left; a «tick» at each end: the bob whitens, a faint ring
export function pendNotify(n, t, du, col) {
    const fo = smooth(du, du - 300, t), g = smooth(0, 120, t);
    const th = t < 300 ? psin(t * 128 / 300 | 0) * 18 / 128 | 0 : t >= 350 && t < 650 ? -(psin((t - 350) * 128 / 300 | 0) * 18 / 128 | 0) : 0;
    const tk = imax(tent(t - 150, 110), tent(t - 500, 110)), bx = pendX(0, th), by = pendY(th), s = [0, -45, bx, by], hc = mix(col, C_WHITE, 60 + (tk * 150 / 255 | 0));
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = tent(segDist(p, q, s, 256), 5) * 40 / 255 | 0, c = col;
        const d = oct(p - bx, q - by), v = tent(d, 10);
        a = imax(a, tent(d - 14, 5) * tk / 400 | 0);
        if (v > a) { a = v; c = d < 4 ? hc : col; }
        put(i, c, (a * g / 255 | 0) * fo / 255 | 0);
    }
}

// ================= 18 · Гирлянда: the balls as string lights: 11 bulbs on a sagging wire, each in its own colour, Kaya's among them =================
const gar_b = [-64, -21, -52, -14, -40, -7, -28, 0, -16, 7, 0, 7, 16, 7, 28, 0, 40, -7, 52, -14, 64, -21];  // the bulbs, (p, q), each on a ball
const gar_pal = [0, 0xffa83a, 0xff4f6e, 0x7fe05a];  // by k & 3: 0 = Kaya's colour, warm amber, rose, green
const gar_ph = [0, 140, 60, 200, 100, 30, 170, 90, 220, 120, 45], gar_sp = [57, 43, 64, 50, 39, 61, 47, 55, 41, 66, 52];  // each bulb's phase and pace
const C_WIRE = 0xffe2b0, C_WARM = 0xfff0d8;

// bulb k's own colour (c0: the colour of every fourth, Kaya's in the states)
export function garCol(k, c0) { const j = k & 3; return j ? gar_pal[j] : c0; }

// the garland at ball i: the wire at brightness w between the bulbs; bulb k lights its own ball at g[k] in cb[k];
// no halo, so neighbouring colours never mix
export function garPut(i, p, q, g, cb, w, k) {
    const s = [0, 0, 0, 0];
    let j = 0, a = 0, c = C_WIRE;
    while (j < 9 && p >= gar_b[2 * j + 2]) j++;
    if (w && p >= -64 && p <= 64) {
        s[0] = gar_b[2 * j]; s[1] = gar_b[2 * j + 1]; s[2] = gar_b[2 * j + 2]; s[3] = gar_b[2 * j + 3];
        a = tent(segDist(p, q, s, 256), 5) * w / 255 | 0;
    }
    for (let m = j; m <= j + 1; m++) {  // the two bulbs round it
        if (oct(p - gar_b[2 * m], q - gar_b[2 * m + 1]) < 4 && g[m] > a) { a = g[m]; c = cb[m]; }
    }
    put(i, c, a * k / 255 | 0);
}

// Пробуждение · По цепочке: the wire glows first, then the bulbs light one after another from the left, each with a white flash
export function garWake(n, t, du, col) {
    const fo = smooth(du, du - 400, t), g = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], cb = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let m = 0; m < 11; m++) {
        const u = t - 200 - m * 100;
        g[m] = u < 0 ? 0 : smooth(0, 80, u) * (255 - (70 * smooth(100, 450, u) / 255 | 0)) / 255 | 0;
        cb[m] = mix(garCol(m, col), C_WHITE, 60 + (160 * tent(u - 80, 150) / 255 | 0));
    }
    fr.dg = 128;
    const w = 18 * smooth(0, 250, t) / 255 | 0;
    for (let i = 0; i < MX_LED_AMOUNT; i++) garPut(i, 4 * (b_x[i] - 19), 7 * (b_row[i] - 3), g, cb, w, fo);
}

// Слушает · Мерцание: every bulb breathes slowly at its own pace (3.9–6.6 s), the wire faintly warm
export function garListen(n, t, col, k) {
    if (k <= 0) return;
    const g = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], cb = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let m = 0; m < 11; m++) {
        const s = sin8((gar_ph[m] + (t * gar_sp[m] / 1000 | 0)) & 255);
        g[m] = 120 + ((s * s / 255 | 0) * 135 / 255 | 0);
        cb[m] = mix(garCol(m, col), C_WHITE, 60);
    }
    for (let i = 0; i < MX_LED_AMOUNT; i++) garPut(i, 4 * (b_x[i] - 19), 7 * (b_row[i] - 3), g, cb, 18, k);
}

// Думает · Бегущие огни: a chase runs along the string: every third bulb is lit and the light flows on to the next, 6 bulbs a second
export function garThink(n, t, col, k) {
    if (k <= 0) return;
    // (v1.9: h moves 768, a whole round of the pattern, every 500 ms, so t goes in modulo 500: the same frames, and
    // t · 1536 never overflows a 32-bit int in a long state)
    const h = posMod(t, 500) * 1536 / 1000 | 0, g = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], cb = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let m = 0; m < 11; m++) {
        const ph = posMod(m * 256 - h, 768), w = imin(ph, 768 - ph);
        g[m] = 20 + (235 * smooth(256, 0, w) / 255 | 0);
        cb[m] = mix(garCol(m, col), C_WHITE, 40 + (110 * smooth(160, 0, w) / 255 | 0));
    }
    for (let i = 0; i < MX_LED_AMOUNT; i++) garPut(i, 4 * (b_x[i] - 19), 7 * (b_row[i] - 3), g, cb, 18, k);
}

// Говорит · Вспышки: the bulbs flare with the voice, from the middle out to the ends
export function garSpeak(n, t, col, k) {
    if (k <= 0) return;
    const v = [voice(t), voice(t - 80), voice(t - 160)], g = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], cb = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let m = 0; m < 11; m++) {
        const e = v[abs(m - 5) >> 1];
        g[m] = 70 + (e * 185 / 255 | 0);
        cb[m] = mix(garCol(m, col), C_WHITE, 40 + (e * 140 / 255 | 0));
    }
    for (let i = 0; i < MX_LED_AMOUNT; i++) garPut(i, 4 * (b_x[i] - 19), 7 * (b_row[i] - 3), g, cb, 18, k);
}

// Готово · Праздник: the whole garland flashes green and white, then sparkles: bulb by bulb they flare to white
export function garDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t), fl = 255 - smooth(150, 450, t), on = smooth(0, 60, t), g = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], cb = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let m = 0; m < 11; m++) {
        const s = sin8((gar_ph[m] + (t * gar_sp[m] * 5 / 1000 | 0)) & 255), tw = s * s / 255 | 0;
        g[m] = imax(fl, 100 + (tw * 155 / 255 | 0)) * on / 255 | 0;
        cb[m] = mix(col, C_WHITE, imax(fl * 200 / 255 | 0, tw * 170 / 255 | 0));
    }
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) garPut(i, 4 * (b_x[i] - 19), 7 * (b_row[i] - 3), g, cb, 30, fo);
}

// Ошибка · Перегорела: the middle bulb blows with a white pop (a ring of sparks) and smoulders red; the garland goes dark from it
// to the ends, each bulb reddening and going out
export function garError(n, t, du, col) {
    const fo = smooth(du, du - 300, t), on = smooth(0, 80, t), pop = tent(t - 300, 120), rr = imax(0, t - 300) * 70 / 1000 | 0, rf = t > 300 ? 255 - smooth(300, 750, t) : 0;
    const g = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], cb = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], pc = mix(col, C_WHITE, 120), wl = 18 * (255 - smooth(900, 1400, t)) / 255 | 0;
    for (let m = 0; m < 11; m++) {
        if (m === 5) {
            g[m] = imax(pop, t < 300 ? 185 : 90 * (255 - smooth(400, 1000, t)) / 255 | 0);
            cb[m] = mix(t < 300 ? garCol(5, C_WARM) : col, C_WHITE, imax(60, 230 * pop / 255 | 0));
        } else {
            const T = 450 + abs(m - 5) * 110;
            g[m] = 185 * (255 - smooth(T + 80, T + 260, t)) / 255 | 0;
            cb[m] = mix(mix(garCol(m, C_WARM), col, smooth(T - 80, T + 60, t)), C_WHITE, 50);
        }
        g[m] = g[m] * on / 255 | 0;
    }
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        garPut(i, p, q, g, cb, wl, fo);
        if (rf) put(i, pc, (tent(oct(p, q - 7) - rr, 6) * rf / 255 | 0) * fo / 255 | 0);
    }
}

// Уведомление · Двойной бег: a bright light runs along the garland from left to right twice, fast, with a tail; then all of it blinks amber
export function garNotify(n, t, du, col) {
    const fo = smooth(du, du - 300, t), j = t < 550 ? 0 : 1, u = t - j * 550, h = u < 480 ? u * 3072 / 450 | 0 : 99999, all = tent(t - 1150, 220), on = smooth(0, 80, t);
    const g = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], cb = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let m = 0; m < 11; m++) {
        const d = h - m * 256, v = d >= -128 && d < 768 ? tent(d, d < 0 ? 128 : 768) : 0, e = imax(v, all);
        g[m] = imax(45, e) * on / 255 | 0;
        cb[m] = mix(mix(garCol(m, C_WARM), col, e), C_WHITE, 40 + (e * 150 / 255 | 0));
    }
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) garPut(i, 4 * (b_x[i] - 19), 7 * (b_row[i] - 3), g, cb, 16, fo);
}
