// Kaya's styles of v1.9, part 1: the owner's picks from catalog A (KAIA-201, «природа и волшебство»), taken whole.
// As styles.js: a style is a whole visual language, its own version of all 7 events; kaia_anim 10–12 picks one as the
// style, and its versions join every event's gallery (looks 15–17, wakes 21–23; looks.js look_style, wakes.js wake_style).
//   10 Снежинка, 11 Светлячки, 12 Пламя (the catalog's default: the cold flame in Kaya's colour)
// The wakes fade out over their last 400 ms (wakeDraw fades the listening in under their last 800), the other
// one-shots over their last 300 ms; the states loop.
//
// For the firmware: as styles.js, every function here is meant to be copied line by line into kaia.cpp. Integers only
// inside a frame; "x / y | 0" is C's x / y, "& 255" is (uint8_t); let / const are int (uint32_t for colours), arrays are
// static const tables or small int arrays on the stack ("[]" here: the C++ gives them the size the loop fills).
// No floats, no closures. On ivory balls a dim LED still tints the whole ball, so the shapes are drawn with dark gaps,
// not with faint fills.
import {
    abs, b_dist, C_VIOLET, C_WHITE, fr, imax, imin, mix, oct, posMod, put, ringOf, sin8, smooth, tent, voice, wave,
} from "./kaia.js";
import { MX_LED_AMOUNT } from "./matrix.js";
import { b_col, b_row, b_x, h1, h2, h3 } from "./wakes.js";

// ================= the helpers of catalog A =================
// p = 4·(x − 19), q = 7·(row − 3): a ball from the middle in 1/8 balls (p to the right, q down), as in KAIA-173 and KAIA-195

// a soft falloff: 255 at x = 0, easing down to 0 at |x| = w (a smoothstep of tent)
export function bell(x, w) {
    const u = tent(x, w);
    if (!u) return 0;
    return u * u * (765 - 2 * u) / 65025 | 0;
}

// a slow glitter of ball i, 0..255: sin² at its own pace (rate + 0..63, 256 = a turn a second) from its own phase
export function glint(i, t, rate) {
    const s = sin8((h2[i] + (t * (rate + (h3[i] & 63)) / 1000 | 0)) & 255);
    return s * s / 255 | 0;
}

// ================= 10 · Снежинка: a flake on the balls' own lattice; frost that grows, glitters and thaws =================
// u, v: the ball's place in the diagonal grid from the flake's centre (col 10, row 3). The six arms run along the grid's
// own lines (v = 0, u = 0, u = v), so every arm is a straight line of three balls; round each tip, two balls of frost.

// the ball's place on the flake: D | s << 2 | k << 3, or −1 off it. D: the hex distance from the centre (0..3); s = 1 on
// the frost round a tip (D = 3, one off an arm), 0 on an arm; k: the arm (0 at 1 o'clock, clockwise) or, for the frost,
// the gap after arm k
export function flakeGeo(i) {
    const u = b_col[i] - 10, v = b_row[i] - 3, w = u - v;
    const D = imax(abs(u), imax(abs(v), abs(w))), s = imin(abs(u), imin(abs(v), abs(w)));
    if (D > 3 || (s && D < 3)) return -1;
    let k;
    if (!s) k = !v ? (u > 0 ? 1 : 4) : !u ? (v < 0 ? 0 : 3) : u > 0 ? 2 : 5;
    else k = u > 0 ? (v < 0 ? 0 : v < u ? 1 : 2) : v > 0 ? 3 : v > u ? 4 : 5;
    return D | (s ? 4 : 0) | (k << 3);
}

// how lit a flake ball is, 0..255: the arms grown out to la (1/16 ball from the centre: 48 = three balls) and in from the
// tips to li (64 = all the way in); the frost of gap k grown to lb[k] (16 = all of it), fainter than the arms
export function flakeLit(g, la, li, lb) {
    const D = g & 3, s = (g >> 2) & 1, b = D - s;
    let a = imin(255, imax(0, (la - b * 16 + 8) * 16));
    a = imin(a, imin(255, imax(0, (li - (3 - b) * 16 + 8) * 16)));
    if (s) a = imin(a, imin(255, imax(0, lb[(g >> 3) & 7] * 16))) * 150 / 255 | 0;
    return a;
}

