// Kaya's styles of v1.8 (KAIA-195's catalog; the owner kept all six). A style is a whole visual language: its own
// version of all 7 events. kaia_anim 4–9 picks one as the style, and every event with look 0 «Как у стиля» plays its
// version; the versions also join every event's gallery as looks 9–14 and wakes 15–20, so any event can take them with
// any style, as 1–3 do. Ids are appended: style s is look s + 5 and wake s + 11.
//   4 Пинг-понг, 5 Калейдоскоп, 6 Лава-лампа, 7 Мордашка, 8 Галактика, 9 Сканер
// The wakes fade out over their last 400 ms (wakeDraw fades the listening in under their last 800), the other
// one-shots over their last 300 ms; the states loop.
//
// For the firmware: as looks.js, every function here is meant to be copied line by line into kaia.cpp. Integers only
// inside a frame; "x / y | 0" is C's x / y, "& 255" is (uint8_t), "a >> 3" and "Math.imul(…) >>> 24" (hash8) are the
// uint32_t ones; let / const are int (uint32_t for colours), arrays are static const tables or small int arrays on the
// stack. No floats, no closures.
import {
    A_DONE, A_ERROR, A_LISTENING, A_THINKING, A_WAKE, abs, b_ang, b_dist, C_VIOLET, C_WHITE, dimAll, fr, hash8, imax, imin,
    mix, oct, posMod, put, segDist, sin8, smooth, tent, voice, wave,
} from "./kaia.js";
import { MX_LED_AMOUNT } from "./matrix.js";
import { b_row, b_x, h1, h2, h3 } from "./wakes.js";

// kaia_anim: 0 Выкл, 1–3 the styles of v1.4, 4–9 these; the classic page's «Стиль» lists them in this order
export const STYLE_NAMES = ["Выкл", "Рябь", "Орбита", "Искры", "Пинг-понг", "Калейдоскоп", "Лава-лампа", "Мордашка", "Галактика", "Сканер"];
export const STYLE_COUNT = 9;  // the last style id

// the one-shot lengths of styles 4–9, ms: done, error, notify (their wakes are wake_ms[15..20])
export const fam_ms = [
    [1500, 1600, 1600],
    [1600, 1600, 1700],
    [1600, 1600, 1600],
    [1700, 1600, 1500],
    [1700, 1700, 1500],
    [1500, 1600, 1500],
];

// ================= the helpers of the new styles =================
// p = 4·(x − 19), q = 7·(row − 3): a ball from the middle in 1/8 balls (p to the right, q down), as in KAIA-173

// the six-fold fold of an angle (256 a turn): 0 on the six mirror lines (12 o'clock and every 60°), 127 halfway
export function kfold(a) {
    const s = (a * 6) & 255;
    return s < 128 ? s : 255 - s;
}

// an ellipse's measure at (dx, dy), half-axes w and h (1/8 ball, at least 1): 256 on it, less inside
export function ell(dx, dy, w, h) {
    return (dx * dx * 256 / (w * w) | 0) + (dy * dy * 256 / (h * h) | 0);
}

// a metaball's share of the field at (dx, dy) from its centre, radius r: 256 on its rim, at most 1024
export function blob(dx, dy, r) {
    return imin(1024, r * r * 256 / (dx * dx + dy * dy + 1) | 0);
}

// ================= 4 · Пинг-понг: the clock is made of ping-pong balls, so a rally =================

// the scenery: the paddles at both edges round y0 (hl, hr: how bright each flashes), the net in the middle of rows 5–6,
// the table along the bottom row
export function ppScene(p, q, y0, hl, hr) {
    if (abs(p) >= 68 && abs(q - y0) <= 11) return 70 + ((p < 0 ? hl : hr) * 185 / 255 | 0);
    if (q >= 14 && abs(p) <= 4) return 55;
    return q === 21 ? 14 : 0;
}

// one crossing, u = 0..255 from a paddle: the ball drops from 18 − h to the table (y = 18) at u = 170, then rises
// back to 18 − h at the other paddle; y in 1/8 ball
export function ppY(u, h) {
    if (u < 170) return 18 - h + (h * u * u / 28900 | 0);
    return 18 - (h * (u - 170) * (340 - u) / 7225 | 0);
}

// the rally: a crossing in P ms at height h; the ball and two ghosts gap ms behind it; a paddle flashes on its hit
export function ppRally(t, col, k, P, h, gap) {
    if (k <= 0) return;
    const wc = mix(col, C_WHITE, 170), bx = [0, 0, 0], by = [0, 0, 0];
    for (let m = 0; m < 3; m++) {
        const s = posMod(t - m * gap, 2 * P), u = posMod(s, P) * 256 / P | 0;
        bx[m] = s < P ? -64 + (u >> 1) : 64 - (u >> 1);
        by[m] = ppY(u, h);
    }
    const s0 = posMod(t, 2 * P), hl = imax(tent(s0, 160), tent(s0 - 2 * P, 160)), hr = tent(s0 - P, 160);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = ppScene(p, q, 18 - h, hl, hr), c = col;
        for (let m = 0; m < 3; m++) {
            const v = tent(oct(p - bx[m], q - by[m]), m ? 9 : 12) * (m ? 130 - m * 40 : 255) / 255 | 0;
            if (v > a) {
                a = v;
                c = m ? col : wc;
            }
        }
        put(i, c, a * k / 255 | 0);
    }
}

// Слушает · Розыгрыш: a slow rally over the net, 1.4 s a crossing
export function ppListen(n, t, col, k) {
    ppRally(t, col, k, 1400, 22, 60);
}

// Думает · Быстрый розыгрыш: the same rally almost three times faster and lower, half violet
export function ppThink(n, t, col, k) {
    ppRally(t, mix(col, C_VIOLET, 128), k, 520, 16, 26);
}

// Говорит · Подскоки: the ball hops in the middle as high as the voice; when it lands, the table under it lights
export function ppSpeak(n, t, col, k) {
    if (k <= 0) return;
    const wc = mix(col, C_WHITE, 170), bx = wave(t, 37) * 36 / 128 | 0, by = [0, 0, 0];
    for (let m = 0; m < 3; m++) by[m] = 18 - (voice(t - m * 50) * 32 / 255 | 0);
    const land = imax(0, 255 - (18 - by[0]) * 24);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = ppScene(p, q, -4, 0, 0), c = col;
        if (q === 21) a = imax(a, land * tent(p - bx, 20) / 255 | 0);
        for (let m = 0; m < 3; m++) {
            const v = tent(oct(p - bx, q - by[m]), m ? 9 : 12) * (m ? 130 - m * 40 : 255) / 255 | 0;
            if (v > a) {
                a = v;
                c = m ? col : wc;
            }
        }
        put(i, c, a * k / 255 | 0);
    }
}

