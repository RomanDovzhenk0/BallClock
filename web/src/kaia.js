// firmware/src/kaia.cpp: the ball tables, the integer helpers, the 3 styles with their states and one-shots,
// and kaiaDraw. Integer maths inside a frame: every C++ division is "/ … | 0" here (truncates toward zero),
// every (uint8_t) cast is "& 255". The tables at boot use floats: each float step is Math.fround.
import { sin8 } from "./lib8.js";
import { ledDiag, MX_DIAG_H, MX_DIAG_W, MX_LED_AMOUNT } from "./matrix.js";

export { sin8 };

export const C_WHITE = 0xffffff, C_VIOLET = 0x965aff, C_GREEN = 0x35e07a, C_RED = 0xff3b30, C_AMBER = 0xffb020;

export const A_WAKE = 0, A_LISTENING = 1, A_THINKING = 2, A_SPEAKING = 3, A_DONE = 4, A_ERROR = 5, A_NOTIFY = 6, A_OFF = 7;
export const ANIM_NAMES = ["wake", "listening", "thinking", "speaking", "done", "error", "notify", "off"];

// one-shot lengths, ms: wake, done, error, notify; per style (kaia_anim 1 ripple, 2 orbit, 3 sparks)
export const shot_ms = [
    [1900, 1200, 1400, 1600],
    [2000, 1400, 1400, 1500],
    [2000, 1300, 1400, 1600],
];

// the matrix being drawn and the per-frame values (fr.sc, fr.dg; fr.lt, fr.ls: the listening after a wake)
export let matrix = null;
export const fr = { sc: 255, dg: 89, lt: 0, ls: 1 };
export function useMatrix(m) {
    matrix = m;
}

// ================= ball tables, from the real layout at boot =================

export const SPARKS = 18, SPARK_LEN = 12;

export const b_dist = new Uint8Array(MX_LED_AMOUNT);  // distance from the centre in quarter-balls, 0..38
export const b_ang = new Uint8Array(MX_LED_AMOUNT);   // angle 0..255 clockwise from 12 o'clock
export const b_pos = new Uint8Array(MX_LED_AMOUNT);   // place in its ring, clockwise from 12 o'clock
export const b_meta = new Uint8Array(MX_LED_AMOUNT);  // bits 0-1 ring, 2-3 lens of the mark, 4-6 voice arc
export const ring_len = new Uint8Array(4);
export const track = new Uint8Array(32);
export const tracks = { len: 0 };
export const spark = Array.from({ length: SPARKS }, () => new Uint8Array(SPARK_LEN).fill(255));  // rim → centre, 255 = end

export const ringOf = (i) => b_meta[i] & 3;
export const lensOf = (i) => (b_meta[i] >> 2) & 3;
export const arcOf = (i) => b_meta[i] >> 4;

const f = Math.fround;