// frost on the rim: about one ball in five glittering slowly, the rest dark
export function rime(i, t) {
    if (ringOf(i) || h1[i] >= 50) return 0;
    return 10 + (110 * glint(i, t, 60) / 255 | 0);
}

// Пробуждение · Иней: frost creeps in from the rim towards the middle, then melts back out and leaves the flake, grown in
// from its tips; its centre flashes as the arms meet
export function snowWake(n, t, du, col) {
    const fo = smooth(du, du - 400, t), wc = mix(col, C_WHITE, 200);
    const f = smooth(0, 750, t) * 60 / 255 | 0, mb = smooth(650, 1350, t) * 60 / 255 | 0;  // the frost's front in, and how far it has melted back
    const li = smooth(700, 1350, t) * 64 / 255 | 0, fl = tent(t - 1400, 260), rm = smooth(900, 1600, t), lb = [0, 0, 0, 0, 0, 0];
    for (let j = 0; j < 6; j++) lb[j] = 16 - (smooth(1300, 1700, t) * 16 / 255 | 0);  // the tips keep their frost a moment
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const r = ringOf(i), g = flakeGeo(i);
        let a = (imin(255, imax(0, (f - r * 16) * 16)) * (40 + (h1[i] >> 1)) / 255 | 0) * (255 - imin(255, imax(0, (mb - (3 - r) * 16) * 16))) / 255 | 0;
        let c = mix(col, wc, h2[i] >> 2);
        if (!r) a = imax(a, rime(i, t) * rm / 255 | 0);
        if (g >= 0) {
            const fa = flakeLit(g, 48, li, lb);
            if (fa > a) {
                a = fa;
                c = mix(col, wc, tent(li - (3 - (g & 3) + ((g >> 2) & 1)) * 16, 16));  // the growing tips white
            }
            if (fl) {
                a = imax(a, fl);
                c = mix(col, wc, fl);
            }
        }
        if (a) put(i, c, a * fo / 255 | 0);
    }
}

// Слушает · Блеск: the flake hangs still and glitters: a glint runs out along one arm after another, clockwise, 0.8 s each;
// a little snow falls at the sides, and frost glitters here and there on the rim
const snow_fx = [-60, -38, 42, 64];  // where the snow falls, 1/8 ball
export function snowListen(n, t, col, k) {
    if (k <= 0) return;
    const lb = [0, 0, 0, 0, 0, 0], wc = mix(col, C_WHITE, 210), br = 200 + (wave(t, 45) * 40 / 128 | 0), fx = [], fy = [];
    const ph = posMod(t, 4800), ga = ph / 800 | 0, gp = ((ph - ga * 800) * 72 / 800 | 0) - 8;  // the glint: on arm ga, gp/16 ball out
    for (let j = 0; j < 4; j++) {  // the snow: four flakes falling slowly, each at its own pace
        const per = 5200 + j * 700;
        fx[j] = snow_fx[j] + (wave(t + j * 600, 60) * 4 / 128 | 0);
        fy[j] = -26 + (posMod(t + j * 1900, per) * 54 / per | 0);
    }
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3), g = flakeGeo(i);
        let a = rime(i, t), c = col;
        for (let j = 0; j < 4; j++) {
            if (abs(p - fx[j]) >= 8 || abs(q - fy[j]) >= 8) continue;
            const v = bell(oct(p - fx[j], q - fy[j]), 8) * 120 / 255 | 0;
            if (v > a) {
                a = v;
                c = wc;
            }
        }
        if (g >= 0 && !((g >> 2) & 1)) {
            const D = g & 3;
            a = imax(a, flakeLit(g, 48, 64, lb) * br / 255 | 0);
            c = col;
            if (!D || ((g >> 3) & 7) === ga) {
                const v = tent(D * 16 - gp, 20);
                a = imax(a, v);
                c = mix(col, wc, v);
            }
        }
        if (a) put(i, c, a * k / 255 | 0);
    }
}