// Пробуждение · Подача: a serve flies in from the left, bounces lower and lower, comes to rest in the middle and glows
const pp_bt = [420, 780, 1040, 1200], pp_bh = [24, 12, 5];  // the landings, ms; the hops between them, 1/8 ball

export function ppServeX(t) {
    if (t >= 1400) return 0;
    return -88 + (88 * (t * (2800 - t) / 1400 | 0) / 1400 | 0);
}

export function ppServeY(t) {
    if (t < 420) return -26 + (44 * t * t / 176400 | 0);
    for (let j = 0; j < 3; j++) {
        if (t < pp_bt[j + 1]) {
            const v = t - pp_bt[j], L = pp_bt[j + 1] - pp_bt[j];
            return 18 - (4 * pp_bh[j] * v * (L - v) / (L * L) | 0);
        }
    }
    return 18;
}

export function ppWake(n, t, du, col) {
    const fo = smooth(du, du - 400, t), wc = mix(col, C_WHITE, 170);
    const bx = [0, 0, 0], by = [0, 0, 0], lx = [0, 0, 0, 0];
    for (let m = 0; m < 3; m++) {
        const u = imax(0, t - m * 40);
        bx[m] = ppServeX(u);
        by[m] = ppServeY(u);
    }
    for (let j = 0; j < 4; j++) lx[j] = ppServeX(pp_bt[j]);
    const ra = t - 1400, rr = ra * 50 / 1000 | 0, rf = ra > 0 ? 255 - smooth(0, 400, ra) : 0;  // a ring from the ball at rest
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = 0, c = col;
        if (q === 21) {  // the table: a flash under every landing
            a = 14 * smooth(0, 300, t) / 255 | 0;
            for (let j = 0; j < 4; j++) {
                const age = t - pp_bt[j];
                if (age >= 0 && age < 300) a = imax(a, (tent(p - lx[j], 20) * (300 - age) / 300 | 0) * (255 - j * 50) / 255 | 0);
            }
        }
        if (rf) a = imax(a, tent(oct(p, q - 18) - rr, 7) * rf / 255 | 0);
        for (let m = 0; m < 3; m++) {
            if (m && t < m * 40) break;
            const v = tent(oct(p - bx[m], q - by[m]), m ? 9 : 12) * (m ? 130 - m * 40 : 255) / 255 | 0;
            if (v > a) {
                a = v;
                c = m ? col : wc;
            }
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// Готово · Смэш: a high lob on the left, a smash into the far corner with a streak, a flash where it lands; the point is won
const pp_smash = [-34, -18, 56, 18];
export function ppDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t), wc = mix(col, C_WHITE, 190), e = smooth(0, 380, t);
    const s = t < 380 ? 0 : imin(256, (t - 380) * 256 / 120 | 0);  // the smash along pp_smash, 0..256
    const bx = t < 380 ? -62 + (28 * e / 255 | 0) : -34 + (90 * s / 256 | 0);
    const by = t < 380 ? 14 - (32 * e / 255 | 0) : -18 + (36 * s / 256 | 0);
    const age = t - 500, rr = age * 140 / 1000 | 0, rf = age > 0 ? imax(0, 255 - (age * 255 / 700 | 0)) : 0;
    const fl = tent(t - 540, 220), pt = smooth(650, 850, t), sf = age < 0 ? 220 : imax(0, 220 - (age * 220 / 300 | 0));
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = ppScene(p, q, -4, 0, tent(age, 200)) >> 1, c = col;
        if (p > 0) a = imax(a, 80 * pt / 255 | 0);  // the point: the winner's half lights
        if (s && sf) a = imax(a, tent(segDist(p, q, pp_smash, s), 7) * sf / 255 | 0);
        if (rf) a = imax(a, tent(oct(p - 56, q - 18) - rr, 8) * rf / 255 | 0);
        if (fl) {
            const v = fl * 120 / 255 | 0;
            if (v > a) {
                a = v;
                c = mix(col, C_WHITE, 120);
            }
        }
        if (age < 150) {
            const v = tent(oct(p - bx, q - by), 12);
            if (v > a) {
                a = v;
                c = wc;
            }
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// Ошибка · В сетку: the ball flies into the net, the net shakes, the ball drops to the table and rolls off the edge
export function ppError(n, t, du, col) {
    const fo = smooth(du, du - 300, t), wc = mix(col, C_WHITE, 110), hit = tent(t - 540, 300);
    let bx = 0, by = 18, g = 255;
    if (t < 520) {
        bx = -64 + (60 * t / 520 | 0);
        by = -6 + (20 * t * t / 270400 | 0);
    } else if (t < 760) {
        const v = t - 520;
        bx = -4 - (6 * v / 240 | 0);
        by = 14 + (4 * v * v / 57600 | 0);
    } else {
        const w = imin(t - 760, 700);
        bx = -10 - (76 * w * w / 490000 | 0);
        g = 255 - (150 * w / 700 | 0);
    }
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = q === 21 ? 18 : 0, c = col;
        if (q >= 14 && abs(p) <= 4) {  // the net lights up and trembles
            a = 60 + (hit * 195 / 255 | 0);
            if (hit && ((b_row[i] + (t / 50 | 0)) & 1)) a = a * 3 / 5 | 0;
            if (hit > 128) c = wc;
        }
        const v = tent(oct(p - bx, q - by), 12) * g / 255 | 0;
        if (v > a) {
            a = v;
            c = wc;
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// Уведомление · Мячик: a ball bounces on the spot in the middle, three hops; each landing knocks a ring out of the table
export function ppNotify(n, t, du, col) {
    const fo = smooth(du, du - 300, t), wc = mix(col, C_WHITE, 170);
    const v = t < 1260 ? t % 420 : 0, by = 18 - (120 * v * (420 - v) / 176400 | 0);  // 30 high
    const la = t < 1260 ? v : t - 1260, rr = la * 90 / 1000 | 0, rf = imax(0, 255 - (la * 255 / 500 | 0));
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = q === 21 ? imax(16, tent(p, 24) * rf / 255 | 0) : 0, c = col;
        a = imax(a, tent(oct(p, q - 18) - rr, 6) * rf / 400 | 0);
        const b = tent(oct(p, q - by), 12);
        if (b > a) {
            a = b;
            c = wc;
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// ================= 5 · Калейдоскоп: the hexagon's own six-fold symmetry (b_ang folded into six mirrored sectors) =================

// Слушает · Вращение: six petals round a bright centre turn slowly (30 s a turn); six outer spots turn the other way; it breathes
export function kalListen(n, t, col, k) {
    if (k <= 0) return;
    const rot = t * 256 / 30000 | 0, br = 200 + (wave(t, 50) * 55 / 128 | 0), wc = mix(col, C_WHITE, 150);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i], L = 18 * (255 - 2 * kfold(b_ang[i] + rot)) / 255 | 0;
        let a = 0, c = col;
        if (d < 4) {
            a = 230;
            c = wc;
        } else if (d <= L) {
            const e = tent(d - L, 5);
            a = 80 + (140 * e / 255 | 0);
            c = mix(col, C_WHITE, 110 * e / 255 | 0);
        } else if (d >= 21) {
            a = tent(kfold(b_ang[i] - 2 * rot + 21), 30) * tent(d - 28, 7) / 255 | 0;
        }
        put(i, c, (a * br / 255 | 0) * k / 255 | 0);
    }
}

// Думает · Узоры: two six-pointed stars turn against each other and stretch in turn; rings run out; half violet
export function kalThink(n, t, col, k) {
    if (k <= 0) return;
    const c = mix(col, C_VIOLET, 128), c2 = mix(c, C_WHITE, 120);
    const rot = t * 256 / 5000 | 0, w = wave(t, 200), e1 = 18 + (w * 10 / 128 | 0), e2 = 18 - (w * 10 / 128 | 0);
    const rr = posMod(t * 500 / 1000 | 0, 640);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i];
        const L1 = e1 * (127 - kfold(b_ang[i] + rot)) / 127 | 0, L2 = e2 * (127 - kfold(b_ang[i] - rot + 21)) / 127 | 0;
        const a1 = d <= L1 ? 90 + (165 * tent(d - L1, 5) / 255 | 0) : 0, a2 = d <= L2 ? 70 + (150 * tent(d - L2, 5) / 255 | 0) : 0;
        let a = imax(a1, a2), cc = a2 > a1 ? c2 : c;
        a = imax(a, tent(d * 16 - rr, 60) * 70 / 255 | 0);
        if (d < 3) {
            a = 255;
            cc = c2;
        }
        put(i, cc, a * k / 255 | 0);
    }
}

// Говорит · Дыхание лепестков: the petals stretch with the voice, the centre flashes; the outer spots answer a beat later
export function kalSpeak(n, t, col, k) {
    if (k <= 0) return;
    const v = voice(t), v2 = voice(t - 140), rot = t * 256 / 20000 | 0, wc = mix(col, C_WHITE, 150);
    const e = 6 + (v * 22 / 255 | 0), og = 40 + (v2 * 215 / 255 | 0);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i], L = e * (255 - 2 * kfold(b_ang[i] + rot)) / 255 | 0;
        let a = 0, c = col;
        if (d < 3) {
            a = 150 + (v * 105 / 255 | 0);
            c = wc;
        } else if (d <= L) {
            a = 80 + (175 * tent(d - L, 5) / 255 | 0);
            if (d > L - 3) c = wc;
        } else if (d >= 21) {
            a = (tent(kfold(b_ang[i] - rot + 21), 30) * tent(d - 28, 7) / 255 | 0) * og / 255 | 0;
        }
        put(i, c, a * k / 255 | 0);
    }
}

