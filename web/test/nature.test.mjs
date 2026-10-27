// Kaya's styles of v1.9, part 1 (nature.js, catalog A of KAIA-201): the ids of all three parts, the dispatch tables,
// every v1.8 id drawing v1.8's frames bit for bit, «Как у стиля» reaching styles 10–12, the wake handing over to the
// style's listening, determinism, fade-outs, seamless loops, the cost per frame, the long-state check, and the code
// copying into C++.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { frameOf, renderFrame, resolvePlay } from "../src/frame.js";
import * as K from "../src/kaia.js";
import { LOOK_COUNT, LOOK_NAMES, look_style, lookOf, shotLength, stateLook, style_look } from "../src/looks.js";
import { BallMatrix } from "../src/matrix.js";
import { DEFAULTS } from "../src/settings.js";
import { fam_ms, STYLE_COUNT, STYLE_NAMES } from "../src/styles.js";
import { style_wake, WAKE_COUNT, WAKE_NAMES, wake_ms, wake_style, wakeLength, wakeOf } from "../src/wakes.js";
import { costOf, functions, styleDivs } from "./cost.mjs";
import { v18DigestOf } from "./frames.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// v18DigestOf() on the sources of v1.8 (main at 85c9f66), made once before v1.9's changes
const V18 = { sha: "ee51215b56103aa7ad409917f997227351c43d3184ede300e58d147b1ef3b7a5", frames: 4698 };
const S = Object.assign({}, DEFAULTS, { back_mode: 2, back_pal: 13, clock_style: 1, kaia_anim: 1 });
const C = { millis: 250000, synced: true, hour: 14, minute: 32, ms: 700, night: false, duck: 255 };
const STYLES = [10, 11, 12], STATES = [K.A_LISTENING, K.A_THINKING, K.A_SPEAKING], SHOTS = [K.A_DONE, K.A_ERROR, K.A_NOTIFY];
const at = (s, anim, style, look, t, extra) => frameOf(s, { ...C, play: { anim, style, look, lk: 0, speed: 100, t, color: null, ...extra } });
const diff = (a, b) => Math.max(...[...a].map((v, i) => Math.max(Math.abs(((v >> 16) & 255) - ((b[i] >> 16) & 255)), Math.abs(((v >> 8) & 255) - ((b[i] >> 8) & 255)), Math.abs((v & 255) - (b[i] & 255)))));
const PFX = ["snow", "fly", "flame"], EVS = ["Wake", "Listen", "Think", "Speak", "Done", "Error", "Notify"];

// part 2 (games.test.mjs) appends styles 13–18 after these and holds the counts and the ranges past them
test("ids: styles 10–12 appended, their looks and wakes by table", () => {
    assert.ok(STYLE_COUNT >= 12);
    assert.deepEqual(STYLE_NAMES.slice(10, 13), ["Снежинка", "Светлячки", "Пламя"]);
    assert.ok(LOOK_COUNT >= 18);
    assert.ok(WAKE_COUNT >= 24);
    for (const n of [...STATES, ...SHOTS]) assert.deepEqual(LOOK_NAMES[n].slice(15, 18), ["Снежинка", "Светлячки", "Пламя"], K.ANIM_NAMES[n]);
    assert.deepEqual(WAKE_NAMES.slice(21, 24), ["Снежинка", "Светлячки", "Пламя"]);
    assert.deepEqual(wake_ms.slice(21, 24), [2000, 2000, 2000]);
    assert.deepEqual(fam_ms.slice(6, 9), [[1800, 1800, 1600], [1700, 1500, 1400], [1800, 2000, 1500]]);
    // the tables: as long as the ids, and each the other's inverse
    assert.equal(look_style.length, LOOK_COUNT);
    assert.equal(wake_style.length, WAKE_COUNT);
    assert.equal(style_look.length, STYLE_COUNT + 1);
    assert.equal(style_wake.length, STYLE_COUNT + 1);
    assert.equal(fam_ms.length, STYLE_COUNT - 3);
    for (let style = 4; style <= STYLE_COUNT; style++) {
        assert.equal(look_style[style_look[style]], style);
        assert.equal(wake_style[style_wake[style]], style);
        // v1.8's rule still holds for the ids fixed so far (look = style + 5, wake = style + 11); the table is the contract
        assert.equal(style_look[style], style + 5);
        assert.equal(style_wake[style], style + 11);
    }
    for (let look = 0; look < LOOK_COUNT; look++) if (look_style[look]) assert.equal(style_look[look_style[look]], look);
    for (let id = 0; id < WAKE_COUNT; id++) if (wake_style[id]) assert.equal(style_wake[wake_style[id]], id);
    for (let style = 1; style <= 3; style++) assert.equal(style_wake[style], style);
    for (const style of STYLES) {
        assert.equal(lookOf(style, 0), style + 5);
        assert.equal(lookOf(style, 7), 7);
        assert.equal(wakeOf(style, 0), style + 11);
        assert.equal(wakeOf(style, 5), 5);
        for (const n of SHOTS) {
            assert.equal(shotLength(n, 0, style), fam_ms[style - 4][n - K.A_DONE]);
            assert.equal(shotLength(n, style + 5, 2), fam_ms[style - 4][n - K.A_DONE]);
        }
    }
});

