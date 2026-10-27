// Kaya's single animations of v1.9, part 3 (singles.js, catalog C of KAIA-203): the ids at v1.9's end, every id of
// parts 1 and 2 drawing its frames bit for bit, any style taking the singles, determinism, fade-outs, seamless loops,
// Обвал with and without digits, the cost per frame, the long-state check, the right shifts and the code copying into C++.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { frameOf, renderFrame, resolvePlay } from "../src/frame.js";
import * as K from "../src/kaia.js";
import { LOOK_COUNT, LOOK_NAMES, look_style, lookOf, shotLength, stateLook } from "../src/looks.js";
import { BallMatrix } from "../src/matrix.js";
import { DEFAULTS } from "../src/settings.js";
import { single_ms, SINGLE_NAMES, singleShot, singleWake } from "../src/singles.js";
import { STYLE_COUNT } from "../src/styles.js";
import { b_row, WAKE_COUNT, WAKE_NAMES, wake_ms, wake_style, wakeLength, wakeOf } from "../src/wakes.js";
import { costOf, functions, singleDivs } from "./cost.mjs";
import { v18DigestOf, v19aDigestOf, v19bDigestOf } from "./frames.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// v19bDigestOf() on the sources of part 2 (main at 54a7914), made once before part 3's changes; the others as in games.test.mjs
const V18 = { sha: "ee51215b56103aa7ad409917f997227351c43d3184ede300e58d147b1ef3b7a5", frames: 4698 };
const V19A = { sha: "3cad0a5bb7817543eb89ce04341bf26a5512890a13bed9c00e6363508ca46119", frames: 4896 };
const V19B = { sha: "2ae86f516fc6c63b7fc2656a37fcfdd881f4f005f688d18c27dbc3df9ebc254a", frames: 9504 };
const S = Object.assign({}, DEFAULTS, { back_mode: 2, back_pal: 13, clock_style: 1, kaia_anim: 1 });
const C = { millis: 250000, synced: true, hour: 14, minute: 32, ms: 700, night: false, duck: 255 };
const STATES = [K.A_LISTENING, K.A_THINKING, K.A_SPEAKING], SHOTS = [K.A_DONE, K.A_ERROR, K.A_NOTIFY], LOOKS = [24, 25, 26, 27], WAKES = [30, 31, 32, 33];
const at = (s, anim, style, look, t, extra) => frameOf(s, { ...C, play: { anim, style, look, lk: 0, speed: 100, t, color: null, ...extra } });
const diff = (a, b) => Math.max(...[...a].map((v, i) => Math.max(Math.abs(((v >> 16) & 255) - ((b[i] >> 16) & 255)), Math.abs(((v >> 8) & 255) - ((b[i] >> 8) & 255)), Math.abs((v & 255) - (b[i] & 255)))));
// the 28 functions by event (A_WAKE … A_NOTIFY), in the catalog's order
const FNS = [
    ["curtainWake", "coffeeWake", "alarmWake", "gaugeWake"],
    ["cloudsListen", "leavesListen", "dunesListen", "threadListen"],
    ["spinnerThink", "dnaThink", "mazeThink", "sortThink"],
    ["silkSpeak", "orbSpeak", "telegraphSpeak", "splashSpeak"],
    ["rainbowDone", "starDone", "sunDone", "cupDone"],
    ["collapseError", "crackError", "rainCloudError", "shortError"],
    ["buzzNotify", "birdNotify", "stadiumNotify", "giftNotify"],
];
const src = () => readFileSync(join(here, "..", "src", "singles.js"), "utf8").replace(/\r\n/g, "\n");