// Пробуждение · Мандала: a white seed; six petals unfold from it while the mandala turns a quarter turn and stops; the outer spots light
export function kalWake(n, t, du, col) {
    const fo = smooth(du, du - 400, t), wc = mix(col, C_WHITE, 170);
    const g = smooth(200, 1300, t), rot = 64 - (64 * g / 255 | 0), e = 4 + (20 * g / 255 | 0);
    const seed = imax(tent(t - 150, 250), 140 * smooth(0, 200, t) / 255 | 0), sp = smooth(900, 1400, t);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i], L = e * (255 - 2 * kfold(b_ang[i] + rot)) / 255 | 0;
        let a = 0, c = col;
        if (d < 4) {
            a = seed;
            c = wc;
        } else if (t > 200 && d <= L) {
            const v = tent(d - L, 5);
            a = 80 + (175 * v / 255 | 0);
            if (g < 255 && v > 128) c = wc;
        } else if (sp && d >= 21) {
            a = (tent(kfold(b_ang[i] + 21), 30) * tent(d - 28, 7) / 255 | 0) * sp / 255 | 0;
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// Готово · Цветок: a green flower opens: six round petals with gaps between them (those to 3 and 9 o'clock the longest), a flash to white
export function kalDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t), e = smooth(0, 700, t) * 30 / 255 | 0, fl = tent(t - 820, 220);
    const pc = mix(col, C_WHITE, 160 * fl / 255 | 0), cc = mix(col, C_WHITE, 120 + (135 * fl / 255 | 0));
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i], m = kfold(b_ang[i] + 21), L = e * imax(0, 255 - (m * m / 32 | 0)) / 255 | 0;
        if (d < 4) put(i, cc, imax(110, smooth(0, 200, t)) * fo / 255 | 0);
        else if (d <= L) put(i, pc, (110 + (145 * tent(d - L, 6) / 255 | 0)) * fo / 255 | 0);
    }
}