// Думает · Иней на кончиках: the frost round the tips grows and melts gap after gap round the flake, 1.2 s a round, and a
// soft light circles with it; half violet
export function snowThink(n, t, col, k) {
    if (k <= 0) return;
    const c0 = mix(col, C_VIOLET, 128), wc = mix(c0, C_WHITE, 180), G = t * 256 / 1200 | 0, lb = [0, 0, 0, 0, 0, 0];
    for (let j = 0; j < 6; j++) {
        const u = posMod(t - j * 200, 1200);
        lb[j] = (u < 600 ? smooth(0, 500, u) : 255 - smooth(600, 1100, u)) * 16 / 255 | 0;
    }
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const g = flakeGeo(i);
        let a = rime(i, t) >> 1, c = c0;
        if (g >= 0) {
            const fa = flakeLit(g, 48, 64, lb);
            if (fa) {
                const d = (G - ((((g >> 3) & 7) * 2 + ((g >> 2) & 1)) * 256 / 12 | 0)) & 255, v = d < 90 ? (90 - d) * 255 / 90 | 0 : 0;
                a = imax(a, fa * (140 + (v * 115 / 255 | 0)) / 255 | 0);
                c = mix(c0, wc, v * v / 510 | 0);
            }
        }
        if (a) put(i, c, a * k / 255 | 0);
    }
}

// Говорит · Рост голосом: the arms reach out with the voice, the frost at the tips follows a beat later; loud, the tips go white
export function snowSpeak(n, t, col, k) {
    if (k <= 0) return;
    const v = voice(t), v2 = voice(t - 110), la = 18 + (v * 30 / 255 | 0), wc = mix(col, C_WHITE, 200), lb = [0, 0, 0, 0, 0, 0];
    for (let j = 0; j < 6; j++) lb[j] = v2 * 16 / 255 | 0;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const g = flakeGeo(i);
        let a = rime(i, t) >> 1, c = col;
        if (g >= 0) {
            const fa = flakeLit(g, la, 64, lb);
            if (fa > a) {
                a = fa;
                c = mix(col, wc, tent(la - ((g & 3) - ((g >> 2) & 1)) * 16 - 8, 14) * v / 255 | 0);  // the tips
            }
        }
        if (a) put(i, c, a * k / 255 | 0);
    }
}

// Готово · Идеальная снежинка: the flake grows whole with its frost in half a second, flashes white, and a ring of glitter
// runs out over the display
export function snowDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t), wc = mix(col, C_WHITE, 210), la = smooth(0, 450, t) * 48 / 255 | 0, lb = [0, 0, 0, 0, 0, 0];
    for (let j = 0; j < 6; j++) lb[j] = smooth(250, 600, t) * 16 / 255 | 0;
    const fl = tent(t - 650, 260), age = t - 650, rr = age * 640 / 1000 | 0, rf = age > 0 ? imax(0, 255 - (age * 255 / 900 | 0)) : 0;
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const g = flakeGeo(i);
        let a = 0, c = col;
        if (rf && h1[i] < 150) {  // the ring of glitter
            a = (tent(b_dist[i] * 16 - rr, 70) * rf / 255 | 0) * (60 + (h1[i] >> 1)) / 255 | 0;
            c = mix(col, wc, h2[i] >> 1);
        }
        if (g >= 0) {
            const fa = flakeLit(g, la, 64, lb);
            if (fa && fa >= a) {
                a = fa;
                c = mix(col, wc, fl);
            }
        }
        if (a) put(i, c, a * fo / 255 | 0);
    }
}

