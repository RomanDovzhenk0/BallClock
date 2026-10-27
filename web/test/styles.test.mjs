// Kaya's styles of v1.8 (styles.js): the ids appended and every old id drawing v1.7's frames bit for bit, «Как у стиля»
// reaching styles 4–9, the wake handing over to the style's listening, determinism, fade-outs, seamless loops, the cost
// per frame against v1.6's, the long-state check, and the code copying into C++.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { frameOf, renderFrame, resolvePlay } from "../src/frame.js";
import * as K from "../src/kaia.js";
import { LOOK_COUNT, LOOK_NAMES, lookOf, shotLength, stateLook } from "../src/looks.js";
import { BallMatrix } from "../src/matrix.js";
import { DEFAULTS, normalize } from "../src/settings.js";
import { fam_ms, STYLE_COUNT, STYLE_NAMES } from "../src/styles.js";
import { WAKE_COUNT, WAKE_NAMES, wake_ms, wakeLength, wakeOf } from "../src/wakes.js";
import { costOf, functions } from "./cost.mjs";
import { idsDigestOf } from "./frames.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// idsDigestOf() on the sources of v1.7 (main at a48d451), made once before v1.8's changes
const OLD_IDS = { sha: "e19618f0a87f1a30fcc339b225bf35091ec1bb209f336122332bdc6693175ab2", frames: 2268 };
const S = Object.assign({}, DEFAULTS, { back_mode: 2, back_pal: 13, clock_style: 1, kaia_anim: 1 });
const C = { millis: 250000, synced: true, hour: 14, minute: 32, ms: 700, night: false, duck: 255 };
const STYLES = [4, 5, 6, 7, 8, 9], STATES = [K.A_LISTENING, K.A_THINKING, K.A_SPEAKING], SHOTS = [K.A_DONE, K.A_ERROR, K.A_NOTIFY];
const at = (s, anim, style, look, t, extra) => frameOf(s, { ...C, play: { anim, style, look, lk: 0, speed: 100, t, color: null, ...extra } });
const diff = (a, b) => Math.max(...[...a].map((v, i) => Math.max(Math.abs(((v >> 16) & 255) - ((b[i] >> 16) & 255)), Math.abs(((v >> 8) & 255) - ((b[i] >> 8) & 255)), Math.abs((v & 255) - (b[i] & 255)))));
const PFX = ["pp", "kal", "lava", "face", "gal", "scan"], EVS = ["Wake", "Listen", "Think", "Speak", "Done", "Error", "Notify"];

test("ids appended: the names, the lengths, and where a style's versions sit", () => {
    assert.equal(STYLE_COUNT, 9);
    assert.deepEqual(STYLE_NAMES, ["Выкл", "Рябь", "Орбита", "Искры", "Пинг-понг", "Калейдоскоп", "Лава-лампа", "Мордашка", "Галактика", "Сканер"]);
    assert.equal(LOOK_COUNT, 15);
    assert.equal(WAKE_COUNT, 21);
    for (const n of [...STATES, ...SHOTS]) assert.deepEqual(LOOK_NAMES[n].slice(9), STYLE_NAMES.slice(4), K.ANIM_NAMES[n]);
    assert.deepEqual(WAKE_NAMES.slice(15), STYLE_NAMES.slice(4));
    assert.deepEqual(wake_ms.slice(15), [1800, 2000, 2000, 1900, 2000, 2000]);
    assert.deepEqual(fam_ms, [[1500, 1600, 1600], [1600, 1600, 1700], [1600, 1600, 1600], [1700, 1600, 1500], [1700, 1700, 1500], [1500, 1600, 1500]]);
    for (let style = 1; style <= 9; style++) {
        // look 0 is the style's version: 1–3 stay 0 (the style functions take the style), 4–9 go to 9–14
        assert.equal(lookOf(style, 0), style <= 3 ? 0 : style + 5);
        for (const look of [1, 5, 8, 12]) assert.equal(lookOf(style, look), look);
        assert.equal(wakeOf(style, 0), style <= 3 ? style : style + 11);
        assert.equal(wakeOf(style, 13), 13);
        for (const n of SHOTS) {
            if (style >= 4) assert.equal(shotLength(n, 0, style), fam_ms[style - 4][n - K.A_DONE]);
            assert.equal(shotLength(n, 9 + (style % 6), 1), fam_ms[style % 6][n - K.A_DONE]);
        }
    }
    assert.equal(normalize({ kaia_anim: "7" }).kaia_anim, 7);
});