// Ошибка · Осколки: the mandala cracks and flies apart in twelve shards, each at its own speed; they flicker out
const kal_sp = [30, 44, 24, 38, 28, 46, 26, 40, 34, 22, 42, 32];  // the shards' speeds, quarter-balls a second
export function kalError(n, t, du, col) {
    const fo = smooth(du, du - 300, t), wc = mix(col, C_WHITE, 170), cr = tent(t - 160, 120), g = 255 - smooth(220, 1300, t);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i], w = b_ang[i] * 12 >> 8, s = (b_ang[i] * 12) & 255;  // the shard and the place in it
        let a = 0, c = col;
        if (t < 220) {  // the whole plate, the petals brighter; the cracks flash white between the shards
            if (d <= 18) a = d <= (18 * (255 - 2 * kfold(b_ang[i])) / 255 | 0) ? 230 : 140;
            if (cr && d <= 20 && (s <= 20 || s >= 236)) {
                a = imax(a, cr);
                c = wc;
            }
        } else {
            const d0 = d - ((t - 220) * kal_sp[w] / 1000 | 0);  // where the ball was in its shard before it flew
            if (d0 >= 0 && d0 <= 18 && s > 20 && s < 236) {
                a = 210 * g / 255 | 0;
                if (!((w * 5 + (t / 70 | 0)) & 3)) a = a >> 1;
            }
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// Уведомление · Лепестки по кругу: six petals light one after another clockwise, two rounds, then all six flash together
export function kalNotify(n, t, du, col) {
    const fo = smooth(du, du - 300, t), wc = mix(col, C_WHITE, 170), all = tent(t - 1450, 160);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i], L = 20 * (255 - 2 * kfold(b_ang[i])) / 255 | 0;
        if (d > L && d >= 4) continue;
        const u = t - (((b_ang[i] + 21) & 255) * 6 >> 8) * 110;  // the petal's turns at u = 0 and 660 ms
        let a = 16;
        if (u >= 0 && t < 1350) a = imax(a, imax(tent(u - 50, 130), tent(u - 710, 130)));
        a = imax(a, all);
        put(i, a > 200 ? wc : col, a * fo / 255 | 0);
    }
}

// ================= 6 · Лава-лампа: soft blobs (metaballs); the surface where the field is 256 =================

// a ball under the field S: nothing below 150, a soft rim up to 300, whiter where the lava is thick (over 360)
export function lavaPut(i, S, col, wc, g) {
    if (S < 150) return;
    const a = S < 300 ? (S - 150) * 255 / 150 | 0 : 255;
    put(i, S > 600 ? wc : S > 360 ? mix(col, wc, (S - 360) * 255 / 240 | 0) : col, (a * 235 / 255 | 0) * g / 255 | 0);
}

// Слушает · Дрейф: three soft blobs drift slowly round each other and flow together where they meet; the bottom row is warm
export function lavaListen(n, t, col, k) {
    if (k <= 0) return;
    const bp = [0, 0, 0], bq = [0, 0, 0], wc = mix(col, C_WHITE, 110);
    for (let j = 0; j < 3; j++) {
        bp[j] = wave(t + j * 2100, 17 + j * 6) * 52 / 128 | 0;
        bq[j] = wave(t + j * 1300, 29 + j * 5) * 14 / 128 | 0;
    }
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let S = b_row[i] === 6 ? 170 : 0;
        for (let j = 0; j < 3; j++) S += blob(p - bp[j], q - bq[j], 11 + 2 * j);
        lavaPut(i, S, col, wc, k);
    }
}

// Думает · Слияния: four blobs rush about faster, merge and tear apart; half violet
export function lavaThink(n, t, col, k) {
    if (k <= 0) return;
    const c = mix(col, C_VIOLET, 128), wc = mix(c, C_WHITE, 120), bp = [0, 0, 0, 0], bq = [0, 0, 0, 0];
    for (let j = 0; j < 4; j++) {
        bp[j] = wave(t + j * 1700, 61 + j * 13) * 56 / 128 | 0;
        bq[j] = wave(t + j * 900, 83 + j * 11) * 16 / 128 | 0;
    }
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let S = 0;
        for (let j = 0; j < 4; j++) S += blob(p - bp[j], q - bq[j], 9 + j);
        lavaPut(i, S, c, wc, k);
    }
}

// Говорит · Пульс: three blobs in their places swell with the voice, each a beat after the one before; loud, they touch
export function lavaSpeak(n, t, col, k) {
    if (k <= 0) return;
    const wc = mix(col, C_WHITE, 130), bp = [0, 0, 0], br = [0, 0, 0];
    for (let j = 0; j < 3; j++) {
        bp[j] = -44 + 44 * j + (wave(t + j * 700, 23) * 8 / 128 | 0);
        br[j] = 7 + (voice(t - j * 70) * 9 / 255 | 0) + (j === 1 ? 2 : 0);
    }
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let S = 0;
        for (let j = 0; j < 3; j++) S += blob(p - bp[j], q, br[j]);
        lavaPut(i, S, col, wc, k);
    }
}

// Пробуждение · Всплытие: a blob rises from under the bottom edge to the middle and splits in three that drift apart
export function lavaWake(n, t, du, col) {
    const fo = smooth(du, du - 400, t), wc = mix(col, C_WHITE, 130);
    const by = 44 - (smooth(0, 800, t) * 44 / 255 | 0), sp = smooth(800, 1500, t) * 46 / 255 | 0;
    const rc = 15 - (4 * smooth(800, 1400, t) / 255 | 0), rs = 6 + (5 * smooth(700, 1000, t) / 255 | 0);
    const c = mix(col, C_WHITE, tent(t - 950, 200) * 120 / 255 | 0);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let S = blob(p, q - by, rc);
        if (t > 700) S += blob(p + sp, q - by + (sp >> 3), rs) + blob(p - sp, q - by - (sp >> 3), rs);
        lavaPut(i, S, c, wc, fo);
    }
}

// Готово · Слияние: three blobs flow into the middle and merge into one; it glows and pulses white
const lava_from = [-56, -8, 52, 6, 6, 18];  // where the three start, (p, q)
export function lavaDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t), g = 255 - smooth(0, 700, t), pl = tent(t - 850, 220);
    const r = 11 + (5 * pl / 255 | 0), c = mix(col, C_WHITE, 150 * pl / 255 | 0), wc = mix(col, C_WHITE, 170);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let S = 0;
        for (let j = 0; j < 3; j++) S += blob(p - (lava_from[2 * j] * g / 255 | 0), q - (lava_from[2 * j + 1] * g / 255 | 0), r);
        lavaPut(i, S, c, wc, fo);
    }
}

