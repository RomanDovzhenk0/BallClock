// Kaya's styles of v1.9, part 2 (games.js, catalog B of KAIA-202): the ids, the dispatch tables, every id of v1.8 and of
// part 1 drawing their frames bit for bit, «Как у стиля» reaching styles 13–18, the wake handing over to the style's
// listening, determinism, fade-outs, seamless loops, the cost per frame, the long-state check, the arithmetic right
// shifts and the code copying into C++.
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
import { v18DigestOf, v19aDigestOf } from "./frames.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// v18DigestOf() on the sources of v1.8 (main at 85c9f66); v19aDigestOf() on the sources of part 1 (main at 2924f2c),
// made once before part 2's changes
const V18 = { sha: "ee51215b56103aa7ad409917f997227351c43d3184ede300e58d147b1ef3b7a5", frames: 4698 };
const V19A = { sha: "3cad0a5bb7817543eb89ce04341bf26a5512890a13bed9c00e6363508ca46119", frames: 4896 };
const S = Object.assign({}, DEFAULTS, { back_mode: 2, back_pal: 13, clock_style: 1, kaia_anim: 1 });
const C = { millis: 250000, synced: true, hour: 14, minute: 32, ms: 700, night: false, duck: 255 };
const STYLES = [13, 14, 15, 16, 17, 18], STATES = [K.A_LISTENING, K.A_THINKING, K.A_SPEAKING], SHOTS = [K.A_DONE, K.A_ERROR, K.A_NOTIFY];
const NAMES = ["Аркада", "Тетрис", "Механизм", "Неон", "Маятник", "Гирлянда"];
const at = (s, anim, style, look, t, extra) => frameOf(s, { ...C, play: { anim, style, look, lk: 0, speed: 100, t, color: null, ...extra } });
const diff = (a, b) => Math.max(...[...a].map((v, i) => Math.max(Math.abs(((v >> 16) & 255) - ((b[i] >> 16) & 255)), Math.abs(((v >> 8) & 255) - ((b[i] >> 8) & 255)), Math.abs((v & 255) - (b[i] & 255)))));
const PFX = ["arc", "tet", "gear", "neon", "pend", "gar"], EVS = ["Wake", "Listen", "Think", "Speak", "Done", "Error", "Notify"];
const src = () => readFileSync(join(here, "..", "src", "games.js"), "utf8").replace(/\r\n/g, "\n");

test("ids: styles 13–18 appended, their looks and wakes by table, nothing past what parts 1 and 2 draw", () => {
    assert.equal(STYLE_COUNT, 18);
    assert.deepEqual(STYLE_NAMES.slice(13), NAMES);
    assert.equal(LOOK_COUNT, 24);
    assert.equal(WAKE_COUNT, 30);
    for (const n of [...STATES, ...SHOTS]) assert.deepEqual(LOOK_NAMES[n].slice(18), NAMES, K.ANIM_NAMES[n]);
    assert.deepEqual(WAKE_NAMES.slice(24), NAMES);
    // the catalog's lengths (wake, done, error, notify)
    assert.deepEqual(STYLES.map((st) => [wake_ms[style_wake[st]], ...fam_ms[st - 4]]), [
        [1800, 1700, 1700, 1500],
        [2000, 1600, 1800, 1500],
        [2000, 1600, 1600, 1600],
        [2000, 1600, 1700, 1500],
        [2000, 1600, 1700, 1400],
        [2000, 1700, 1700, 1500],
    ]);
    // the tables: as long as the ids, and each the other's inverse
    assert.equal(look_style.length, LOOK_COUNT);
    assert.equal(wake_style.length, WAKE_COUNT);
    assert.equal(style_look.length, STYLE_COUNT + 1);
    assert.equal(style_wake.length, STYLE_COUNT + 1);
    assert.equal(fam_ms.length, STYLE_COUNT - 3);
    for (let style = 4; style <= STYLE_COUNT; style++) {
        assert.equal(look_style[style_look[style]], style);
        assert.equal(wake_style[style_wake[style]], style);
    }
    for (let look = 0; look < LOOK_COUNT; look++) if (look_style[look]) assert.equal(style_look[look_style[look]], look);
    for (let id = 0; id < WAKE_COUNT; id++) if (wake_style[id]) assert.equal(style_wake[wake_style[id]], id);
    for (const style of STYLES) {
        // the ids README's contract fixed for part 2
        assert.equal(lookOf(style, 0), style + 5);
        assert.equal(lookOf(style, 7), 7);
        assert.equal(wakeOf(style, 0), style + 11);
        assert.equal(wakeOf(style, 5), 5);
        for (const n of SHOTS) {
            assert.equal(shotLength(n, 0, style), fam_ms[style - 4][n - K.A_DONE]);
            assert.equal(shotLength(n, style + 5, 2), fam_ms[style - 4][n - K.A_DONE]);
        }
    }
    // an id of part 3 is not valid yet: the play clamps it to the last one drawn, the style is refused
    assert.equal(resolvePlay({ anim: K.A_DONE, style: 1, look: 25, t: 10 }).look, LOOK_COUNT - 1);
    assert.equal(resolvePlay({ anim: K.A_WAKE, style: 1, look: 32, speed: 100, t: 10 }).look, WAKE_COUNT - 1);
    assert.equal(resolvePlay({ anim: K.A_DONE, style: 19, t: 10 }), null);
});