test("every id of v1.8 draws v1.8's frames bit for bit", () => {
    assert.deepEqual(v18DigestOf(frameOf, DEFAULTS), V18);
});

test("«Как у стиля» with style 10–12 plays its version, and any style can take that version by its id", () => {
    for (const style of STYLES) {
        const s = { ...S, kaia_anim: style };
        for (const n of [...STATES, ...SHOTS]) {
            const a = at(s, n, style, 0, 600, { ms: 1e9 });
            for (const other of [1, 3, 7]) assert.deepEqual(at({ ...S, kaia_anim: other }, n, other, style + 5, 600, { ms: 1e9 }), a, style + "/" + n + " as look " + (style + 5) + " with style " + other);
        }
        assert.deepEqual(at(s, K.A_WAKE, style, 0, 900), at({ ...S, kaia_anim: 2 }, K.A_WAKE, 2, style + 11, 900, { lk: style + 5 }), "wake " + style);
        assert.ok(resolvePlay({ anim: K.A_DONE, style, t: 0 }));
    }
    // a look of v1.6 or v1.8 still plays with a new style
    assert.deepEqual(at({ ...S, kaia_anim: 11 }, K.A_ERROR, 11, 6, 300), at(S, K.A_ERROR, 1, 6, 300));
    assert.deepEqual(at({ ...S, kaia_anim: 12 }, K.A_DONE, 12, 12, 300), at(S, K.A_DONE, 1, 12, 300));
});

test("a new style's wake ends at its length at every speed and settles into the style's listening", () => {
    for (const style of STYLES) {
        const s = { ...S, kaia_anim: style };
        for (const sp of [50, 100, 200]) {
            const len = wakeLength(style + 11, sp);
            assert.equal(resolvePlay({ anim: K.A_WAKE, style, look: 0, speed: sp, t: len - 1 }).anim, K.A_WAKE);
            const after = resolvePlay({ anim: K.A_WAKE, style, look: 0, lk: 0, speed: sp, t: len + 40 });
            assert.deepEqual([after.anim, after.look, after.t], [K.A_LISTENING, 0, 40], "the listening keeps real time");
            const last = frameOf(s, { ...C, play: { anim: K.A_WAKE, style, look: 0, lk: 0, speed: sp, t: len - 1, color: null } });
            const m = new BallMatrix();
            renderFrame(m, s, { ...C, play: null });
            K.useMatrix(m);
            K.fr.sc = s.kaia_bright;
            K.fr.dg = 89;
            stateLook(style, 0, K.A_LISTENING, -1, s.kaia_color, 255);
            assert.ok(diff(last, m.leds) <= 12, "style " + style + " at " + sp + " %: " + diff(last, m.leds));
        }
    }
});