// Ошибка · Стекает: the blobs at the top let go and drip down one after another with a stretching neck; a puddle, then dark
const drip_x = [-44, 4, 46], drip_t = [0, 200, 380];
export function lavaError(n, t, du, col) {
    const fo = smooth(du, du - 300, t), g = (255 - smooth(500, 1300, t)) * fo / 255 | 0, wc = mix(col, C_WHITE, 90);
    const pd = (150 + (150 * tent(t - 900, 500) / 255 | 0)) * smooth(500, 700, t) / 255 | 0;
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let S = 0;
        for (let j = 0; j < 3; j++) {
            const v = imax(0, t - drip_t[j]), y = -12 + (64 * v * v / 640000 | 0);
            S += blob(p - drip_x[j], q - y, 11) + blob(p - drip_x[j], q - ((y - 12) >> 1), 5);  // the drop and its neck
        }
        if (b_row[i] === 6) S = imax(S, pd);
        lavaPut(i, S, col, wc, g);
    }
}

// Уведомление · Пузырь: a blob rises from the bottom to the top row and pops: it flashes white and a ring goes out
export function lavaNotify(n, t, du, col) {
    const fo = smooth(du, du - 300, t), wc = mix(col, C_WHITE, 170);
    const y = 40 - (smooth(0, 820, t) * 56 / 255 | 0), x = wave(imin(t, 820), 300) * 6 / 128 | 0;
    const r = t < 820 ? 11 : imax(0, 11 - ((t - 820) * 11 / 90 | 0)), c = mix(col, C_WHITE, tent(t - 820, 120) * 200 / 255 | 0);
    const ra = t - 840, rr = ra * 110 / 1000 | 0, rf = ra > 0 ? imax(0, 255 - (ra * 255 / 600 | 0)) : 0;
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        if (r) lavaPut(i, blob(p - x, q - y, r), c, wc, fo);
        if (rf) put(i, wc, (tent(oct(p - x, q - y) - rr, 6) * rf / 255 | 0) * fo / 255 | 0);
    }
}

// ================= 7 · Мордашка: Kaya as a tiny face, two eyes in row 2 and a mouth in rows 4–6, never text =================

// e: the eyes (0 ovals, 1 happy «^», 2 «×»); oL, oR: how open each oval is (0 a line, 255 open, up to 400 wide);
// gx, gy: where they look (1/8 ball); mc: the mouth's curve (corners up +, down −), mw: its half-width, mo: how open
// (0 a line); mx: the mouth's shift; g: how much shows. The face takes the display: the time steps back under it.
export function face(e, oL, oR, gx, gy, mc, mw, mo, mx, col, g) {
    if (g <= 0) return;
    dimAll(255 - (170 * g / 255 | 0));
    fr.dg = 255;
    const wc = mix(col, C_WHITE, 110);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        const o = imax(0, p < 0 ? oL : oR), kind = e === 1 && !o ? 0 : e;  // a winking «^» shuts into a line
        const ex = (p < 0 ? p + 32 : p - 32) - (kind ? 0 : gx), ey = q + 7 - (kind ? 0 : gy);  // from the eye's centre
        let a = 0, c = col;
        if (abs(ex) < 20 && abs(ey) < 24) {
            if (!kind) {
                const wd = imax(0, o - 255), el = ell(ex, ey, 11 + (wd * 5 / 145 | 0), 1 + (imin(o, 255) * 10 / 255 | 0) + (wd * 8 / 145 | 0));
                a = el <= 256 ? 255 : el < 420 ? (420 - el) * 255 / 164 | 0 : 0;
                if (el < 90) c = wc;
            } else if (kind === 1) {  // «^»: rows 1–2, 4 and 8 to each side
                const ax = abs(ex);
                if ((abs(ey + 7) < 3 && abs(ax - 4) < 3) || (abs(ey) < 3 && abs(ax - 8) < 3)) a = 255;
            } else if (abs(ey) <= 16 && abs(abs(ex) * 7 - abs(ey) * 4) < 10) {  // «×»: rows 0–4
                a = 255;
            }
        }
        const dx = p - mx;
        if (q >= 0 && abs(dx) <= mw + 8) {  // the mouth round (mx, 14)
            let m = 0;
            if (mo > 0) {
                const el = ell(dx, q - 14, mw, 1 + mo);
                m = el <= 256 ? (mo > 5 && el < 100 ? 110 : 255) : el < 400 ? (400 - el) * 255 / 144 | 0 : 0;
            } else if (abs(dx) <= mw) {
                m = tent(q - 14 + (mc * dx * dx / (mw * mw) | 0), 6);
            }
            if (m > a) {
                a = m;
                c = col;
            }
        }
        put(i, c, a * g / 255 | 0);
    }
}

// Слушает · Смотрит: she looks at you with a gentle smile, blinks every 4.2 s (twice every other time), now and then glances aside
export function faceListen(n, t, col, k) {
    if (k <= 0) return;
    const ph = posMod(t, 8400), b = ph < 4200 ? ph : ph - 4200, g3 = posMod(t, 12600);
    const o = 255 - imax(tent(b - 4000, 110), ph >= 4200 ? tent(b - 3700, 110) : 0);
    const gx = -(8 * smooth(6000, 6300, g3) / 255 | 0) + (8 * smooth(8000, 8300, g3) / 255 | 0);
    face(0, o, o, gx, 0, 7, 16, 0, 0, col, k);
}

// Думает · Задумалась: half-shut eyes look up to the left, then up to the right; the mouth a short line to one side: «hmm»
export function faceThink(n, t, col, k) {
    if (k <= 0) return;
    const ph = posMod(t, 3200), gx = -10 + (20 * smooth(1400, 1700, ph) / 255 | 0) - (20 * smooth(2900, 3200, ph) / 255 | 0);
    face(0, 190, 190, gx, -6, 0, 8, 0, 12, mix(col, C_VIOLET, 128), k);
}

// Говорит · Говорит: the mouth opens with the voice; loud, the eyes narrow a little; a blink now and then
export function faceSpeak(n, t, col, k) {
    if (k <= 0) return;
    const v = voice(t), mo = v * 11 / 255 | 0, o = 255 - (v >> 3) - tent(posMod(t, 5300) - 5100, 110);
    face(0, o, o, 0, 0, 3, 14 + (mo >> 1), mo, 0, col, k);
}