test("every id of v1.8 and of part 1 draws its frames bit for bit", () => {
    assert.deepEqual(v18DigestOf(frameOf, DEFAULTS), V18);
    assert.deepEqual(v19aDigestOf(frameOf, DEFAULTS), V19A);
});

test("«Как у стиля» with style 13–18 plays its version, and any style can take that version by its id", () => {
    for (const style of STYLES) {
        const s = { ...S, kaia_anim: style };
        for (const n of [...STATES, ...SHOTS]) {
            const a = at(s, n, style, 0, 600, { ms: 1e9 });
            for (const other of [1, 3, 7, 11]) assert.deepEqual(at({ ...S, kaia_anim: other }, n, other, style + 5, 600, { ms: 1e9 }), a, style + "/" + n + " as look " + (style + 5) + " with style " + other);
        }
        assert.deepEqual(at(s, K.A_WAKE, style, 0, 900), at({ ...S, kaia_anim: 2 }, K.A_WAKE, 2, style + 11, 900, { lk: style + 5 }), "wake " + style);
        assert.ok(resolvePlay({ anim: K.A_DONE, style, t: 0 }));
    }
    // a look of v1.6, v1.8 or part 1 still plays with a new style
    assert.deepEqual(at({ ...S, kaia_anim: 14 }, K.A_ERROR, 14, 6, 300), at(S, K.A_ERROR, 1, 6, 300));
    assert.deepEqual(at({ ...S, kaia_anim: 18 }, K.A_DONE, 18, 12, 300), at(S, K.A_DONE, 1, 12, 300));
    assert.deepEqual(at({ ...S, kaia_anim: 16 }, K.A_NOTIFY, 16, 17, 300), at(S, K.A_NOTIFY, 1, 17, 300));
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
        for (const style of [...STYLES, 4, 9, 12]) {
            const s = { ...S, kaia_anim: style };
            // Неон · Стрелка is between two blinks halfway: take it in its first
            const t = n === K.A_WAKE ? wake_ms[style_wake[style]] >> 1 : n === K.A_NOTIFY && style === 16 ? 200 : 600;
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

// exact loop periods, ms: every term is t·w/1000 (256 a turn: 256000 covers all of them, voice() too), t·256/P or a
// posMod, so frame(t + P) = frame(t)
const LOOP = {
    13: [2816000, 3328000, 256000],  // the patrol 8.8 s and the mouth; the chase 2.6 s and the wobbles; voice
    14: [24000, 900, 256000],        // a piece every 6 s in four columns; the rain 0.9 s; voice
    15: [768000, 1500, 768000],      // a turn 12 s and the breath; a turn 1.5 s; a turn 12 s and voice
    16: [256000, 6800, 256000],      // the zones 6.4 s and the breath; the circuit (272 at 120 a second); voice
    17: [256000, 1200, 256000],      // the swing; the cradle 1.2 s; voice
    18: [256000, 500, 256000],       // each bulb's pace; the chase 0.5 s; voice
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

test("the cost per frame: within KAIA-202's rule of about 3× v1.8's heaviest frame, few voices, no hashes", () => {
    // the divisions one frame really runs (cost.mjs styleDivs), the most over 2 s of frames. v1.8's heaviest frame by
    // that count is Пинг-понг · Смэш (2010); KAIA-202's catalog was held to about 3× v1.8's heaviest. Two of the 42 go
    // over 2010 (the README lists them); GET /kaia/test gives the real times.
    const all = styleDivs([4, 5, 6, 7, 8, 9, ...STYLES]);
    const v18 = Math.max(...[4, 5, 6, 7, 8, 9].flatMap((s) => all[s]));
    assert.equal(v18, 2010);
    const fns = functions(), rows = {}, over = [];
    let worst = 0, wn = "";
    for (const style of STYLES) {
        const p = PFX[style - 13];
        rows[p] = all[style];
        rows[p].forEach((d, k) => {
            assert.ok(d <= 3 * v18, p + EVS[k] + ": " + d + " divisions a frame");
            if (d > v18) over.push(p + EVS[k]);
            if (d > worst) [worst, wn] = [d, p + EVS[k]];
        });
        for (const e of EVS) {
            const c = costOf(fns, p + e);
            assert.ok(c.voice <= 3 && c.hash8 === 0, p + e + ": " + c.voice + " voices, " + c.hash8 + " hashes");
            assert.ok(c.put <= 256, p + e + ": " + c.put + " put()");
        }
    }
    // the README's table (V8's coverage moves a count by a few when other styles share the process: always this set)
    assert.deepEqual(rows, {
        arc: [370, 300, 375, 299, 958, 567, 1247],
        tet: [350, 426, 434, 438, 449, 1546, 415],
        gear: [904, 899, 773, 911, 1403, 1084, 1144],
        neon: [489, 519, 1897, 476, 1166, 653, 1596],
        pend: [1101, 1109, 716, 2185, 4317, 968, 1020],
        gar: [855, 803, 837, 810, 842, 1244, 834],
    });
    assert.deepEqual([wn, worst], ["pendDone", 4317], "Маятник · В такт is the heaviest of part 2 (the README says so)");
    assert.deepEqual(over.sort(), ["pendDone", "pendSpeak"]);
    assert.doesNotMatch(src(), /inoise16|hash8/);
});

test("long states: t times its largest factor stays exact in 32 bits for 70 minutes (GET /kaia/test draws there)", () => {
    const fns = functions();
    const factors = [];
    // the calls in a body whose arguments pass t on (t, t − 90, t + 2200): those helpers see the state's t
    const callsWithT = (body) => {
        const out = [];
        for (const m of body.matchAll(/\b(\w+)\(/g)) {
            let d = 1, j = m.index + m[0].length, arg = "", args = [];
            for (; j < body.length && d; j++) {
                const ch = body[j];
                if (ch === "(" || ch === "[") d++;
                if (ch === ")" || ch === "]") d--;
                if (d === 1 && ch === ",") {
                    args.push(arg.trim());
                    arg = "";
                } else if (d) arg += ch;
            }
            args.push(arg.trim());
            if (args.some((a) => /^t(\s|$)/.test(a))) out.push(m[1]);
        }
        return out;
    };
    const look = (name, seen = new Set()) => {
        if (seen.has(name) || !fns.has(name)) return;
        seen.add(name);
        const body = fns.get(name);
        for (const m of body.matchAll(/\bt \* (\d+)/g)) factors.push([name, +m[1]]);
        // garListen: t · gar_sp[m], at most 66
        for (const m of body.matchAll(/\bt \* (\w+)\[/g)) factors.push([name, m[1] === "gar_sp" ? 66 : NaN]);
        for (const m of body.matchAll(/wave\(t[^,]*, ([^)]+)\)/g)) factors.push([name, Number(m[1])]);
        for (const f of callsWithT(body)) look(f, seen);
    };
    for (const p of PFX) for (const e of ["Listen", "Think", "Speak"]) look(p + e);
    assert.ok(factors.every(([, k]) => Number.isFinite(k)), JSON.stringify(factors));
    const max = factors.reduce((a, b) => (b[1] > a[1] ? b : a));
    assert.deepEqual(max, ["voice", 469]);
    assert.ok(70 * 60000 * max[1] < 2 ** 31, "70 minutes of one state");
    // the catalog's t · 640, t · 768 (Аркада · Погоня) and t · 1536 (Гирлянда · Бегущие огни) take t modulo their period
    assert.match(fns.get("arcThink"), /wave\(posMod\(t, 400\), 640\)/);
    assert.match(fns.get("arcThink"), /tg = posMod\(t, 1000\)/);
    assert.match(fns.get("garThink"), /posMod\(t, 500\) \* 1536 \/ 1000/);
});

test("the right shifts of negative ints round down, in JS as in GCC, and stay shifts", () => {
    for (let v = -600; v <= 600; v++) {
        assert.equal(v >> 7, Math.floor(v / 128));
        assert.equal(v >> 3, Math.floor(v / 8));
        assert.equal(v >> 1, Math.floor(v / 2));
    }
    const fns = functions();
    assert.match(fns.get("tetPlace"), /\+ 64\) >> 7\);[\s\S]*\+ 64\) >> 7\);/);
    assert.match(fns.get("tetStack"), /\) >> 3;/);
    assert.match(fns.get("pendError"), /sx >> 1 : sx, w > 0 \? \(sy - 45\) >> 1/);
});