// Ошибка · Оттепель: the frost melts off the tips, the arms shrink back to the centre, and drops run off them and fall
const snow_dx = [28, -20, 12, -4], snow_dq = [0, 0, 14, 14], snow_dt = [350, 500, 650, 800];  // where the drops fall from (1/8 ball) and when (ms)
export function snowError(n, t, du, col) {
    const fo = smooth(du, du - 300, t), la = 48 - (smooth(300, 1300, t) * 48 / 255 | 0), g0 = 255 - (smooth(200, 1300, t) * 90 / 255 | 0);
    const lb = [0, 0, 0, 0, 0, 0], dy = [0, 0, 0, 0], da = [0, 0, 0, 0], wc = mix(col, C_WHITE, 110);
    for (let j = 0; j < 6; j++) lb[j] = 16 - (smooth(100, 550, t) * 16 / 255 | 0);
    for (let j = 0; j < 4; j++) {
        const u = imax(0, t - snow_dt[j]);
        dy[j] = snow_dq[j] + (u * u / 7000 | 0);
        da[j] = u > 0 ? imax(0, 255 - (u * 255 / 900 | 0)) : 0;
    }
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3), g = flakeGeo(i);
        let a = g >= 0 ? flakeLit(g, la, 64, lb) * g0 / 255 | 0 : 0, c = col;
        for (let j = 0; j < 4; j++) {
            if (!da[j] || abs(p - snow_dx[j]) >= 6 || abs(q - dy[j]) >= 11) continue;
            const v = bell(oct((p - snow_dx[j]) * 2, q - dy[j]), 11) * da[j] / 255 | 0;  // a drop, taller than wide
            if (v > a) {
                a = v;
                c = wc;
            }
        }
        if (a) put(i, c, a * fo / 255 | 0);
    }
}

// Уведомление · Блик по кругу: a bright glint runs round the six arms twice with a short trail, then the whole flake flashes
export function snowNotify(n, t, du, col) {
    const fo = smooth(du, du - 300, t), wc = mix(col, C_WHITE, 200), G = t * 512 / 1300 | 0, all = tent(t - 1420, 200), lb = [16, 16, 16, 16, 16, 16];
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const g = flakeGeo(i);
        let a = rime(i, t) >> 1, c = col;
        if (g >= 0) {
            const e = G - ((((g >> 3) & 7) * 2 + ((g >> 2) & 1)) * 256 / 12 | 0);
            const v = t < 1300 && e >= 0 && (e & 255) < 80 ? (80 - (e & 255)) * 255 / 80 | 0 : 0;
            a = imax(a, flakeLit(g, 48, 64, lb) * (70 + (imax(v, all) * 185 / 255 | 0)) / 255 | 0);
            c = mix(col, wc, imax(v * v / 255 | 0, all));
        }
        if (a) put(i, c, a * fo / 255 | 0);
    }
}

// ================= 11 · Светлячки: soft lights that drift, circle and gather; each glows up and down at its own pace =================

const ff_bx = [-54, -32, -10, 12, 34, 56];  // where each one drifts about, 1/8 ball
const ff_wx = [9, 13, 7, 11, 15, 8], ff_wy = [17, 12, 21, 15, 10, 19];  // each one's slow drift, 256 = a turn a second

// where firefly j drifts at t (while Kaya listens), 1/8 ball: round its own place, a slow wave and a small quicker one each way
export function flyX(j, t) {
    return ff_bx[j] + (wave(t + j * 1700, ff_wx[j]) * 24 / 128 | 0) + (wave(t + j * 900, 41 + j * 7) * 8 / 128 | 0);
}

export function flyY(j, t) {
    return (wave(t + j * 1100, ff_wy[j]) * 13 / 128 | 0) + (wave(t + j * 500, 53 + j * 9) * 4 / 128 | 0);
}

// how bright firefly j glows at t: up and down, each at its own pace (2.6–4.1 s)
export function flyGlow(j, t) {
    const s = sin8(((t * (62 + j * 7) / 1000 | 0) + j * 43) & 255);
    return 60 + (195 * (s * s / 255 | 0) / 255 | 0);
}

// m lights (at most 18) at (px[j], py[j]), each as bright as gl[j]: a soft glow a ball and a quarter across that whitens
// at its core; where two meet, their light adds up
export function flies(m, px, py, gl, col, g) {
    const wc = mix(col, C_WHITE, 170);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = 0, w = 0;
        for (let j = 0; j < m; j++) {
            const dx = p - px[j], dy = q - py[j];
            if (!gl[j] || dx >= 10 || dx <= -10 || dy >= 10 || dy <= -10) continue;
            const d = oct(dx, dy);
            if (d >= 10) continue;
            const v = bell(d, 10) * gl[j] / 255 | 0;
            a += v;
            if (d < 5) w = imax(w, v);
        }
        if (a) put(i, mix(col, wc, w), imin(255, a) * g / 255 | 0);
    }
}