export function buildTables() {
    const bx = new Float32Array(MX_LED_AMOUNT), by = new Float32Array(MX_LED_AMOUNT), ba = new Float32Array(MX_LED_AMOUNT);
    const ring = new Int8Array(MX_LED_AMOUNT);
    const S3 = f(0.8660254), CX = f(9.5), CY = f(3 * S3);

    for (let y = 0; y < MX_DIAG_H; y++) {
        for (let x = 0; x < MX_DIAG_W; x++) {
            const i = ledDiag(x, y);
            if (i < 0) continue;
            bx[i] = f((2 * x + 3 - y) / 2);
            by[i] = f(y * S3);
        }
    }

    const d2 = (i, j) => {
        const dx = f(bx[i] - bx[j]), dy = f(by[i] - by[j]);
        return f(f(dx * dx) + f(dy * dy));
    };
    const NB = f(1.1025);

    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const ex = f(bx[i] - CX), ey = f(by[i] - CY);
        b_dist[i] = Math.round(f(f(Math.sqrt(f(f(ex * ex) + f(ey * ey)))) * 4));
        let a = f(f(Math.atan2(ex, -ey)) / (2 * Math.PI));
        if (a < 0) a = f(a + 1);
        ba[i] = a;
        b_ang[i] = Math.round(f(a * 256)) & 255;

        let nbr = 0;
        for (let j = 0; j < MX_LED_AMOUNT; j++) {
            if (i !== j && d2(i, j) < NB) nbr++;
        }
        ring[i] = nbr < 6 ? 0 : -1;
    }

    // rings from the rim inwards
    for (let r = 0; r < 3; r++) {
        for (let i = 0; i < MX_LED_AMOUNT; i++) {
            if (ring[i] !== r) continue;
            for (let j = 0; j < MX_LED_AMOUNT; j++) {
                if (ring[j] < 0 && d2(i, j) < NB) ring[j] = r + 1;
            }
        }
    }

    ring_len.fill(0);
    tracks.len = 0;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const r = ring[i] < 0 ? 3 : ring[i];
        let pos = 0;
        for (let j = 0; j < MX_LED_AMOUNT; j++) {
            const rj = ring[j] < 0 ? 3 : ring[j];
            if (rj === r && (ba[j] < ba[i] || (ba[j] === ba[i] && j < i))) pos++;
        }
        b_pos[i] = pos;
        ring_len[r]++;

        const m = ba[i] < 0.5 ? f(ba[i] * 2) : f(f(1 - ba[i]) * 2);
        const arc = m < f(5 / 6) ? Math.trunc(f(m * 6)) : 5;

        const lx = f(f(bx[i] - CX) / f(2.6)), ly = f(f(by[i] - CY) / f(3.6)), e = f(f(lx * lx) + f(ly * ly));
        const lens = e < f(0.2) ? 3 : e < f(0.55) ? 2 : e < 1 ? 1 : 0;

        b_meta[i] = r | (lens << 2) | (arc << 4);
    }

    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        if (lensOf(i) !== 1) continue;
        let pos = 0;
        for (let j = 0; j < MX_LED_AMOUNT; j++) {
            if (lensOf(j) === 1 && (ba[j] < ba[i] || (ba[j] === ba[i] && j < i))) pos++;
        }
        if (pos < track.length) track[pos] = i;
        tracks.len++;
    }
    if (tracks.len > track.length) tracks.len = track.length;

    // sparks: 18 rim balls, each with the balls on the straight line to the centre
    for (let k = 0; k < SPARKS; k++) {
        spark[k].fill(255);
        const ta = f(k / SPARKS);
        let best = 9, s = 0;
        for (let i = 0; i < MX_LED_AMOUNT; i++) {
            if (ringOf(i)) continue;
            let d = f(f(ba[i] - ta) + 0.5);
            d = Math.abs(f(f(d - Math.floor(d)) - 0.5));
            if (d < best) best = d, s = i;
        }

        let len = 0;
        spark[k][len++] = s;
        const sx = bx[s], sy = by[s];
        const qx = f(sx - CX), qy = f(sy - CY);
        const steps = Math.ceil(f(f(Math.sqrt(f(f(qx * qx) + f(qy * qy)))) / 0.5));
        for (let q = 1; q <= steps && len < SPARK_LEN; q++) {
            const px = f(sx + f(f(f(CX - sx) * q) / steps)), py = f(sy + f(f(f(CY - sy) * q) / steps));
            let bd = f(1e9), bi = 0;
            for (let i = 0; i < MX_LED_AMOUNT; i++) {
                const dx = f(bx[i] - px), dy = f(by[i] - py), d = f(f(dx * dx) + f(dy * dy));
                if (d < bd) bd = d, bi = i;
            }
            if (bd < f(0.36) && bi !== spark[k][len - 1]) spark[k][len++] = bi;
        }
    }
}

// ================= maths, integers only inside a frame =================

export const imax = (a, b) => (a > b ? a : b);
export const imin = (a, b) => (a < b ? a : b);
export const abs = Math.abs;