test("every new animation draws, the same t gives the same frame, and each is its own", () => {
    const none = frameOf(S, { ...C, play: null });
    for (const n of [K.A_WAKE, ...STATES, ...SHOTS]) {
        const seen = new Map();
        for (const style of [...STYLES, 4, 9]) {
            const s = { ...S, kaia_anim: style }, t = n === K.A_WAKE ? wake_ms[style + 11] >> 1 : 600;
            const a = at(s, n, style, 0, t, { ms: 1e9 });
            at({ ...S, kaia_anim: 3 }, K.A_ERROR, 3, 6, 300);  // something else in between
            assert.deepEqual(at(s, n, style, 0, t, { ms: 1e9 }), a, K.ANIM_NAMES[n] + " " + style);
            assert.notDeepEqual(a, none, K.ANIM_NAMES[n] + " " + style + " draws");
            const key = a.join(",");
            assert.ok(!seen.has(key), K.ANIM_NAMES[n] + " " + style + " looks like " + seen.get(key));
            seen.set(key, style);
        }
    }
});

test("every new one-shot has faded out by its end", () => {
    for (const style of STYLES) {
        const s = { ...S, kaia_anim: style }, plain = frameOf(s, { ...C, play: null });
        for (const n of SHOTS) {
            const du = shotLength(n, 0, style);
            assert.ok(resolvePlay({ anim: n, style, t: du - 1 }));
            assert.equal(resolvePlay({ anim: n, style, t: du }), null);
            assert.deepEqual(at(s, n, style, 0, du - 1), plain, K.ANIM_NAMES[n] + " " + style + " at " + (du - 1));
        }
    }
});

// exact loop periods, ms: every term is t·w/1000 (256 a turn: 256000 covers all of them), t·256/P or a posMod, so
// frame(t + P) = frame(t). Снежинка's snow falls at 5.2, 5.9, 6.6 and 7.3 s, so its listening repeats exactly only after
// LCM(256000, 4800, 5200, 5900, 6600, 7300) ms; each term is seamless on its own.
const LOOP = {
    10: [473011968000, 768000, 256000],  // the glints, the breath, the arms 4.8 s, the snow; the gaps 1.2 s; voice
    11: [256000, 768000, 256000],        // the drift and the glow; the round 3 s; voice
    12: [4352000, 768000, 256000],       // the tongues and two embers in 3.4 s; five in 1.5 s; voice
};

test("every new state loops without a seam, and still draws after an hour", () => {
    const s0 = { ...S, back_mode: 0, clock_style: 0 }, none = frameOf(s0, { ...C, play: null });
    for (const style of STYLES) {
        const s = { ...s0, kaia_anim: style };
        STATES.forEach((n, k) => {
            const per = LOOP[style][k];
            for (const t of [1000, 12345, 61000, 100000]) {
                assert.deepEqual(at(s, n, style, 0, t + per, { ms: 1e15 }), at(s, n, style, 0, t, { ms: 1e15 }), K.ANIM_NAMES[n] + " " + style + " at " + t);
            }
            assert.notDeepEqual(at(s, n, style, 0, 3600000, { ms: 1e10 }), none, K.ANIM_NAMES[n] + " " + style + " after an hour");
        });
    }
});

test("the cost per frame stays within v1.8's: no frame divides more than v1.8's styles do, few voices, no hashes", () => {
    // the divisions one frame really runs (cost.mjs styleDivs), the most over 2 s of frames. v1.8 on the clock:
    // GET /kaia/test's slowest is Мордашка's wake, 3.2 ms; its heaviest frame by divisions is Пинг-понг · Смэш.
    // Part 1 must not raise that.
    const all = styleDivs([4, 5, 6, 7, 8, 9, ...STYLES]);
    const budget = Math.max(...[4, 5, 6, 7, 8, 9].flatMap((s) => all[s]));
    assert.equal(budget, 2010);
    assert.equal(all[4][4], 2010);
    assert.equal(all[7][0], 961, "Мордашка's wake");
    const fns = functions(), rows = {};
    let worst = 0, wn = "";
    for (const style of STYLES) {
        const p = PFX[style - 10];
        rows[p] = all[style];
        rows[p].forEach((d, k) => {
            assert.ok(d <= budget, p + EVS[k] + ": " + d + " divisions a frame");
            if (d > worst) [worst, wn] = [d, p + EVS[k]];
        });
        for (const e of EVS) {
            const c = costOf(fns, p + e);
            assert.ok(c.voice <= 3 && c.hash8 === 0, p + e + ": " + c.voice + " voices, " + c.hash8 + " hashes");
            assert.ok(c.put <= 256, p + e + ": " + c.put + " put()");
        }
    }
    // the README's table
    assert.deepEqual(rows, {
        snow: [1447, 300, 439, 367, 807, 257, 432],
        fly: [487, 392, 731, 413, 598, 481, 368],
        flame: [1216, 1217, 1454, 1435, 1933, 1219, 1554],
    });
    assert.deepEqual([wn, worst], ["flameDone", 1933], "Пламя · Костёр is the heaviest of part 1 (the README says so)");
    assert.doesNotMatch(readFileSync(join(here, "..", "src", "nature.js"), "utf8"), /inoise16|hash8/);
});