test("ids at v1.9's end: looks 24–27 and wakes 30–33 are catalog C's, in its order, with its lengths", () => {
    assert.equal(STYLE_COUNT, 18);
    assert.equal(LOOK_COUNT, 28);
    assert.equal(WAKE_COUNT, 34);
    assert.deepEqual(WAKE_NAMES.slice(30), ["Занавес", "Кофе", "Будильник", "Спидометр"]);
    assert.deepEqual(SINGLE_NAMES[K.A_WAKE], WAKE_NAMES.slice(30));
    assert.deepEqual(LOOK_NAMES[K.A_LISTENING].slice(24), ["Облака", "Листопад", "Дюны", "Нить"]);
    assert.deepEqual(LOOK_NAMES[K.A_THINKING].slice(24), ["Спиннер", "ДНК", "Лабиринт", "Сортировка"]);
    assert.deepEqual(LOOK_NAMES[K.A_SPEAKING].slice(24), ["Шёлк", "Сфера", "Телеграф", "Брызги"]);
    assert.deepEqual(LOOK_NAMES[K.A_DONE].slice(24), ["Радуга", "Звезда", "Солнце", "Кубок"]);
    assert.deepEqual(LOOK_NAMES[K.A_ERROR].slice(24), ["Обвал", "Трещина", "Тучка", "Замыкание"]);
    assert.deepEqual(LOOK_NAMES[K.A_NOTIFY].slice(24), ["Вибрация", "Птица", "Стадион", "Подарок"]);
    for (const n of [...STATES, ...SHOTS]) assert.equal(LOOK_NAMES[n].length, LOOK_COUNT);
    // the catalog's lengths
    assert.deepEqual(WAKES.map((id) => wake_ms[id]), [2000, 2200, 2000, 2000]);
    assert.deepEqual(single_ms, [[1800, 1700, 1800, 1800], [1700, 1600, 1900, 1700], [1500, 1600, 1800, 1900]]);
    // not a style's version: the tables say 0, and they are as long as the ids
    assert.equal(look_style.length, LOOK_COUNT);
    assert.equal(wake_style.length, WAKE_COUNT);
    for (const look of LOOKS) assert.equal(look_style[look], 0);
    for (const id of WAKES) assert.equal(wake_style[id], 0);
    for (let style = 1; style <= STYLE_COUNT; style++) {
        for (const look of LOOKS) {
            assert.equal(lookOf(style, look), look);
            for (const n of SHOTS) assert.equal(shotLength(n, look, style), single_ms[n - K.A_DONE][look - 24]);
        }
        for (const id of WAKES) assert.equal(wakeOf(style, id), id);
    }
    // the API's ranges reach their v1.9 end: style 1–18, look 0–27, wake 0–33; past them the play takes the last
    assert.equal(resolvePlay({ anim: K.A_DONE, style: 1, look: 28, t: 10 }).look, 27);
    assert.equal(resolvePlay({ anim: K.A_WAKE, style: 1, look: 34, speed: 100, t: 10 }).look, 33);
    assert.equal(resolvePlay({ anim: K.A_DONE, style: 19, t: 10 }), null);
});

test("every id of v1.8 and of parts 1 and 2 draws its frames bit for bit", () => {
    assert.deepEqual(v18DigestOf(frameOf, DEFAULTS), V18);
    assert.deepEqual(v19aDigestOf(frameOf, DEFAULTS), V19A);
    assert.deepEqual(v19bDigestOf(frameOf, DEFAULTS), V19B);
});

test("any style plays a single the same: it is not a style's version", () => {
    for (const look of LOOKS) {
        for (const n of [...STATES, ...SHOTS]) {
            const a = at(S, n, 1, look, 600, { ms: 1e9 });
            for (const style of [3, 7, 11, 16]) assert.deepEqual(at({ ...S, kaia_anim: style }, n, style, look, 600, { ms: 1e9 }), a, K.ANIM_NAMES[n] + " " + look + " with style " + style);
        }
    }
    // a wake with the same listening's look under it (lk 6), whatever the style
    for (const id of WAKES) {
        const a = at(S, K.A_WAKE, 2, id, 1700, { lk: 6 });
        for (const style of [1, 9, 14]) assert.deepEqual(at({ ...S, kaia_anim: style }, K.A_WAKE, style, id, 1700, { lk: 6 }), a, "wake " + id + " with style " + style);
    }
});