export function posMod(a, p) {
    a %= p;
    return a < 0 ? a + p : a;
}

// 255 at x = 0, falling to 0 at |x| = w
export function tent(x, w) {
    if (x < 0) x = -x;
    return x >= w ? 0 : (w - x) * 255 / w | 0;
}

// smoothstep from a to b (either way round), 0..255
export function smooth(a, b, x) {
    let u = (x - a) * 255 / (b - a) | 0;
    if (u < 0) u = 0;
    if (u > 255) u = 255;
    return u * u * (765 - 2 * u) / 65025 | 0;
}

// sine of t ms at w (256 = a turn) per second, -128..127
export function wave(t, w) {
    return sin8((t * w / 1000 | 0) & 255) - 128;
}

// pseudo-voice 0..255 (the API carries no level)
export function voice(t) {
    let g = (wave(t, 110) * 408 / 128 | 0) + 128;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    const ph = ((t * 469 / 1000 | 0) + (wave(t, 86) * 41 / 128 | 0)) & 255;
    const v = abs(sin8(ph) - 128) * 2;
    return imin(255, (v * (77 + (178 * g / 255 | 0)) / 255 | 0) * 115 / 100 | 0);
}

// a comet on a ring of n balls, head at h (1/256 ball), clockwise (or back): 255 at the head, (1 - d/tail)² behind
export function comet(pos, h, n, tail, back = false) {
    const d = back ? posMod(pos * 256 - h, n * 256) : posMod(h - pos * 256, n * 256);
    if (d >= tail) return 0;
    const u = (tail - d) * 255 / tail | 0;
    return u * u / 255 | 0;
}

export function mix(a, b, k) {
    let out = 0;
    for (let s = 0; s <= 16; s += 8) {
        const ca = (a >> s) & 0xff, cb = (b >> s) & 0xff;
        out |= (ca + ((cb - ca) * k / 255 | 0)) << s;
    }
    return out >>> 0;
}

export function dim(c, k) {
    return mix(0, c, k);
}

// blend one ball towards the colour by a (0..255)
export function put(i, color, a) {
    if (a <= 0) return;
    if (a > 255) a = 255;
    a = a * fr.sc / 255 | 0;
    if (matrix.marked(i)) a = a * fr.dg / 255 | 0;
    if (a) matrix.setLED(i, mix(matrix.getLED(i), color, a));
}

// the clock and the background step back to k / 255
export function dimAll(k) {
    if (k >= 255) return;
    for (let i = 0; i < MX_LED_AMOUNT; i++) matrix.setLED(i, dim(matrix.getLED(i), k));
}

// ================= the helpers of v1.6 (KAIA-173): positions, distances, hashes =================
// p = 4·(x − 19), q = 7·(row − 3) (b_x, b_row of wakes.js): a ball from the middle in 1/8 balls, p to the right, q down

// the ball at x half-balls across (0..38) in a row, or -1
export function ballRX(x, row) {
    if (row < 0 || row > 6) return -1;
    return ledDiag((x - 2 + row) >> 1, row);
}

// the ball nearest to (p, q), 1/8 ball from the middle (p to the right, q down), or -1
export function ballAt(p, q) {
    if (p < -80 || p > 80 || q < -24 || q > 24) return -1;
    return ballRX(((p + 76) * 2 + 4) / 8 | 0, ((q + 21) * 2 + 7) / 14 | 0);
}

// the length of (dx, dy) as max + 3/8 min: within 7 % of the true one, no square root
export function oct(dx, dy) {
    dx = abs(dx);
    dy = abs(dy);
    return dx > dy ? dx + (dy * 3 >> 3) : dy + (dx * 3 >> 3);
}

// the distance from (p, q) to the segment s = [x0, y0, x1, y1], drawn up to v / 256 of its length (v > 0)
export function segDist(p, q, s, v) {
    const dx = s[2] - s[0], dy = s[3] - s[1];
    let u = ((p - s[0]) * dx + (q - s[1]) * dy) * 256 / (dx * dx + dy * dy) | 0;
    u = u < 0 ? 0 : u > v ? v : u;
    return oct(p - s[0] - (dx * u / 256 | 0), q - s[1] - (dy * u / 256 | 0));
}