// Пробуждение · Просыпается: closed eyes fade in, open, blink once, and a smile comes
export function faceWake(n, t, du, col) {
    const g = smooth(0, 300, t) * smooth(du, du - 400, t) / 255 | 0;
    const o = smooth(500, 850, t) * (255 - tent(t - 1150, 110)) / 255 | 0;
    face(0, o, o, 0, 0, 7 * smooth(1300, 1650, t) / 255 | 0, 16, 0, 0, col, g);
}

// Готово · Подмигивает: happy «^ ^» eyes and a wide smile; at 0.65 s she winks with the right eye
export function faceDone(n, t, du, col) {
    const g = smooth(0, 150, t) * smooth(du, du - 300, t) / 255 | 0;
    face(1, 255, t > 650 && t < 1000 ? 0 : 255, 0, 0, 10 * smooth(0, 250, t) / 255 | 0, 20, 0, 0, col, g);
}

// Ошибка · Огорчение: the eyes turn into «×», the mouth into a frown; the face blinks out twice
export function faceError(n, t, du, col) {
    const on = t < 700 || (t >= 820 && t < 1000) || t >= 1120;
    face(2, 255, 255, 0, 0, -7, 16, 0, 0, col, (on ? smooth(0, 120, t) : 60) * smooth(du, du - 300, t) / 255 | 0);
}

// Уведомление · Удивление: the eyes pop wide, ease and pop again (a double take); the mouth a small «o»
export function faceNotify(n, t, du, col) {
    const o = 255 + (145 * smooth(150, 260, t) / 255 | 0) - (145 * smooth(560, 660, t) / 255 | 0) + (145 * smooth(760, 860, t) / 255 | 0);
    face(0, o, o, 0, 0, 0, 7, 5, 0, col, smooth(0, 120, t) * smooth(du, du - 300, t) / 255 | 0);
}

// ================= 8 · Галактика: a two-armed spiral, (2·b_ang + 9·d − rot) & 255, and stars on h1 =================

// the arms at the ball (d: its distance as drawn): 255 on an arm, 0 between them
export function arm(i, d, rot) {
    const v = (b_ang[i] * 2 + d * 9 - rot) & 255;
    return tent(imin(v, 256 - v), 40);
}

// a star twinkling on about one ball in six (h1 < 40), away from the core: 0..150
export function galStar(i, t) {
    if (h1[i] >= 40 || b_dist[i] <= 8) return 0;
    const s = sin8((h2[i] + (t * (150 + (h3[i] & 63)) / 1000 | 0)) & 255);
    return 150 * (s * s / 255 | 0) / 255 | 0;
}

// Слушает · Спираль: two arms turn slowly (they meet themselves every 10 s), the core glows evenly, the stars twinkle
export function galListen(n, t, col, k) {
    if (k <= 0) return;
    const rot = t * 256 / 10000 | 0, wc = mix(col, C_WHITE, 170);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i];
        let a = arm(i, d, rot) * (170 - d * 3) / 255 | 0, c = col;
        if (d < 6) {
            a = imax(a, 230 - d * 20);
            c = wc;
        }
        const s = galStar(i, t);
        if (s > a) {
            a = s;
            c = wc;
        }
        put(i, c, a * k / 255 | 0);
    }
}

// Думает · Вихрь ядра: the arms turn faster, and in the core a four-armed whirl turns the other way, fast; half violet
export function galThink(n, t, col, k) {
    if (k <= 0) return;
    const c = mix(col, C_VIOLET, 128), wc = mix(c, C_WHITE, 170), rot = t * 256 / 2600 | 0, sw = t * 256 / 600 | 0;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i];
        let a = arm(i, d, rot) * (150 - d * 3) / 255 | 0, cc = c;
        if (d < 14) {
            const v = (b_ang[i] * 4 - d * 18 + sw) & 255, s = tent(imin(v, 256 - v), 40) * (14 - d) / 14 | 0;
            if (s > a) {
                a = s;
                cc = wc;
            }
        }
        if (d < 3) {
            a = 255;
            cc = wc;
        }
        a = imax(a, galStar(i, t) >> 1);
        put(i, cc, a * k / 255 | 0);
    }
}

// Говорит · Пульс ядра: the core swells with the voice; the arms flare a beat later
export function galSpeak(n, t, col, k) {
    if (k <= 0) return;
    const v = voice(t), ag = 60 + (voice(t - 160) * 140 / 255 | 0), rot = t * 256 / 12000 | 0, wc = mix(col, C_WHITE, 180);
    const rc = 3 + (v * 10 / 255 | 0);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i];
        let a = (arm(i, d, rot) * ag / 255 | 0) * (255 - d * 4) / 255 | 0, c = col;
        if (d <= rc) {
            a = 255 - (d * 60 / (rc + 1) | 0);
            c = wc;
        } else if (d <= rc + 3) {
            a = imax(a, 120 * (rc + 4 - d) / 4 | 0);
        }
        a = imax(a, galStar(i, t) >> 1);
        put(i, c, a * k / 255 | 0);
    }
}

// Пробуждение · Большой взрыв: a white flash in the middle, a ring flying out; the arms grow from the core and wind; stars come out
export function galWake(n, t, du, col) {
    const fo = smooth(du, du - 400, t), wc = mix(col, C_WHITE, 200);
    const fl = tent(t - 120, 200), rr = t * 900 / 1000 | 0, rf = imax(0, 255 - (t * 255 / 700 | 0));
    const R = smooth(250, 1500, t) * 40 / 255 | 0, rot = 200 - (200 * smooth(250, 1700, t) / 255 | 0), sd = smooth(700, 1500, t) * 40 / 255 | 0;
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i];
        let a = 0, c = col;
        if (d <= R) a = arm(i, d, rot) * (200 - d * 3) / 255 | 0;
        if (d < 5 && t > 150) a = imax(a, 200);
        const fv = imax(fl * tent(d, 14) / 255 | 0, tent(d * 16 - rr, 100) * rf / 255 | 0);
        if (fv > a) {
            a = fv;
            c = wc;
        }
        if (h1[i] < sd) a = imax(a, galStar(i, t));
        put(i, c, a * fo / 255 | 0);
    }
}