// Пробуждение · Слетаются: the fireflies fly in from beyond the edges one after another and settle into their drift
const ff_in = [-104, -16, -40, -44, -16, 44, 20, -44, 100, 12, 104, -20];  // where each comes from, (p, q)
export function flyWake(n, t, du, col) {
    const fo = smooth(du, du - 400, t), lt = t - du, px = [], py = [], gl = [];
    fr.dg = 128;
    for (let j = 0; j < 6; j++) {
        const u0 = smooth(j * 130, j * 130 + 1000, t), u1 = smooth(j * 130, j * 130 + 1000, t - 80), x0 = ff_in[2 * j], y0 = ff_in[2 * j + 1];
        const dx = flyX(j, lt) - x0, dy = flyY(j, lt) - y0;
        px[2 * j] = x0 + (dx * u0 / 255 | 0);
        py[2 * j] = y0 + (dy * u0 / 255 | 0);
        px[2 * j + 1] = x0 + (dx * u1 / 255 | 0);
        py[2 * j + 1] = y0 + (dy * u1 / 255 | 0);
        gl[2 * j] = 120 + (135 * smooth(j * 130, j * 130 + 300, t) / 255 | 0);
        gl[2 * j + 1] = imin(110, (u0 - u1) * 4);  // the trail, only while it flies
    }
    flies(12, px, py, gl, col, fo);
}

// Слушает · Огоньки: six fireflies drift slowly about the display, each glowing up and down at its own pace
export function flyListen(n, t, col, k) {
    if (k <= 0) return;
    const px = [], py = [], gl = [];
    for (let j = 0; j < 6; j++) {
        px[j] = flyX(j, t);
        py[j] = flyY(j, t);
        gl[j] = flyGlow(j, t);
    }
    flies(6, px, py, gl, col, k);
}

// Думает · Хоровод: the six circle the middle one after another (3 s a turn), each with a short trail; half violet
export function flyThink(n, t, col, k) {
    if (k <= 0) return;
    const px = [], py = [], gl = [];
    for (let j = 0; j < 6; j++) {
        const rad = 44 + (wave(t + j * 400, 90) * 8 / 128 | 0);
        for (let m = 0; m < 3; m++) {
            const th = ((t - m * 60) * 256 / 3000 | 0) + j * 43, e = j * 3 + m;
            px[e] = (sin8((th + 64) & 255) - 128) * rad / 128 | 0;
            py[e] = (sin8(th & 255) - 128) * 13 / 128 | 0;
            gl[e] = m ? 100 - m * 30 : 170 + (flyGlow(j, t) * 85 / 255 | 0);
        }
    }
    flies(18, px, py, gl, mix(col, C_VIOLET, 128), k);
}

// Говорит · Хор: the fireflies hang in a loose row and glow with the voice two by two, each pair a beat after the last
export function flySpeak(n, t, col, k) {
    if (k <= 0) return;
    const px = [], py = [], gl = [], v = [voice(t), voice(t - 90), voice(t - 180)];
    for (let j = 0; j < 6; j++) {
        px[j] = -55 + j * 22 + (wave(t + j * 800, 37) * 6 / 128 | 0);
        py[j] = (j & 1 ? 5 : -5) + (wave(t + j * 600, 29) * 6 / 128 | 0);
        gl[j] = 45 + (v[j >> 1] * 210 / 255 | 0);
    }
    flies(6, px, py, gl, col, k);
}

// Готово · Рой: the fireflies gather into one bright cluster in the middle, flare up together, and it glows and turns
export function flyDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t), u = smooth(0, 650, t), fl = tent(t - 780, 320), px = [], py = [], gl = [];
    fr.dg = 128;
    for (let j = 0; j < 6; j++) {
        const th = (t * 256 / 1400 | 0) + j * 43, x0 = flyX(j, 0), y0 = flyY(j, 0);
        px[j] = x0 + ((((sin8((th + 64) & 255) - 128) * 8 / 128 | 0) - x0) * u / 255 | 0);
        py[j] = y0 + ((((sin8(th & 255) - 128) * 4 / 128 | 0) - y0) * u / 255 | 0);
        gl[j] = 150 + (105 * imax(u, fl) / 255 | 0);
    }
    flies(6, px, py, gl, mix(col, C_WHITE, fl * 160 / 255 | 0), fo);
    if (fl) {
        for (let i = 0; i < MX_LED_AMOUNT; i++) {
            const p = 4 * (b_x[i] - 19);
            if (abs(p) < 40) put(i, col, (bell(oct(p, 14 * (b_row[i] - 3)), 40) * fl / 255 | 0) * fo / 400 | 0);  // its halo
        }
    }
}