// a hash of n, 0..255: h1 of the ball tables for any number
export function hash8(n) {
    return Math.imul(n + 1, 2654435761) >>> 24;  // (uint32_t)(n + 1) * 2654435761u >> 24
}

// put() for a ball that may be missing (-1)
export function putb(i, color, a) {
    if (i >= 0) put(i, color, a);
}

// ================= 1: ripple from the centre =================

export function rippleState(n, t, col, k) {
    if (k <= 0) return;
    const c = n === A_THINKING ? mix(col, C_VIOLET, 128) : col;
    const r = 640 - posMod(t * 2464 / 1000 | 0, 640);  // listening: a ring moving in, 1/16 quarter-ball
    const edge = 36 + (wave(t, 98) * 20 / 128 | 0);

    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i];
        let a;
        switch (n) {
            case A_LISTENING:
                a = (166 * tent(d * 16 - r, 96) / 255 | 0) * (115 + (140 * r / 640 | 0)) / 255 | 0;
                if (d >= 33) a += edge;
                break;

            case A_THINKING: {  // a slow three-armed swirl
                const w = sin8(((d * 163 / 8 | 0) - (t * 171 / 1000 | 0)) & 255);
                const s = 140 + (115 * sin8((b_ang[i] * 3 + (t * 94 / 1000 | 0)) & 255) / 255 | 0);
                a = (166 * (w * w / 255 | 0) / 255 | 0) * s / 255 | 0;
                break;
            }

            default:  // speaking: rings going out with the voice
                a = ((158 * voice(t - (d * 385 / 10 | 0)) / 255 | 0) * (832 - d * 16) / 832 | 0) + (d >= 33 ? 18 : 0);
                break;
        }
        put(i, c, a * k / 255 | 0);
    }
}

// the wake draws only its rings: the listening that fades in is wakeDraw's (wakes.js)
export function rippleShot(n, t, du, col) {
    const fade = smooth(du, du - 300, t);
    fr.dg = 153;

    switch (n) {
        case A_WAKE: {  // 3 rings out and a white-ish flash, then listening fades in
            const fl = t < 350 ? 255 - (t * 255 / 350 | 0) : 0;
            const c = mix(col, C_WHITE, fl * 179 / 255 | 0);
            const r = [0, 0, 0], fk = [0, 0, 0];
            for (let k = 0; k < 3; k++) {
                const rt = t - 220 * k;
                r[k] = rt * 544 / 1000 | 0;
                fk[k] = rt > 0 ? imax(0, 832 - r[k]) * 255 / 832 | 0 : 0;
            }
            for (let i = 0; i < MX_LED_AMOUNT; i++) {
                const d = b_dist[i] * 16;
                let a = fl * tent(d, 176) / 255 | 0;
                for (let k = 0; k < 3; k++) {
                    if (fk[k]) a = imax(a, tent(d - r[k], 88) * fk[k] / 255 | 0);
                }
                put(i, c, a * 242 / 255 | 0);
            }
            break;
        }

        case A_DONE: {  // one ring out
            const r = t * 704 / 1000 | 0, fr_ = imax(0, 960 - r) * 255 / 960 | 0, base = imax(0, 1200 - t) * 77 / 1200 | 0;
            for (let i = 0; i < MX_LED_AMOUNT; i++) {
                put(i, col, imin(255, (tent(b_dist[i] * 16 - r, 104) * fr_ / 255 | 0) + base) * fade / 255 | 0);
            }
            break;
        }

        case A_ERROR: {  // two thumps
            fr.dg = 128;
            const q = t < 450 ? t : t - 450, r = q * 480 / 1000 | 0;
            const p = Math.trunc(f(255 * f(Math.exp(f((-6 * q) / f(1000))))));
            for (let i = 0; i < MX_LED_AMOUNT; i++) {
                put(i, col, imin(255, (140 * p / 255 | 0) + ((230 * tent(b_dist[i] * 16 - r, 80) / 255 | 0) * p / 255 | 0)) * fade / 255 | 0);
            }
            break;
        }

        default: {  // notify: two rings and an edge flash
            fr.dg = 128;
            const r1 = t * 480 / 1000 | 0, r2 = (t - 550) * 480 / 1000 | 0;
            const f1 = imax(0, 960 - r1) * 255 / 960 | 0, f2 = t > 550 ? imax(0, 960 - r2) * 255 / 960 | 0 : 0;
            const fl = t > 950 && t < 1500 ? 217 * imax(0, wave(t - 950, 733)) / 128 | 0 : 0;
            for (let i = 0; i < MX_LED_AMOUNT; i++) {
                const d = b_dist[i] * 16;
                let a = imax(tent(d - r1, 96) * f1 / 255 | 0, tent(d - r2, 96) * f2 / 255 | 0) * 230 / 255 | 0;
                if (b_dist[i] >= 33) a = imax(a, fl);
                put(i, col, a * fade / 255 | 0);
            }
            break;
        }
    }
}