// Готово · Сверхновая: the star swells and blows up: a flash, a ring out past the edge, an uneven glow of the remnant, then calm
export function galDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t), wc = mix(col, C_WHITE, 210), core = t < 380 ? 2 + (t / 90 | 0) : 0;
    const age = t - 380, rr = age * 700 / 1000 | 0, rf = age > 0 ? imax(0, 255 - (age * 255 / 900 | 0)) : 0;
    const fl = tent(age - 40, 160) * 150 / 255 | 0, neb = age > 0 ? smooth(0, 300, age) * (255 - smooth(500, 1300, age)) / 255 | 0 : 0;
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i];
        let a = fl, c = fl > 60 ? wc : col;
        if (d <= core) {
            a = 255;
            c = wc;
        }
        if (rf) {
            const v = tent(d * 16 - rr, 90) * rf / 255 | 0;
            if (v > a) {
                a = v;
                c = wc;
            }
        }
        if (neb && d < 24) a = imax(a, ((80 + (h1[i] >> 1)) * (24 - d) / 24 | 0) * neb / 255 | 0);  // the remnant glows unevenly
        if (age > 300 && d < 3) a = imax(a, 170);
        put(i, c, a * fo / 255 | 0);
    }
}

// Ошибка · Чёрная дыра: the galaxy shrinks into the middle winding faster and faster, the display darkens; a dark hole with a ring stays
export function galError(n, t, du, col) {
    const fo = smooth(du, du - 300, t), z = smooth(0, 1000, t) * 3, rot = t * t / 2400 | 0;
    const hole = smooth(900, 1100, t), ring = tent(t - 1150, 300);
    dimAll(255 - ((180 * smooth(300, 1000, t) / 255 | 0) * fo / 255 | 0));
    fr.dg = 200;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const d = b_dist[i], dz = d * (256 + z) >> 8;  // the galaxy drawn (256 + z)/256 times smaller
        let a = 0;
        if (dz < 38) a = arm(i, dz, rot) * (220 - dz * 5) / 255 | 0;
        if (dz < 5) a = imax(a, 230);
        a = a * (255 - hole) / 255 | 0;
        if (d >= 3 && d <= 6) a = imax(a, ring * (255 - abs(d - 4) * 50) / 255 | 0);
        put(i, col, a * fo / 255 | 0);
    }
}

// Уведомление · Комета: a comet with a long tail crosses the display on a slant over faint stars
export function galNotify(n, t, du, col) {
    const fo = smooth(du, du - 300, t), wc = mix(col, C_WHITE, 200);
    const hx = -96 + (192 * t / 1200 | 0), hy = -20 + (36 * t / 1200 | 0), tl = [hx - 52, hy - 10, hx, hy];
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), q = 7 * (b_row[i] - 3);
        let a = galStar(i, t) >> 2, c = col;
        const d = segDist(p, q, tl, 256);
        if (d < 8) {
            const u = ((p - tl[0]) * 52 + (q - tl[1]) * 10) * 255 / 2804 | 0;  // 0 at the tail's end, 255 at the head
            a = imax(a, tent(d, 8) * imax(0, imin(255, u)) / 255 | 0);
        }
        const hd = oct(p - hx, q - hy);
        if (hd < 10) {
            a = imax(a, tent(hd, 10));
            if (hd < 5) c = wc;
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// ================= 9 · Сканер: the Knight Rider light, a band across all rows, brightest in the middle one =================

const scan_row = [90, 150, 215, 255, 215, 150, 90];

// Слушает · Луч: one soft beam sweeps left and right (3.2 s there and back) with a fading trail over a faint bar
export function scanListen(n, t, col, k) {
    if (k <= 0) return;
    const bx = [0, 0, 0, 0], wc = mix(col, C_WHITE, 140);
    for (let m = 0; m < 4; m++) bx[m] = wave(t - m * 70, 80) * 70 / 128 | 0;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), r = b_row[i];
        let a = 0;
        for (let m = 0; m < 4; m++) a = imax(a, tent(p - bx[m], 10) * (255 - m * 60) / 255 | 0);
        a = a * scan_row[r] / 255 | 0;
        if (r === 3) a = imax(a, 10);
        put(i, abs(p - bx[0]) < 5 ? wc : col, a * k / 255 | 0);
    }
}

// Думает · Два луча: two beams run towards each other and cross in the middle with a flash; half violet
export function scanThink(n, t, col, k) {
    if (k <= 0) return;
    const c = mix(col, C_VIOLET, 128), wc = mix(c, C_WHITE, 170), bx = [0, 0, 0];
    for (let m = 0; m < 3; m++) bx[m] = wave(t - m * 30, 200) * 70 / 128 | 0;
    const x = tent(bx[0], 12);  // the crossing
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), r = b_row[i];
        let a = 0;
        for (let m = 0; m < 3; m++) a = imax(a, imax(tent(p - bx[m], 9), tent(p + bx[m], 9)) * (255 - m * 75) / 255 | 0);
        a = a * scan_row[r] / 255 | 0;
        if (r === 3) a = imax(a, 10);
        put(i, x > 100 && abs(p) < 12 ? wc : c, a * k / 255 | 0);
    }
}

// Говорит · Ширина голосом: the beam stands near the middle; its width and brightness follow the voice
export function scanSpeak(n, t, col, k) {
    if (k <= 0) return;
    const v = voice(t), bx = wave(t, 40) * 24 / 128 | 0, w = 6 + (v * 46 / 255 | 0), wc = mix(col, C_WHITE, 150 * v / 255 | 0);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), r = b_row[i], e = w - abs(p - bx);
        let a = r === 3 ? 10 : 0;
        if (e > -8) a = imax(a, (e >= 0 ? 150 + (105 * imin(e, 16) / 16 | 0) : (8 + e) * 150 / 8 | 0) * scan_row[r] / 255 | 0);
        put(i, abs(p - bx) < 6 ? wc : col, a * k / 255 | 0);
    }
}

// Пробуждение · Запуск: the middle row lights from the centre out a ball at a time, gathers into one beam; it sweeps right, then left
export function scanWake(n, t, du, col) {
    const fo = smooth(du, du - 400, t), wc = mix(col, C_WHITE, 160), sq = smooth(650, 900, t);
    const hw = (smooth(0, 500, t) * 80 / 255 | 0) & ~7, L = hw - (hw * sq / 255 | 0);
    let bx = 0;
    if (t >= 1300) bx = 64 - (128 * smooth(1300, 1800, t) / 255 | 0);
    else if (t >= 900) bx = 64 * smooth(900, 1300, t) / 255 | 0;
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), r = b_row[i];
        let a = 0, c = col;
        if (t < 900) {
            if (r === 3 && abs(p) <= L + 4) {
                a = 255;
                if (abs(p) > L - 8) c = wc;
            }
            if (sq) a = imax(a, (tent(p, 10) * scan_row[r] / 255 | 0) * sq / 255 | 0);
        } else {
            a = tent(p - bx, 10) * scan_row[r] / 255 | 0;
            if (r === 3) a = imax(a, 10);
            if (abs(p - bx) < 5) c = wc;
        }
        put(i, c, a * fo / 255 | 0);
    }
}