test("every single draws, the same t gives the same frame, and each is its own", () => {
    const none = frameOf(S, { ...C, play: null });
    for (const n of [K.A_WAKE, ...STATES, ...SHOTS]) {
        const seen = new Map();
        for (const id of n === K.A_WAKE ? WAKES : LOOKS) {
            const t = n === K.A_WAKE ? wake_ms[id] >> 1 : 700;
            const a = at(S, n, 1, id, t, { ms: 1e9 });
            at({ ...S, kaia_anim: 3 }, K.A_ERROR, 3, 6, 300);  // something else in between
            assert.deepEqual(at(S, n, 1, id, t, { ms: 1e9 }), a, K.ANIM_NAMES[n] + " " + id);
            assert.notDeepEqual(a, none, K.ANIM_NAMES[n] + " " + id + " draws");
            const key = a.join(",");
            assert.ok(!seen.has(key), K.ANIM_NAMES[n] + " " + id + " looks like " + seen.get(key));
            seen.set(key, id);
        }
    }
});

test("every single one-shot has faded out by its end; a wake hands over to the listening at every speed", () => {
    for (const style of [1, 5, 13]) {
        const s = { ...S, kaia_anim: style }, plain = frameOf(s, { ...C, play: null });
        for (const n of SHOTS) {
            for (const look of LOOKS) {
                const du = shotLength(n, look, style);
                assert.ok(resolvePlay({ anim: n, style, look, t: du - 1 }));
                assert.equal(resolvePlay({ anim: n, style, look, t: du }), null);
                assert.deepEqual(at(s, n, style, look, du - 1), plain, K.ANIM_NAMES[n] + " " + look + " at " + (du - 1));
            }
        }
        for (const id of WAKES) {
            for (const sp of [50, 100, 200]) {
                const len = wakeLength(id, sp);
                assert.equal(resolvePlay({ anim: K.A_WAKE, style, look: id, speed: sp, t: len - 1 }).anim, K.A_WAKE);
                assert.deepEqual(resolvePlay({ anim: K.A_WAKE, style, look: id, lk: 0, speed: sp, t: len + 40 }).t, 40);
                // the wake alone has faded by then
                const m = new BallMatrix();
                renderFrame(m, s, { ...C, play: null });
                const base = Uint32Array.from(m.leds);
                K.useMatrix(m);
                K.fr.sc = 255;
                K.fr.dg = 89;
                singleWake(id, K.A_WAKE, Math.min(wake_ms[id], (len - 1) * sp / 100 | 0), wake_ms[id], s.kaia_color);
                assert.deepEqual(Uint32Array.from(m.leds), base, "wake " + id + " at " + sp + " % still draws at " + (len - 1));
                // and its last frame is the style's listening, as it goes on after it
                const last = at(s, K.A_WAKE, style, id, len - 1, { speed: sp });
                const l = new BallMatrix();
                renderFrame(l, s, { ...C, play: null });
                K.useMatrix(l);
                K.fr.sc = s.kaia_bright;
                K.fr.dg = 89;
                stateLook(style, 0, K.A_LISTENING, -1, s.kaia_color, 255);
                assert.ok(diff(last, l.leds) <= 12, "wake " + id + " style " + style + " at " + sp + " %: " + diff(last, l.leds));
            }
        }
    }
});