test("catalog B's styles are integer-only and copy line by line into C++", () => {
    const body = src().split("// ================= the helpers of catalog B")[1];
    const fns = [...body.matchAll(/^export function (\w+)\((?:n, t, col, k|n, t, du, col)\) \{$/gm)].map((m) => m[1]);
    assert.deepEqual(fns.sort(), PFX.flatMap((p) => EVS.map((e) => p + e)).sort());
    const helpers = [...body.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]).filter((f) => !fns.includes(f));
    assert.deepEqual(helpers.sort(), ["arcDot", "chomp", "garCol", "garPut", "gear", "gears", "ghost", "neon", "neonTrace", "pang", "pcos", "pendX", "pendY", "psin", "tetAt", "tetPlace", "tetQ", "tetStack"]);
    const code = body.replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /\d\.\d/, "no float literals");
    assert.doesNotMatch(code, /=>|Math\.|\bfunction\s*\(|\.map\(|\.forEach\(|\.push\(|`|new \w+Array/, "no closures, JS-only helpers or per-ball tables");
    for (const m of code.matchAll(/[^/]\/(?![/*])[^;\n]*/g)) assert.match(m[0], /\| 0/, "a division without | 0: " + m[0].trim());
    // the small tables are const, at most 22 entries, integers (decimal or hex colours); about 230 bytes in PROGMEM
    const tabs = [...code.matchAll(/^const .*$/gm)].flatMap((l) => [...l[0].matchAll(/(\w+) = \[([^\]]*)\]/g)]);
    assert.deepEqual(tabs.map((m) => m[1]).sort(), ["arc_ch", "gar_b", "gar_pal", "gar_ph", "gar_sp", "neon_ar", "neon_ck", "neon_len", "neon_pt", "tet_cx", "tet_dt", "tet_la", "tet_lx", "tet_pc", "tet_sh", "tet_st"]);
    for (const m of tabs) assert.ok(m[2].split(",").length <= 22 && m[2].split(",").every((x) => /^\s*(-?\d+|0x[0-9a-f]+)\s*$/.test(x)), m[1]);
    // the four colours of the report
    for (const [c, v] of [["C_STEM", "0x5fd05a"], ["C_PINK", "0xff3fa8"], ["C_WIRE", "0xffe2b0"], ["C_WARM", "0xfff0d8"]]) assert.match(code, new RegExp("\\b" + c + " = " + v + "\\b"));
    // the dispatch (styles.js) names every animation once in its event's switch
    const st = readFileSync(join(here, "..", "src", "styles.js"), "utf8").replace(/\r\n/g, "\n").split("// ================= the event in a new style")[1];
    for (const f of fns) assert.equal(st.split(" " + f + "(").length, 2, f);
});