// Ошибка · Разлетелись: the fireflies startle and scatter out past the edges, going out one after another
export function flyError(n, t, du, col) {
    const fo = smooth(du, du - 300, t), st = tent(t - 60, 140), px = [], py = [], gl = [];
    fr.dg = 128;
    for (let j = 0; j < 6; j++) {
        const x0 = flyX(j, 0), y0 = flyY(j, 0), dx = x0 * 2 + (x0 < 0 ? -70 : 70), dy = y0 * 2 + (y0 < 0 ? -22 : 22);
        const u0 = smooth(120 + j * 40, 1000 + j * 40, t), u1 = smooth(120 + j * 40, 1000 + j * 40, t - 60), out = 255 - smooth(350 + j * 90, 950 + j * 90, t);
        px[2 * j] = x0 + (dx * u0 / 255 | 0);
        py[2 * j] = y0 + (dy * u0 / 255 | 0);
        px[2 * j + 1] = x0 + (dx * u1 / 255 | 0);
        py[2 * j + 1] = y0 + (dy * u1 / 255 | 0);
        gl[2 * j] = (200 + (st * 55 / 255 | 0)) * out / 255 | 0;
        gl[2 * j + 1] = imin(110, (u0 - u1) * 4) * out / 255 | 0;
    }
    flies(12, px, py, gl, col, fo);
}

// Уведомление · Вспышка: the fireflies hang where they are and all flash together, twice
export function flyNotify(n, t, du, col) {
    const fo = smooth(du, du - 300, t), fl = imax(tent(t - 200, 230), tent(t - 760, 230)), px = [], py = [], gl = [];
    fr.dg = 128;
    for (let j = 0; j < 6; j++) {
        px[j] = flyX(j, t);
        py[j] = flyY(j, t);
        gl[j] = 50 + (fl * 205 / 255 | 0);
    }
    flies(6, px, py, gl, mix(col, C_WHITE, fl * 130 / 255 | 0), fo);
}

// ================= 12 · Пламя: a flame on the bottom row whose tongues lick upwards; embers rise from it =================
// The cold flame in Kaya's colour (the catalog's default); its warm variant was not taken.

// the flame: w wide each side at its foot (1/8 ball), up to h high over the bottom row; its tongues lick at the phase ph
// (two waves across it going opposite ways, so they rise and fall in place); light runs up through it; the tips whiten,
// and the core at its foot a little; g: how bright
export function flame(w, h, ph, col, g) {
    if (w <= 0 || h <= 0 || g <= 0) return;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), z = 21 - 7 * (b_row[i] - 3), ax = abs(p);  // z: the height over the bottom row
        if (ax >= w) continue;
        const env = 255 - (ax * ax * 255 / (w * w) | 0);
        const tg = ((sin8((p * 6 + ph) & 255) + sin8((p * 13 - ph * 2 + 90) & 255)) >> 1) - 128;  // the tongues, −128..127
        const e = ((h * env / 255 | 0) * (150 + (tg * 105 / 128 | 0)) / 255 | 0) - z;  // how far under the flame's edge
        if (e <= -6) continue;
        let a = e < 0 ? (6 + e) * 25 : 150 + imin(105, e * 5);
        a = a * (175 + (sin8((z * 9 - ph * 3) & 255) * 80 / 255 | 0)) / 255 | 0;  // light running up through it
        const wh = imax(tent(e, 16) * imin(255, z * 18) / 255 | 0, tent(ax, w >> 1) * tent(z, 18) / 400 | 0);
        put(i, wh ? mix(col, C_WHITE, wh * 180 / 255 | 0) : col, a * g / 255 | 0);
    }
}