test("every id of v1.6 draws v1.7's frames bit for bit", () => {
    assert.deepEqual(idsDigestOf(frameOf, DEFAULTS), OLD_IDS);
});

test("«Как у стиля» with style 4–9 plays its version, and any style can take that version by its id", () => {
    for (const style of STYLES) {
        const s = { ...S, kaia_anim: style };
        for (const n of [...STATES, ...SHOTS]) {
            const a = at(s, n, style, 0, 600, { ms: 1e9 });
            for (const other of [1, 3, 6]) assert.deepEqual(at({ ...S, kaia_anim: other }, n, other, style + 5, 600, { ms: 1e9 }), a, style + "/" + n + " as look " + (style + 5) + " with style " + other);
        }
        assert.deepEqual(at(s, K.A_WAKE, style, 0, 900), at({ ...S, kaia_anim: 2 }, K.A_WAKE, 2, style + 11, 900, { lk: style + 5 }), "wake " + style);
        // a style's version of an event with another look for the listening after it
        assert.ok(resolvePlay({ anim: K.A_DONE, style, t: 0 }));
    }
    // the play takes styles 1–9 only
    for (const style of [0, 10, -1]) assert.equal(resolvePlay({ anim: K.A_DONE, style, t: 100 }), null, "style " + style);
    // and a look 1–8 still plays with a new style
    assert.deepEqual(at({ ...S, kaia_anim: 7 }, K.A_ERROR, 7, 6, 300), at(S, K.A_ERROR, 1, 6, 300));
});