// exact loop periods, ms: every term is t·w/1000 (256 a turn: 256000 covers them, voice() too), t·256/P or a posMod,
// so frame(t + P) = frame(t). Облака: 11, 8 and 14 eighths a second round 260; Листопад: the leaves' falls (4.8–6.8 s)
// and their swing (wave 72); Спиннер: the 1.4 s cycle and the 2.4 s turn meet every 134.4 s; ДНК 230/256 of a turn a
// second; Лабиринт 5.2 s. Сортировка and Брызги never repeat (each round's order, each syllable's droplets from hash8 of
// its number): Сортировка's rounds meet in the dark, Брызги has no seam to show.
const LOOP = {
    [K.A_LISTENING]: [260000, 148512000, 256000, 256000],
    [K.A_THINKING]: [134400, 25600, 5200, 0],
    [K.A_SPEAKING]: [256000, 256000, 256000, 0],
};

test("every single state loops without a seam, and still draws after an hour", () => {
    const s = { ...S, back_mode: 0, clock_style: 0 }, none = frameOf(s, { ...C, play: null });
    for (const n of STATES) {
        LOOP[n].forEach((per, j) => {
            if (!per) return;
            // from 2.4 s: Телеграф keys its oldest place 2.31 s back, and voice() of a negative t is not on the period
            for (const t of [2400, 12345, 61000, 100000]) {
                assert.deepEqual(at(s, n, 1, 24 + j, t + per, { ms: 1e15 }), at(s, n, 1, 24 + j, t, { ms: 1e15 }), K.ANIM_NAMES[n] + " " + (24 + j) + " at " + t);
            }
        });
        for (const look of LOOKS) assert.notDeepEqual(at(s, n, 1, look, 3600000, { ms: 1e10 }), none, K.ANIM_NAMES[n] + " " + look + " after an hour");
    }
    // Сортировка: the bars have sunk at the end of a round and rise from nothing at the start of the next
    for (const k of [1, 2, 7]) {
        assert.deepEqual(at(s, K.A_THINKING, 1, 27, 7000 * k - 1, { ms: 1e15 }), none, "round " + k + " ends dark");
        assert.deepEqual(at(s, K.A_THINKING, 1, 27, 7000 * k, { ms: 1e15 }), none, "round " + k + " starts dark");
    }
});

test("Обвал: the time's own balls fall into a pile; without digits only the floor plays", () => {
    const red = (f) => [...f].map((v, i) => [v, i]).filter(([v]) => ((v >> 16) & 255) > 120 && (v & 255) < 100).map(([, i]) => i);
    const meanRow = (ix) => ix.reduce((a, i) => a + b_row[i], 0) / ix.length;
    const s = { ...S, back_mode: 0 };
    // the digit marks of this frame (14:32): at first they are where the time is, by 0.8 s they lie on the bottom rows
    const m = new BallMatrix();
    renderFrame(m, s, { ...C, play: null });
    const digits = [...m.marks].map((v, i) => [v, i]).filter(([v]) => v).map(([, i]) => i);
    assert.ok(digits.length > 20);
    const first = red(at(s, K.A_ERROR, 1, 24, 50)), lying = red(at(s, K.A_ERROR, 1, 24, 1200));
    assert.ok(first.every((i) => digits.includes(i)), "at 50 ms the red balls are the time's");
    assert.ok(Math.abs(meanRow(first) - meanRow(digits)) < 0.6);
    assert.ok(lying.length >= digits.length * 2 / 3 && meanRow(lying) > 4.8, lying.length + " balls, mean row " + meanRow(lying));
    // no digits (the clock draws none: font 0, as when nothing marks the balls): the floor alone, row 6 at 40
    const s0 = { ...s, clock_style: 0 };
    for (const t of [100, 600, 1200]) {
        const f = at(s0, K.A_ERROR, 1, 24, t), lit = [...f].map((v, i) => [v, i]).filter(([v]) => v);
        assert.ok(lit.every(([, i]) => b_row[i] === 6), "at " + t + " only the floor");
        if (t >= 700) assert.equal(lit.length, [...b_row].filter((r) => r === 6).length);
    }
    // ballRX gives −1 at the plate's edges, and Обвал checks it before marked() (the C++ marked() takes no −1)
    assert.equal(K.ballRX(-3, 3), -1);
    assert.equal(K.ballRX(38, 6), -1);
    assert.equal(K.ballRX(36, 0), -1);
    assert.match(functions().get("collapseError"), /if \(b >= 0 && matrix\.marked\(b\)\) below\+\+;/);
});