// ================= 2: orbit round the edge =================

export function orbitState(n, t, col, k) {
    if (k <= 0) return;
    const c = n === A_THINKING ? mix(col, C_VIOLET, 128) : col;
    const n0 = ring_len[0], n1 = ring_len[1];

    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const r = ringOf(i);
        if (r > 1) continue;
        let a = 0;
        switch (n) {
            case A_LISTENING:  // one calm comet
                if (!r) a = 41 + (wave(t, 90) * 15 / 128 | 0) + (217 * comet(b_pos[i], t * 1664 / 1000 | 0, n0, 14 * 256) / 255 | 0);
                break;

            case A_THINKING:  // three comets and a counter-rotating one inside
                if (!r) {
                    const h = t * 5632 / 1000 | 0;
                    let m = 0;
                    for (let q = 0; q < 3; q++) m = imax(m, comet(b_pos[i], h + (q * n0 * 256 / 3 | 0), n0, 9 * 256));
                    a = 26 + (230 * m / 255 | 0);
                } else {
                    a = 20 + (153 * comet(b_pos[i], -(t * 4096) / 1000 | 0, n1, 7 * 256, true) / 255 | 0);
                }
                break;

            default: {  // speaking: the voice runs down the rim from the top
                let e = voice(t - arcOf(i) * 190);
                e = e * e / 255 | 0;
                a = r ? 8 + (77 * e / 255 | 0) : 20 + (217 * e / 255 | 0);
                break;
            }
        }
        put(i, c, a * k / 255 | 0);
    }
}