// nm embers (at most 8), one every per / nm ms, each rising for 1.2 s from z0 (1/8 ball over the bottom row), drifting
// and fading
const em_x = [-10, 14, -22, 4, 24, -4, 18, -16];  // where the embers start, 1/8 ball
export function embers(nm, t, per, z0, col, g) {
    if (g <= 0) return;
    const wc = mix(col, C_WHITE, 200), ex = [], ez = [], ea = [];
    for (let j = 0; j < nm; j++) {
        const u = posMod(t + (j * per / nm | 0), per);
        ex[j] = em_x[j] + (em_x[j] * u / 1500 | 0) + (wave(u + j * 300, 220) * 6 / 128 | 0);
        ez[j] = z0 + (u * 40 / 1000 | 0);
        ea[j] = u < 250 ? u * 255 / 250 | 0 : u < 1200 ? (1200 - u) * 255 / 950 | 0 : 0;
    }
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), z = 21 - 7 * (b_row[i] - 3);
        let a = 0;
        for (let j = 0; j < nm; j++) if (ea[j] && abs(p - ex[j]) < 8 && abs(z - ez[j]) < 8) a = imax(a, bell(oct(p - ex[j], z - ez[j]), 8) * ea[j] / 255 | 0);
        if (a) put(i, wc, a * g / 255 | 0);
    }
}

// Пробуждение · Розжиг: a spark glints at the foot, catches, and the flame rises, leaps once and settles
export function flameWake(n, t, du, col) {
    const fo = smooth(du, du - 400, t), u = smooth(250, 1100, t), up = tent(t - 750, 450), sp = tent(t - 200, 260);
    fr.dg = 128;
    flame(u * 40 / 255 | 0, (u * 30 / 255 | 0) + (up * 16 / 255 | 0), t * 160 / 1000 | 0, col, 240 * fo / 255 | 0);
    if (sp) {
        const wc = mix(col, C_WHITE, 220);
        for (let i = 0; i < MX_LED_AMOUNT; i++) {
            const p = 4 * (b_x[i] - 19), z = 21 - 7 * (b_row[i] - 3);
            if (abs(p) < 10 && z < 13) put(i, wc, bell(oct(p, z - 3), 10) * sp / 255 | 0);
        }
    }
}

// Слушает · Тихий огонь: a calm low flame, its tongues licking slowly; now and then an ember rises
export function flameListen(n, t, col, k) {
    if (k <= 0) return;
    flame(40 + (wave(t, 30) * 3 / 128 | 0), 30 + (wave(t, 70) * 4 / 128 | 0), t * 90 / 1000 | 0, col, 235 * k / 255 | 0);
    embers(2, t, 3400, 16, col, 170 * k / 255 | 0);
}

// Думает · Пляска: the flame dances higher and quicker, and embers fly up from it; half violet
export function flameThink(n, t, col, k) {
    if (k <= 0) return;
    const c = mix(col, C_VIOLET, 128);
    flame(44, 46 + (wave(t, 180) * 6 / 128 | 0), t * 240 / 1000 | 0, c, 240 * k / 255 | 0);
    embers(5, t, 1500, 22, c, 210 * k / 255 | 0);
}

// Говорит · Голос огня: the flame's height follows the voice; loud, it widens a little
export function flameSpeak(n, t, col, k) {
    if (k <= 0) return;
    const v = voice(t);
    flame(36 + (v * 10 / 255 | 0), 18 + (v * 36 / 255 | 0), t * 150 / 1000 | 0, col, (190 + (v * 65 / 255 | 0)) * k / 255 | 0);
}

// Готово · Костёр: the flame flares up to the top, brighter and whiter, and a shower of embers rises from it
const fl_bv = [-30, 70, 24, 84, -12, 92, 40, 66, -44, 60, 8, 96, -22, 78, 32, 74];  // the embers' speeds (p, z), 1/8 ball a second
export function flameDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t), up = smooth(0, 300, t) * (255 - smooth(700, 1500, t)) / 255 | 0, wc = mix(col, C_WHITE, 210), ex = [], ez = [], ea = [];
    fr.dg = 128;
    flame(40 + (up * 22 / 255 | 0), 30 + (up * 34 / 255 | 0), t * 200 / 1000 | 0, mix(col, C_WHITE, up * 90 / 255 | 0), (210 + (up * 45 / 255 | 0)) * fo / 255 | 0);
    for (let j = 0; j < 8; j++) {
        const u = t - 250 - j * 50;
        ex[j] = fl_bv[2 * j] * u / 1000 | 0;
        ez[j] = 14 + (fl_bv[2 * j + 1] * u / 1000 | 0) - (30 * (u * u / 1000 | 0) / 1000 | 0);
        ea[j] = u > 0 && u < 1100 ? (u < 150 ? u * 255 / 150 | 0 : (1100 - u) * 255 / 950 | 0) : 0;
    }
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), z = 21 - 7 * (b_row[i] - 3);
        let a = 0;
        for (let j = 0; j < 8; j++) if (ea[j] && abs(p - ex[j]) < 8 && abs(z - ez[j]) < 8) a = imax(a, bell(oct(p - ex[j], z - ez[j]), 8) * ea[j] / 255 | 0);
        if (a) put(i, wc, a * fo / 255 | 0);
    }
}