test("a new style's wake ends at its length at every speed and settles into the style's listening", () => {
    for (const style of STYLES) {
        const s = { ...S, kaia_anim: style };
        for (const sp of [50, 100, 200]) {
            const len = wakeLength(style + 11, sp);
            assert.equal(resolvePlay({ anim: K.A_WAKE, style, look: 0, speed: sp, t: len - 1 }).anim, K.A_WAKE);
            const after = resolvePlay({ anim: K.A_WAKE, style, look: 0, lk: 0, speed: sp, t: len + 40 });
            assert.deepEqual([after.anim, after.look, after.t], [K.A_LISTENING, 0, 40], "the listening keeps real time");
            // the last wake frame against the style's listening at its own t = -1, as it runs under the wake
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
        for (const style of STYLES) {
            const s = { ...S, kaia_anim: style }, t = n === K.A_WAKE ? wake_ms[style + 11] >> 1 : 700;
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

// exact loop periods, ms: every term is t·w/1000 (256 a turn), t·256/P or a posMod, so frame(t + P) = frame(t)
const LOOP = {
    4: [2800, 1040, 256000],            // the rally 2·1400, the fast one 2·520; the hops: voice and wave 37
    5: [1920000, 160000, 1280000],      // the turn 30 s with the breath (wave 50); 5 s and wave 200 and the rings; 20 s and voice
    6: [256000, 256000, 256000],        // wave 17 … 116 and voice
    7: [25200, 3200, 13568000],         // blinks 8.4 s with the glance 12.6 s; 3.2 s; voice with a blink every 5.3 s
    8: [1280000, 9984000, 768000],      // the arms 10 s with the stars (w 150–213); 2.6 s, 0.6 s and the stars; 12 s, the stars, voice
    9: [3200, 1280, 256000],            // wave 80; wave 200; voice and wave 40
};

test("every new state loops without a seam, and still draws after an hour", () => {
    const s0 = { ...S, back_mode: 0, clock_style: 0 }, none = frameOf(s0, { ...C, play: null });
    for (const style of STYLES) {
        const s = { ...s0, kaia_anim: style };
        STATES.forEach((n, k) => {
            const per = LOOP[style][k];
            for (const t of [1000, 12345, 61000, 100000]) {
                assert.deepEqual(at(s, n, style, 0, t + per, { ms: 1e10 }), at(s, n, style, 0, t, { ms: 1e10 }), K.ANIM_NAMES[n] + " " + style + " at " + t);
            }
            assert.notDeepEqual(at(s, n, style, 0, 3600000, { ms: 1e10 }), none, K.ANIM_NAMES[n] + " " + style + " after an hour");
        });
    }
});

test("the cost per frame stays within v1.6's: divisions under its heaviest look or wake, few voices and hashes", () => {
    const fns = functions();
    const v16 = ["echoListen", "tideListen", "auroraListen", "gazeListen", "bubblesListen", "snakeThink", "neuronThink", "hourglassThink", "dotsThink", "atomThink",
        "eqSpeak", "scopeSpeak", "raysSpeak", "speakersSpeak", "lipsSpeak", "checkDone", "barDone", "confettiDone", "ringDone", "okDone", "shakeError", "crossError",
        "glitchError", "sirenError", "powerOffError", "bangNotify", "knockNotify", "beaconNotify", "mailNotify", "badgeNotify", "dawnShot", "radarShot", "spiralShot",
        "heartShot", "eyeShot", "starsShot", "fireworkShot", "rainShot", "powerOnWake", "bunnyWake", "nameWake"];
    const budget = Math.max(...v16.map((f) => costOf(fns, f).div));
    assert.equal(budget, costOf(fns, "fireworkShot").div, "Салют is v1.6's heaviest");
    assert.equal(budget, 5355);
    assert.equal(Math.max(...v16.map((f) => costOf(fns, f).voice)), 128, "v1.6: Осциллограф calls voice() for every ball");
    assert.equal(Math.max(...v16.map((f) => costOf(fns, f).hash8)), 8, "v1.6: Сбой's 8 hashes");
    let worst = 0;
    for (const p of PFX) {
        for (const e of EVS) {
            const c = costOf(fns, p + e);
            assert.ok(c.div <= budget, p + e + ": " + c.div + " divisions a frame");
            assert.ok(c.voice <= 3 && c.hash8 <= 2, p + e + ": " + c.voice + " voices, " + c.hash8 + " hashes");
            assert.ok(c.put <= 256, p + e + ": " + c.put + " put()");
            worst = Math.max(worst, c.div);
        }
    }
    assert.equal(worst, costOf(fns, "ppWake").div, "Пинг-понг · Подача is the heaviest new one (the README says so)");
    assert.equal(worst, 3874);
    assert.doesNotMatch(readFileSync(join(here, "..", "src", "styles.js"), "utf8"), /inoise16/);
});

test("long states: t times its largest factor stays exact in 32 bits for an hour", () => {
    const fns = functions();
    const factors = [];
    const look = (name, seen = new Set()) => {
        if (seen.has(name) || !fns.has(name)) return;
        seen.add(name);
        const body = fns.get(name);
        for (const m of body.matchAll(/\bt \* (\d+)/g)) factors.push([name, +m[1]]);
        for (const m of body.matchAll(/\bt \* \((\d+) \+ \(h3\[i\] & (\d+)\)\)/g)) factors.push([name, +m[1] + +m[2]]);
        // wave(t…, w): t·w; w may name the loop's j (at most 3)
        for (const m of body.matchAll(/wave\(t[^,]*, ([^)]+)\)/g)) factors.push([name, new Function("j", "return " + m[1])(3)]);
        for (const m of body.matchAll(/\b(\w+)\(/g)) look(m[1], seen);
    };
    for (const p of PFX) for (const e of ["Listen", "Think", "Speak"]) look(p + e);
    const max = factors.reduce((a, b) => (b[1] > a[1] ? b : a));
    assert.deepEqual(max, ["kalThink", 500]);
    assert.ok(factors.some(([f, k]) => f === "voice" && k === 469) && factors.some(([f, k]) => f === "galStar" && k === 213));
    assert.ok(3600000 * max[1] < 2 ** 31, "an hour of one state");
});

test("the styles are integer-only and copy line by line into C++", () => {
    const src = readFileSync(join(here, "..", "src", "styles.js"), "utf8").replace(/\r\n/g, "\n");
    const body = src.split("// ================= the helpers of the new styles")[1];
    const fns = [...body.matchAll(/^export function (\w+)\((?:n, t, col, k|n, t, du, col)\) \{$/gm)].map((m) => m[1]);
    assert.deepEqual(fns.sort(), PFX.flatMap((p) => EVS.map((e) => p + e)).sort());
    const code = body.replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /\d\.\d/, "no float literals");
    assert.doesNotMatch(code, /=>|Math\.|\bfunction\s*\(|\.map\(|\.forEach\(|`|new \w+Array/, "no closures, JS-only helpers or per-ball tables");
    for (const m of code.matchAll(/[^/]\/(?![/*])[^;\n]*/g)) assert.match(m[0], /\| 0/, "a division without | 0: " + m[0].trim());
    // the dispatch names every animation once
    for (const f of fns) assert.equal(body.split(f + "(").length, 3, f);
});