export function orbitShot(n, t, du, col) {
    const fade = smooth(du, du - 300, t);
    const n0 = ring_len[0];
    fr.dg = 153;

    switch (n) {
        case A_WAKE: {  // a comet speeds up round the rim, then the rings close like an iris
            const tc = f(imin(t, 1100) / f(1000));
            const h = Math.trunc(f(f(f(6 * tc) + f(f(f(f(f(152.07) * tc) * tc) * tc) / 3)) * 256));
            const tail = Math.trunc(f(f(6 + f(f(40 * tc) / f(1.1))) * 256));
            const u = smooth(1100, 1250, t), settle = 255 - (204 * smooth(1200, 1800, t) / 255 | 0);
            const c = mix(col, C_WHITE, 102 * tent(t - 1100, 250) / 255 | 0);
            for (let i = 0; i < MX_LED_AMOUNT; i++) {
                const r = ringOf(i);
                let a = 0;
                if (!r) {
                    a = 26 + (230 * comet(b_pos[i], h, n0, tail) / 255 | 0);
                    if (t >= 1100) a = (a * (255 - u) / 255 | 0) + (u * settle / 255 | 0);
                } else if (t > 1100) {
                    a = 217 * tent(t - (1100 + 150 * r), 220) / 255 | 0;
                }
                put(i, c, a);
            }
            break;
        }

        case A_DONE: {  // the rim fills clockwise from 12
            const prog = smooth(0, 700, t) * n0 * 256 / 255 | 0, flash = 102 * tent(t - 850, 220) / 255 | 0;
            for (let i = 0; i < MX_LED_AMOUNT; i++) {
                const r = ringOf(i), p = b_pos[i] * 256;
                let a = 0;
                if (!r) a = p < prog ? (p > prog - 768 ? 255 : 153) : 20;
                else if (r === 1) a = flash;
                put(i, col, a * fade / 255 | 0);
            }
            break;
        }

        case A_ERROR: {  // three blinks
            const on = t < 1200 && t % 400 < 220;
            const lit = [242, 102, 51, 0];
            for (let i = 0; i < MX_LED_AMOUNT; i++) {
                const r = ringOf(i);
                put(i, col, (on ? lit[r] : r ? 0 : 13) * fade / 255 | 0);
            }
            break;
        }

        default: {  // notify: two comets meet at 6 o'clock, then the rim flashes
            const h = t * 8704 / 1000 | 0;
            const fl = (242 * tent(t - 650, 300) / 255 | 0) + 46, f1 = t > 600 ? 153 * tent(t - 700, 300) / 255 | 0 : 0;
            for (let i = 0; i < MX_LED_AMOUNT; i++) {
                const r = ringOf(i);
                let a = 0;
                if (!r) {
                    a = imax(comet(b_pos[i], h, n0, 12 * 256), comet(b_pos[i], -h, n0, 12 * 256, true));
                    a = imax(a, t > 650 ? fl : 20);
                } else if (r === 1) {
                    a = f1;
                }
                put(i, col, a * fade / 255 | 0);
            }
            break;
        }
    }
}

// ================= 3: sparks gather into a mark =================

export const lens_w = [0, 128, 204, 255];

// pictograms: one row per entry, the leftmost pixel is the highest bit
export const pict_check = [0x003, 0x006, 0x10c, 0x198, 0x0f0];  // 9 wide
export const pict_cross = [0x63, 0x36, 0x1c, 0x36, 0x63];       // 7 wide
export const pict_bell = [0x1c, 0x3e, 0x3e, 0x7f, 0x08];        // 7 wide

export function mark(col, g, white) {
    const c = white ? mix(col, C_WHITE, white) : col;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const l = lensOf(i);
        if (l) put(i, c, lens_w[l] * g / 255 | 0);
    }
}

// drawn like a clock glyph: pixel (gx, gy) → (x0 + gx + gy / 2, 1 + gy) in the diagonal grid
export function pict(rows, w, col, a, dx) {
    const x0 = ((194 - 10 * w) / 20 | 0) + dx;
    for (let gy = 0; gy < 5; gy++) {
        for (let gx = 0; gx < w; gx++) {
            if (!((rows[gy] >> (w - 1 - gx)) & 1)) continue;
            const led = ledDiag(x0 + gx + (gy >> 1), 1 + gy);
            if (led >= 0) put(led, col, a);
        }
    }
}