// Готово · Проход: the beam runs right with a long trail, turns, and all it passes on the way back stays lit; a flash
export function scanDone(n, t, du, col) {
    const fo = smooth(du, du - 300, t), wc = mix(col, C_WHITE, 170), fl = tent(t - 1180, 180), back = t >= 600;
    const bx = back ? 80 - (160 * smooth(600, 1100, t) / 255 | 0) : -80 + (160 * smooth(0, 600, t) / 255 | 0);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), sr = scan_row[b_row[i]];
        let a = tent(p - bx, 10) * sr / 255 | 0;
        if (!back && p < bx) a = imax(a, (tent(bx - p, 70) * 3 / 4 | 0) * sr / 255 | 0);  // the trail
        if (back && p > bx) a = imax(a, 140);  // lit behind it
        a = imax(a, fl);
        put(i, fl > 100 || abs(p - bx) < 5 ? wc : col, a * fo / 255 | 0);
    }
}

// Ошибка · Сбой: the beam stutters, jumping and dropping out in 90 ms steps, then freezes, flickers and dies
export function scanError(n, t, du, col) {
    const fo = smooth(du, du - 300, t), sl = imin(t, 900) / 90 | 0, h = hash8(sl);
    const bx = (wave(sl * 90, 160) * 60 / 128 | 0) + (h & 31) - 16;
    let g = 255;
    if (t < 900) g = hash8(sl + 101) < 70 ? 40 : 255;
    else if (t < 1250) g = (t / 60 | 0) & 1 ? 255 : 90;
    else g = 255 - smooth(1250, 1500, t);
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), r = b_row[i];
        let a = (tent(p - bx, 10) * scan_row[r] / 255 | 0) * g / 255 | 0;
        if (r === 3) a = imax(a, 20);
        put(i, col, a * fo / 255 | 0);
    }
}

// Уведомление · Три прохода: three fast sweeps, there, back and there again, 0.38 s each, with a long trail
export function scanNotify(n, t, du, col) {
    const fo = smooth(du, du - 300, t), wc = mix(col, C_WHITE, 160), bx = [0, 0, 0, 0];
    for (let m = 0; m < 4; m++) {
        const u = imax(0, t - m * 30), s = (u % 380) * 168 / 380 | 0;
        bx[m] = u >= 1140 ? 999 : ((u / 380 | 0) & 1) ? 84 - s : -84 + s;
    }
    fr.dg = 128;
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const p = 4 * (b_x[i] - 19), r = b_row[i];
        let a = 0;
        for (let m = 0; m < 4; m++) a = imax(a, tent(p - bx[m], 10) * (255 - m * 55) / 255 | 0);
        a = a * scan_row[r] / 255 | 0;
        if (r === 3) a = imax(a, 14);
        put(i, abs(p - bx[0]) < 5 ? wc : col, a * fo / 255 | 0);
    }
}

// ================= the event in a new style =================

// a state (listening, thinking, speaking) of style 4–9; k: how far it shows (255 = all)
export function styleState(style, n, t, col, k) {
    if (n === A_LISTENING) {
        switch (style) {
            case 4: ppListen(n, t, col, k); break;
            case 5: kalListen(n, t, col, k); break;
            case 6: lavaListen(n, t, col, k); break;
            case 7: faceListen(n, t, col, k); break;
            case 8: galListen(n, t, col, k); break;
            default: scanListen(n, t, col, k); break;
        }
    } else if (n === A_THINKING) {
        switch (style) {
            case 4: ppThink(n, t, col, k); break;
            case 5: kalThink(n, t, col, k); break;
            case 6: lavaThink(n, t, col, k); break;
            case 7: faceThink(n, t, col, k); break;
            case 8: galThink(n, t, col, k); break;
            default: scanThink(n, t, col, k); break;
        }
    } else {
        switch (style) {
            case 4: ppSpeak(n, t, col, k); break;
            case 5: kalSpeak(n, t, col, k); break;
            case 6: lavaSpeak(n, t, col, k); break;
            case 7: faceSpeak(n, t, col, k); break;
            case 8: galSpeak(n, t, col, k); break;
            default: scanSpeak(n, t, col, k); break;
        }
    }
}

// a one-shot (the wake, done, error, notify) of style 4–9, t = 0 .. du
export function styleShot(style, n, t, du, col) {
    if (n === A_WAKE) {
        switch (style) {
            case 4: ppWake(n, t, du, col); break;
            case 5: kalWake(n, t, du, col); break;
            case 6: lavaWake(n, t, du, col); break;
            case 7: faceWake(n, t, du, col); break;
            case 8: galWake(n, t, du, col); break;
            default: scanWake(n, t, du, col); break;
        }
    } else if (n === A_DONE) {
        switch (style) {
            case 4: ppDone(n, t, du, col); break;
            case 5: kalDone(n, t, du, col); break;
            case 6: lavaDone(n, t, du, col); break;
            case 7: faceDone(n, t, du, col); break;
            case 8: galDone(n, t, du, col); break;
            default: scanDone(n, t, du, col); break;
        }
    } else if (n === A_ERROR) {
        switch (style) {
            case 4: ppError(n, t, du, col); break;
            case 5: kalError(n, t, du, col); break;
            case 6: lavaError(n, t, du, col); break;
            case 7: faceError(n, t, du, col); break;
            case 8: galError(n, t, du, col); break;
            default: scanError(n, t, du, col); break;
        }
    } else {
        switch (style) {
            case 4: ppNotify(n, t, du, col); break;
            case 5: kalNotify(n, t, du, col); break;
            case 6: lavaNotify(n, t, du, col); break;
            case 7: faceNotify(n, t, du, col); break;
            case 8: galNotify(n, t, du, col); break;
            default: scanNotify(n, t, du, col); break;
        }
    }
}