test("the cost per frame: within KAIA-202's rule of about 3× v1.8's heaviest frame; Замыкание's sparks skip far balls", () => {
    // the divisions one frame really runs (cost.mjs singleDivs, as styleDivs), the most over 2 s of frames (a wake over
    // 2.2 s), with the digit marks of 14:32. v1.8's heaviest frame is Пинг-понг · Смэш, 2010; part 2's Маятник · В
    // такт 4317. GET /kaia/test gives the real times.
    const d = singleDivs();
    const rows = [d.wake, d.listening, d.thinking, d.speaking, d.done, d.error, d.notify];
    // the README's table
    assert.deepEqual(rows, [
        [1404, 1963, 1167, 1025],
        [1174, 697, 927, 1076],
        [490, 1037, 584, 711],
        [1390, 808, 905, 1853],
        [1557, 2116, 1450, 1297],
        [1148, 2212, 1049, 1640],
        [1090, 1079, 1142, 3290],
    ]);
    assert.equal(d.collapseNoDigits, 657, "Обвал without digits: the floor and the dimming");
    const all = rows.flat();
    assert.ok(all.every((x) => x <= 3 * 2010));
    assert.equal(Math.max(...all), 3290, "Подарок is the heaviest of part 3 (the README says so)");
    // Замыкание: a spark lights a ball only within 8 of it (soft(oct, 8, 5)): outside its box the loop skips the divisions
    // (2584 a frame without it; the frames are the same, the README says how that was checked)
    assert.match(functions().get("shortError"), /if \(dx <= -8 \|\| dx >= 8 \|\| dy <= -8 \|\| dy >= 8\) continue;/);
    // the voices and hashes a frame: Телеграф calls voice() for each ball of rows 1, 3 and 5 (56: the catalog said 57),
    // as v1.6's Осциллограф does for every ball; Брызги once, then once per syllable (3); no inoise16
    assert.equal([...b_row].filter((r) => r === 1 || r === 3 || r === 5).length, 56);
    // (costOf counts the loop over all 128 balls; the rows test skips 72 of them before the call)
    const fns = functions(), voices = {};
    for (const f of FNS[K.A_SPEAKING]) voices[f] = costOf(fns, f).voice;
    assert.deepEqual(voices, { silkSpeak: 3, orbSpeak: 1, telegraphSpeak: 128, splashSpeak: 4 });
    for (const f of [...FNS[K.A_LISTENING], ...FNS[K.A_THINKING]]) assert.doesNotMatch(fns.get(f), /voice\(/, f);
    assert.doesNotMatch(src(), /inoise16/);
});

test("long states: t times its largest factor stays exact in 32 bits for 70 minutes (GET /kaia/test draws there)", () => {
    const fns = functions(), factors = [];
    const look = (name, seen = new Set()) => {
        if (seen.has(name) || !fns.has(name)) return;
        seen.add(name);
        const body = fns.get(name);
        for (const m of body.matchAll(/\bt \* (\d+)/g)) factors.push([name, +m[1]]);
        // Облака t · cl_v[j] (at most 14), Шёлк t · silk_w[j] (at most 320 either way)
        for (const m of body.matchAll(/\bt \* (\w+)\[/g)) factors.push([name, m[1] === "cl_v" ? 14 : m[1] === "silk_w" ? 320 : NaN]);
        for (const m of body.matchAll(/wave\(t[^,]*, ([^)]+)\)/g)) factors.push([name, Number(m[1])]);
        for (const m of body.matchAll(/\b(\w+)\(t\b/g)) look(m[1], seen);
    };
    for (const f of FNS.slice(1, 4).flat()) look(f);
    assert.ok(factors.every(([, k]) => Number.isFinite(k)), JSON.stringify(factors));
    const max = factors.reduce((a, b) => (b[1] > a[1] ? b : a));
    assert.deepEqual(max, ["voice", 469]);
    assert.ok(70 * 60000 * max[1] < 2 ** 31, "70 minutes of one state");
});

test("the right shifts of negative ints round down, in JS as in GCC, and stay shifts", () => {
    // Сортировка: the ball at b_x 0 is left of bar 0 ((0 − 1) >> 2 is −1: no bar; / 4 would give bar 0);
    // Птица: the shoulder's fl >> 1 for a wing beating down (fl < 0)
    assert.equal((0 - 1) >> 2, -1);
    for (let v = -11; v <= 11; v++) assert.equal(v >> 1, Math.floor(v / 2));
    const fns = functions();
    assert.match(fns.get("sortThink"), /const j = \(b_x\[i\] - 1\) >> 2;/);
    assert.match(fns.get("birdNotify"), /\(fl >> 1\)/);
});

test("catalog C's singles are integer-only and copy line by line into C++", () => {
    const body = src().split("// ================= the helpers of catalog C")[1];
    const fns = [...body.matchAll(/^export function (\w+)\((?:n, t, col, k|n, t, du, col)\) \{$/gm)].map((m) => m[1]);
    assert.deepEqual(fns, FNS.flat());
    const helpers = [...body.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]).filter((f) => !fns.includes(f));
    assert.deepEqual(helpers, ["soft", "isqrt", "cloud", "lineY", "singleState", "singleShot", "singleWake"]);
    const code = body.replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /\d\.\d/, "no float literals");
    assert.doesNotMatch(code, /=>|Math\.|\bfunction\s*\(|\.map\(|\.forEach\(|\.push\(|`|new \w+Array/, "no closures, JS-only helpers or per-ball tables");
    for (const m of code.matchAll(/[^/]\/(?![/*])[^;\n]*/g)) assert.match(m[0], /\| 0/, "a division without | 0: " + m[0].trim());
    // the small tables: const, integers (decimal or hex colours); 167 bytes in PROGMEM at their narrowest types
    const tabs = [...code.matchAll(/^const .*$/gm)].flatMap((l) => [...l[0].matchAll(/(\w+) = \[([^\]]*)\]/g)]);
    assert.deepEqual(tabs.map((m) => m[1]).sort(), ["al_h1", "al_h2", "cl_a", "cl_o", "cl_v", "cl_y", "crk_b1", "crk_b2", "crk_y", "lf_x", "mz_gap", "mz_seg", "pict_cup", "rb_col", "silk_d", "silk_f", "silk_h", "silk_w", "st_gl"]);
    let bytes = 0;
    for (const m of tabs) {
        const v = m[2].split(",").map((x) => x.trim());
        assert.ok(v.length <= 45 && v.every((x) => /^(-?\d+|0x[0-9a-f]+)$/.test(x)), m[1]);
        const n = v.map(Number), lo = Math.min(...n), hi = Math.max(...n);
        bytes += v.length * (lo >= -128 && hi <= 127 || lo >= 0 && hi <= 255 ? 1 : lo >= -32768 && hi <= 65535 ? 2 : 4);
    }
    assert.equal(bytes, 167);
    // Обвал's matrix.marked and Кубок's ledDiag are the firmware's own; the only state they read is the frame's
    assert.deepEqual([...code.matchAll(/\bmatrix\.(\w+)/g)].map((m) => m[1]), ["marked", "marked"]);
    // the dispatch (singleState / singleShot / singleWake, which looks.js calls) names every animation once
    const disp = body.split("// ================= the event in a single look")[1];
    for (const f of fns) assert.equal(disp.split(" " + f + "(").length, 2, f);
});