test("long states: t times its largest factor stays exact in 32 bits for an hour", () => {
    const fns = functions();
    const factors = [];
    const look = (name, seen = new Set()) => {
        if (seen.has(name) || !fns.has(name)) return;
        seen.add(name);
        const body = fns.get(name);
        for (const m of body.matchAll(/\bt \* (\d+)/g)) factors.push([name, +m[1]]);
        // glint: t · (rate + 0..63)
        for (const m of body.matchAll(/\bt \* \((\w+) \+ \(h3\[i\] & (\d+)\)\)/g)) factors.push([name, m[1] === "rate" ? 60 + +m[2] : NaN]);
        // flyGlow: t · (62 + 7j), j ≤ 5
        for (const m of body.matchAll(/\bt \* \((\d+) \+ j \* (\d+)\)/g)) factors.push([name, +m[1] + 5 * +m[2]]);
        // wave(t…, w): t·w; w may name the loop's j (at most 5) or a table (ff_wx, ff_wy: at most 21)
        for (const m of body.matchAll(/wave\(t[^,]*, ([^)]+)\)/g)) factors.push([name, /\[/.test(m[1]) ? 21 : new Function("j", "return " + m[1])(5)]);
        for (const m of body.matchAll(/\b(\w+)\(/g)) look(m[1], seen);
    };
    for (const p of PFX) for (const e of ["Listen", "Think", "Speak"]) look(p + e);
    assert.ok(factors.every(([, k]) => Number.isFinite(k)), JSON.stringify(factors));
    const max = factors.reduce((a, b) => (b[1] > a[1] ? b : a));
    assert.deepEqual(max, ["voice", 469]);
    assert.ok(3600000 * max[1] < 2 ** 31, "an hour of one state");
});

test("catalog A's styles are integer-only and copy line by line into C++", () => {
    const src = readFileSync(join(here, "..", "src", "nature.js"), "utf8").replace(/\r\n/g, "\n");
    const body = src.split("// ================= the helpers of catalog A")[1];
    const fns = [...body.matchAll(/^export function (\w+)\((?:n, t, col, k|n, t, du, col)\) \{$/gm)].map((m) => m[1]);
    assert.deepEqual(fns.sort(), PFX.flatMap((p) => EVS.map((e) => p + e)).sort());
    const code = body.replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /\d\.\d/, "no float literals");
    assert.doesNotMatch(code, /=>|Math\.|\bfunction\s*\(|\.map\(|\.forEach\(|\.push\(|`|new \w+Array/, "no closures, JS-only helpers or per-ball tables");
    for (const m of code.matchAll(/[^/]\/(?![/*])[^;\n]*/g)) assert.match(m[0], /\| 0/, "a division without | 0: " + m[0].trim());
    // the small tables are const, at most 20 entries, integers
    const tabs = [...code.matchAll(/^const .*$/gm)].flatMap((l) => [...l[0].matchAll(/(\w+) = \[([^\]]*)\]/g)]);
    assert.deepEqual(tabs.map((m) => m[1]).sort(), ["em_x", "ff_bx", "ff_in", "ff_wx", "ff_wy", "fl_bv", "fl_sv", "snow_dq", "snow_dt", "snow_dx", "snow_fx"]);
    for (const m of tabs) assert.ok(m[2].split(",").length <= 20 && m[2].split(",").every((x) => /^\s*-?\d+\s*$/.test(x)), m[1]);
    // the dispatch (styles.js) names every animation once in its event's switch
    const st = readFileSync(join(here, "..", "src", "styles.js"), "utf8").replace(/\r\n/g, "\n").split("// ================= the event in a new style")[1];
    for (const f of fns) assert.equal(st.split(" " + f + "(").length, 2, f);
});