// Ошибка · Угасание: the flame sputters (two dips), sinks and goes out; smoke curls up from where it was
export function flameError(n, t, du, col) {
    const fo = smooth(du, du - 300, t), s = smooth(200, 1100, t), dip = imax(tent(t - 380, 140), tent(t - 700, 140)) * 90 / 255 | 0;
    const sc = mix(col, 0x9a9a94, 170), cx = [0, 0, 0], cz = [0, 0, 0], cr = [0, 0, 0], ca = [0, 0, 0];  // smoke: grey with a little of the flame's colour
    for (let j = 0; j < 3; j++) {  // the smoke: three puffs, rising and spreading
        const u = t - 700 - j * 200;
        cx[j] = (j - 1) * 8 + (wave(u + j * 500, 150) * 6 / 128 | 0);
        cz[j] = 6 + (u * 28 / 1000 | 0);
        cr[j] = 9 + (imax(0, u) * 10 / 1000 | 0);
        ca[j] = u > 0 ? 150 - imin(150, u * 150 / 1200 | 0) : 0;
    }
    fr.dg = 128;
    flame(40 - (s * 14 / 255 | 0), (30 * (255 - s) / 255 | 0) * (255 - dip) / 255 | 0, t * 120 / 1000 | 0, col, 235 * fo / 255 | 0);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), z = 21 - 7 * (b_row[i] - 3);
        let a = 0;
        for (let j = 0; j < 3; j++) if (ca[j] && abs(p - cx[j]) < cr[j] && abs(z - cz[j]) < cr[j]) a = imax(a, bell(oct(p - cx[j], z - cz[j]), cr[j]) * ca[j] / 255 | 0);
        if (a) put(i, sc, a * fo / 255 | 0);
    }
}

// Уведомление · Треск: a log pops: the flame jumps and a burst of sparks flies out in arcs to both sides
const fl_sv = [-70, 60, 64, 70, -40, 90, 46, 84, -90, 40, 86, 46, -20, 100, 22, 96, -56, 76, 58, 66];  // the sparks' speeds (p, z)
export function flameNotify(n, t, du, col) {
    const fo = smooth(du, du - 300, t), up = tent(t - 120, 260), wc = mix(col, C_WHITE, 200), ex = [], ez = [], ea = [];
    fr.dg = 128;
    flame(40, 30 + (up * 16 / 255 | 0), t * 160 / 1000 | 0, col, (170 + (up * 85 / 255 | 0)) * fo / 255 | 0);
    for (let j = 0; j < 10; j++) {
        const u = t - 80 - (j % 3) * 40;
        ex[j] = fl_sv[2 * j] * u / 1000 | 0;
        ez[j] = 12 + (fl_sv[2 * j + 1] * u / 1000 | 0) - (90 * (u * u / 1000 | 0) / 1000 | 0);
        ea[j] = u > 0 && u < 1200 ? (1200 - u) * 255 / 1200 | 0 : 0;
    }
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), z = 21 - 7 * (b_row[i] - 3);
        let a = 0;
        for (let j = 0; j < 10; j++) if (ea[j] && abs(p - ex[j]) < 9 && abs(z - ez[j]) < 9) a = imax(a, bell(oct(p - ex[j], z - ez[j]), 9) * ea[j] / 255 | 0);
        if (a) put(i, wc, a * fo / 255 | 0);
    }
}