// k: how far it shows (255 = all; less while it fades in after another wake)
export function sparksState(n, t, col, k) {
    fr.dg = 128;
    switch (n) {
        case A_LISTENING:  // the mark breathes
            mark(col, (77 + (128 * sin8((t * 256 / 3000 | 0) & 255) / 255 | 0)) * k / 255 | 0, 0);
            break;

        case A_THINKING: {  // three sparks orbit it
            const c = mix(col, C_VIOLET, 128), sc = mix(c, C_WHITE, 102);
            mark(c, (77 + (64 * sin8((t * 256 / 900 | 0) & 255) / 255 | 0)) * k / 255 | 0, 0);
            const nt = tracks.len;
            for (let m = 0; m < nt; m++) {
                let a = 0;
                for (let q = 0; q < 3; q++) {
                    const d = posMod((t * 9 * 256 / 1000 | 0) + (q * nt * 256 / 3 | 0) - m * 256, nt * 256);
                    if (d < 1024) {
                        const u = (1024 - d) * 255 / 1024 | 0;
                        a = imax(a, u * u / 255 | 0);
                    }
                }
                put(track[m], sc, (a * 242 / 255 | 0) * k / 255 | 0);
            }
            break;
        }

        default: {  // speaking: the mark opens ring by ring with the voice
            const th = [0, 140, 64, -3];  // halo, body, core
            const e = voice(t);
            for (let i = 0; i < MX_LED_AMOUNT; i++) {
                const l = lensOf(i);
                if (l) put(i, col, (lens_w[l] * ((l === 3 ? 77 : 0) + (179 * smooth(th[l], th[l] + 102, e) / 255 | 0)) / 255 | 0) * k / 255 | 0);
            }
            break;
        }
    }
}

export function sparksShot(n, t, du, col) {
    const fade = smooth(du, du - 300, t);

    if (n === A_WAKE) {  // 18 sparks fly in from the rim, the mark pops and settles to listening
        const trail = [255, 153, 77, 31];
        const sc = mix(col, C_WHITE, 128);
        let arrived = 0;
        fr.dg = 153;
        for (let k = 0; k < SPARKS; k++) {
            const u = t - 45 * ((k * 7) % SPARKS);
            if (u < 0) continue;
            if (u >= 750) {
                arrived++;
                continue;
            }
            let len = 0;
            while (len < SPARK_LEN && spark[k][len] !== 255) len++;
            const j = Math.trunc(f(f(Math.pow(f(u / f(750)), f(1.6))) * len));
            for (let q = 0; q < 4 && j - q >= 0; q++) put(spark[k][j - q], sc, trail[q]);
        }
        if (t > 1500) {
            const r = (t - 1500) * 640 / 1000 | 0, fk = imax(0, 800 - r) * 255 / 800 | 0;
            for (let i = 0; i < MX_LED_AMOUNT; i++) put(i, col, (102 * tent(b_dist[i] * 16 - r, 80) / 255 | 0) * fk / 255 | 0);
        }
        // the mark settles into the breath of the sparks listening, or out when another style listens after it
        const end = fr.ls === 3 ? 77 + (128 * sin8((fr.lt * 256 / 3000 | 0) & 255) / 255 | 0) : 0;
        const g = t < 1500 ? 217 * arrived / SPARKS | 0 : 255 - ((255 - end) * smooth(1600, du, t) / 255 | 0);
        mark(col, g, 204 * tent(t - 1550, 150) / 255 | 0);
        return;
    }

    // done, error, notify: a pictogram with the display to itself
    dimAll(255 - ((224 * smooth(0, 150, t) / 255 | 0) * fade / 255 | 0));
    fr.dg = 255;
    switch (n) {
        case A_DONE:
            pict(pict_check, 9, col, smooth(0, 100, t) * fade / 255 | 0, 0);
            break;

        case A_ERROR:
            pict(pict_cross, 7, col, t < 1200 && t % 400 < 240 ? fade : 0, 0);
            break;

        default: {  // the bell rings
            const s = t < 1300 ? wave(t, 815) : 0;
            pict(pict_bell, 7, col, smooth(0, 100, t) * fade / 255 | 0, s >= 107 ? 1 : s <= -107 ? -1 : 0);
            break;
        }
    }
}

export function stateDraw(style, n, t, col, k) {
    switch (style) {
        case 1: rippleState(n, t, col, k); break;
        case 2: orbitState(n, t, col, k); break;
        default: sparksState(n, t, col, k); break;
    }
}

export function shotDraw(style, n, t, du, col) {
    switch (style) {
        case 1: rippleShot(n, t, du, col); break;
        case 2: orbitShot(n, t, du, col); break;
        default: sparksShot(n, t, du, col); break;
    }
}

buildTables();
