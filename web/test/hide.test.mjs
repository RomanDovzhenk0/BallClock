// The Digit fade (v1.7): the level against hand-computed values, the time melting into what is under it, v1.6.2's
// frames bit for bit when it is off, the overlay on the digit balls, and the code copying into C++.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ClockApi, keyId } from "../src/api.js";
import { digitHide, frameOf, hideStep, hideTrack, isPlaying } from "../src/frame.js";
import * as K from "../src/kaia.js";
import { BallMatrix, diagToLed, gfx_font_3x5 } from "../src/matrix.js";
import { DEFAULTS, HIDE_RANGES, normalize } from "../src/settings.js";
import { digestOf } from "./frames.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// the digest of digestOf() on the sources of v1.6.2 (main at 34d4961), made once
const GOLDEN = { sha: "f61e4bb18afa16868be2624e429cac652bd670dd146071034c125f0a3d96dff6", frames: 850 };
const S = Object.assign({}, DEFAULTS);  // out 600, in 1200, hold 1000, keep 0
const FULL = 65535;

test("the settings: five keys, their defaults, and a value out of range reads as its default", () => {
    assert.deepEqual([DEFAULTS.kaia_hide, DEFAULTS.kaia_hide_out, DEFAULTS.kaia_hide_in, DEFAULTS.kaia_hide_hold, DEFAULTS.kaia_hide_keep], [1, 600, 1200, 1000, 0]);
    assert.deepEqual(Object.keys(HIDE_RANGES), ["kaia_hide", "kaia_hide_out", "kaia_hide_in", "kaia_hide_hold", "kaia_hide_keep"]);
    for (const [k, [lo, hi]] of Object.entries(HIDE_RANGES)) {
        assert.equal(normalize({ [k]: lo })[k], lo, k + " min");
        assert.equal(normalize({ [k]: hi })[k], hi, k + " max");
        assert.equal(normalize({ [k]: lo - 1 })[k], DEFAULTS[k], k + " below");
        assert.equal(normalize({ [k]: hi + 1 })[k], DEFAULTS[k], k + " above");
    }
    assert.equal(normalize({ kaia_hide_hold: "0" }).kaia_hide_hold, 0);  // 0 is in range for the hold
    assert.equal(normalize({ kaia_hide: true }).kaia_hide, 1);
    assert.equal(normalize(null).kaia_hide_out, 600);  // a clock before v1.7 carries none
});

test("hideStep: full after kaia_hide_out ms of playing, untouched in the hold, zero after kaia_hide_in ms", () => {
    // 65535 · 600 / 600: one 600 ms step is the whole way
    assert.equal(hideStep(0, 600, true, 0, S), 65535);
    // a 50 ms frame: 65535 · 50 / 600 = 5461.25 → 5461; twelve of them reach 65532, the thirteenth clamps
    assert.equal(hideStep(0, 50, true, 0, S), 5461);
    let h = 0;
    for (let k = 0; k < 12; k++) h = hideStep(h, 50, true, 0, S);
    assert.equal(h, 65532);
    assert.equal(hideStep(h, 50, true, 0, S), 65535);
    // not playing: nothing moves until kaia_hide_hold ms have passed since the animation
    assert.equal(hideStep(65535, 50, false, 0, S), 65535);
    assert.equal(hideStep(40000, 50, false, 999, S), 40000);
    // at 1000 it goes down: 65535 · 50 / 1200 = 2730.6 → 2730
    assert.equal(hideStep(65535, 50, false, 1000, S), 62805);
    assert.equal(hideStep(65535, 1200, false, 1000, S), 0);
    assert.equal(hideStep(65535, 600, false, 5000, S), 65535 - 32767);  // 65535 · 600 / 1200 = 32767.5 → 32767
    assert.equal(hideStep(100, 50, false, 5000, S), 0);  // clamped at 0
    // the times are the settings': 3000 ms out, 100 ms in, no hold
    assert.equal(hideStep(0, 300, true, 0, { ...S, kaia_hide_out: 3000 }), 6553);
    assert.equal(hideStep(65535, 100, false, 0, { ...S, kaia_hide_in: 100, kaia_hide_hold: 0 }), 0);
});

test("hideStep: a new animation turns the level round where it stands", () => {
    // 30000 up for 100 ms: + 65535 · 100 / 600 = 10922; then down: − 65535 · 100 / 1200 = 5461 → 35461, no jump
    let h = hideStep(30000, 100, true, 0, S);
    assert.equal(h, 40922);
    h = hideStep(h, 100, false, 1000, S);
    assert.equal(h, 35461);
    h = hideStep(h, 100, true, 0, S);  // and up again from there
    assert.equal(h, 35461 + 10922);
});

test("hideStep: dt is capped at 60 s, and kaia_hide 0 is 0 at once", () => {
    assert.ok(65535 * 60000 < 2 ** 32, "the cap keeps the uint32 product from overflowing");
    // 65535 · 100000 would overflow a uint32: capped, the answer is the one for 60 s
    assert.equal(hideStep(0, 100000, true, 0, S), hideStep(0, 60000, true, 0, S));
    assert.equal(hideStep(0, 1e9, true, 0, { ...S, kaia_hide_out: 3000 }), 65535);
    assert.equal(hideStep(65535, 1e9, false, 1000, { ...S, kaia_hide_in: 5000 }), 0);
    assert.equal(hideStep(30000, 50, true, 0, { ...S, kaia_hide: 0 }), 0);
    assert.equal(hideStep(30000, 50, false, 5000, { ...S, kaia_hide: 0 }), 0);
});

test("digitHide: smoothstep of the level, less by kaia_hide_keep", () => {
    assert.equal(digitHide(S, 0), 0);
    assert.equal(digitHide(S, FULL), 255);
    assert.equal(digitHide(S, 256), 0);  // u = 256 · 255 / 65535 = 0
    // 32768: u = 127 (127.5 truncated); 127² · 511 / 65025 = 126.75 → 126
    assert.equal(digitHide(S, 32768), 126);
    assert.equal(digitHide({ ...S, kaia_hide_keep: 25 }, 32768), 94);  // 126 · 75 / 100 = 94.5
    assert.equal(digitHide({ ...S, kaia_hide_keep: 50 }, FULL), 127);  // 255 · 50 / 100 = 127.5
    assert.equal(digitHide({ ...S, kaia_hide_keep: 100 }, FULL), 0);
    assert.equal(digitHide({ ...S, kaia_hide: 0 }, FULL), 0);
});

test("hideTrack: the level of a whole cycle, one frame at a time", () => {
    // 1 s of nothing, a one-shot of 650 ms (13 frames), then the pause and the way back
    const L = { h: 0, t: 1000, end: 0, on: 0 };
    let now = 1000;
    const frame = (playing) => hideTrack(L, S, playing, (now += 50));
    for (let k = 0; k < 20; k++) assert.equal(frame(false), 0);
    for (let k = 0; k < 13; k++) frame(true);
    assert.equal(L.h, 65535);
    assert.equal(L.on, 1);
    const stop = now + 50;
    assert.equal(frame(false), 65535, "the first frame without it");
    assert.equal(L.end, stop);
    // the hold: 1000 ms from the end → 20 frames of nothing happening, the 21st starts down
    for (let k = 0; k < 19; k++) assert.equal(frame(false), 65535, "hold " + k);
    assert.equal(frame(false), 65535 - 2730);
    for (let k = 0; k < 24; k++) frame(false);
    assert.equal(L.h, 0);
    // an animation in the hold keeps the level and sends it up again
    const M = { h: 65535, t: 5000, end: 5000, on: 0 };
    assert.equal(hideTrack(M, S, false, 5500), 65535);
    assert.equal(hideTrack(M, S, true, 5550), 65535);
    assert.equal(M.on, 1);
    // a clock with the fade off never leaves 0
    assert.equal(hideTrack({ h: 0, t: 0, end: 0, on: 0 }, { ...S, kaia_hide: 0 }, true, 600), 0);
});

test("isPlaying: an animation is drawn, unless the night rule 2 or the style «Выкл» hides it", () => {
    const p = { anim: K.A_DONE, style: 1, t: 100 };
    assert.equal(isPlaying(S, false, p), true);
    assert.equal(isPlaying(S, false, { ...p, t: 5000 }), false, "a one-shot past its length");
    assert.equal(isPlaying(S, false, null), false);
    assert.equal(isPlaying({ ...S, kaia_anim: 0 }, false, p), false);
    assert.equal(isPlaying({ ...S, kaia_night: 2 }, true, p), false);
    assert.equal(isPlaying({ ...S, kaia_night: 2 }, false, p), true);
    assert.equal(isPlaying({ ...S, kaia_night: 1 }, true, p), true);
    assert.equal(isPlaying(S, false, { anim: K.A_THINKING, style: 2, t: 29999 }), true);
    assert.equal(isPlaying(S, false, { anim: K.A_THINKING, style: 2, t: 30000 }), false);
});

// ——— the frames ———

const BASE = Object.assign({}, DEFAULTS, { back_mode: 0, clock_color: 0xffffff, kaia_anim: 1 });
const T = { millis: 100000, synced: true, hour: 12, minute: 34, ms: 700, night: false, play: null, duck: 0 };
const digitLeds = (font, x0s, text) => {
    const out = new Set();
    [...text].forEach((ch, k) => font.glyphs[ch.charCodeAt(0) - 33].forEach((b, gx) => {
        for (let gy = 0; gy < 5; gy++) if ((b >> gy) & 1 && diagToLed[1 + gy][x0s[k] + gx]) out.add(diagToLed[1 + gy][x0s[k] + gx] - 1);
    }));
    return [...out].sort((a, b) => a - b);
};

test("kaia_hide 0, and kaia_hide_keep 100, give v1.6.2's frames bit for bit", () => {
    const run = (extra, hide) => digestOf((s, c) => frameOf(s, hide == null ? c : { ...c, hide }), DEFAULTS, extra);
    assert.deepEqual(run({ kaia_hide: 0 }), GOLDEN, "the fade off, the level absent");
    assert.deepEqual(run({ kaia_hide: 0 }, FULL), GOLDEN, "the fade off, a level that would be full");
    assert.deepEqual(run({ kaia_hide_keep: 100 }, FULL), GOLDEN, "all of the time kept");
    assert.deepEqual(run({}), GOLDEN, "on, but the level is absent = 0");
    assert.deepEqual(run({}, 0), GOLDEN, "on, level 0");
    assert.notDeepEqual(run({}, FULL), GOLDEN, "on and full does change the frames");
});

test("at the full level with keep 0 the digit balls are the frame without the clock", () => {
    const sets = [
        { back_mode: 2, back_pal: 13, clock_style: 1 }, { back_mode: 1, back_pal: 5, clock_style: 2 }, { back_mode: 2, back_pal: 40, clock_style: 3 },
        { back_mode: 0, clock_style: 1, clock_style_zero: 1 },
    ];
    for (const set of sets) {
        const s = { ...DEFAULTS, ...set, kaia_anim: 1 };
        for (const night of [false, true]) {
            for (const ms of [20, 50, 300, 550, 599, 601, 900]) {  // the dots in each phase
                for (const synced of [true, false]) {
                    const c = { ...T, ms, night, synced, hour: 9 };
                    assert.deepEqual(frameOf(s, { ...c, hide: FULL }), frameOf({ ...s, clock_style: 0 }, c), JSON.stringify([set, night, ms, synced]));
                }
            }
            // and under an overlay: the digit balls take it like any other ball (fr.dg lifted to 255)
            for (const anim of [0, 1, 2, 3, 4, 5, 6]) {
                for (const style of [1, 2, 3]) {
                    const c = { ...T, night, duck: 255, play: { anim, style, look: 0, lk: 0, speed: 100, t: 700, color: null } };
                    assert.deepEqual(frameOf(s, { ...c, hide: FULL }), frameOf({ ...s, clock_style: 0 }, c), JSON.stringify([set, night, anim, style]));
                }
            }
        }
    }
});

test("part of the time: the digits melt into what is under them, truncating per channel", () => {
    const digits = digitLeds(gfx_font_3x5, [1, 5, 11, 15], "1234"), dotLeds = [diagToLed[2][9] - 1, diagToLed[4][9] - 1];
    // a white digit on black at the level 32768: H = 126, so 255 − 126 = 129 of 255 of white: 255 · 129 / 255 = 129
    const half = frameOf(BASE, { ...T, hide: 32768 });
    for (const i of digits) assert.equal(half[i], 0x818181, "digit " + i);
    // keep 50 at the full level: H = 127, alpha 128
    const keep = frameOf({ ...BASE, kaia_hide_keep: 50 }, { ...T, hide: FULL });
    for (const i of digits) assert.equal(keep[i], 0x808080, "kept " + i);
    // the dots (ms 300: on, 0xf8fcf8 from getColor24) go through setXY too: 248 · 129 / 255 = 125, 252 · 129 / 255 = 127
    const dots = frameOf(BASE, { ...T, ms: 300, hide: 32768 });
    for (const i of dotLeds) assert.equal(dots[i], 0x7d7f7d, "dot " + i);
    // nothing but the digits and the dots changes
    const plain = frameOf(BASE, { ...T, ms: 300 });
    for (let i = 0; i < 128; i++) if (!digits.includes(i) && !dotLeds.includes(i)) assert.equal(dots[i], plain[i], "ball " + i);
    // over a background the digit ends on the (ducked) background under it
    const bg = { ...BASE, back_mode: 2, back_pal: 13 };
    const gone = frameOf(bg, { ...T, hide: FULL, duck: 255 }), noClock = frameOf({ ...bg, clock_style: 0 }, { ...T, duck: 255 });
    for (const i of digits) assert.equal(gone[i], noClock[i]);
    assert.ok(digits.some((i) => noClock[i] !== 0), "the background is lit under the digits");
    // at night into black, never a dark hole: night_color on black, 255 · 129 / 255 = 129 of red
    const night = frameOf(bg, { ...T, night: true, hide: FULL }), nightHalf = frameOf(bg, { ...T, night: true, hide: 32768 });
    for (const i of digits) {
        assert.equal(night[i], 0);
        assert.equal(nightHalf[i], 0x810000);
    }
});

test("put() lifts fr.dg on marked balls by the fade: dg + (255 − dg) · H / 255", () => {
    const m = new BallMatrix();
    K.useMatrix(m);
    K.fr.sc = 255;
    K.fr.dg = 89;
    m.marks[5] = 1;
    const at = (hd) => {
        K.fr.hd = hd;
        m.clear();
        K.put(5, 0xffffff, 255);
        K.put(6, 0xffffff, 255);  // not marked: untouched by the lift
        return [m.leds[5] & 255, m.leds[6] & 255];
    };
    assert.deepEqual(at(0), [89, 255]);
    assert.deepEqual(at(100), [154, 255]);  // 89 + 166 · 100 / 255 = 154.1 → 154
    assert.deepEqual(at(255), [255, 255]);
    K.fr.hd = 0;
});

test("a play under a half-faded time: only the digits and the dots differ", () => {
    const s = { ...BASE, back_mode: 2, back_pal: 13 }, digits = digitLeds(gfx_font_3x5, [1, 5, 11, 15], "1234"), dotLeds = [diagToLed[2][9] - 1, diagToLed[4][9] - 1];
    const play = { anim: K.A_LISTENING, style: 1, look: 0, t: 700, color: null };
    const a = frameOf(s, { ...T, duck: 255, play }), b = frameOf(s, { ...T, duck: 255, play, hide: 32768 });
    assert.notDeepEqual(a, b);
    for (let i = 0; i < 128; i++) if (!digits.includes(i) && !dotLeds.includes(i)) assert.equal(a[i], b[i], "ball " + i);
});

test("the mock answers the five keys and fades the time in its frames", async () => {
    globalThis.performance ??= { now: () => Date.now() };
    const { createMock } = await import("../src/mock.js");
    const api = new ClockApi(createMock().send);
    const st = await api.state();
    for (const k of Object.keys(HIDE_RANGES)) assert.equal(st.settings[k], DEFAULTS[k], k);
    await api.set(keyId("kaia_hide_out"), 900);
    await api.set(keyId("kaia_hide_keep"), 20);
    const after = (await api.state()).settings;
    assert.equal(after.kaia_hide_out, 900);
    assert.equal(after.kaia_hide_keep, 20);
});

test("the Digit fade is integer-only and copies line by line into C++", () => {
    const src = readFileSync(join(here, "..", "src", "frame.js"), "utf8").replace(/\r\n/g, "\n");
    const fn = (name) => src.split("export function " + name + "(")[1].split("\n}\n")[0];
    const code = ["hideStep", "digitHide", "hideTrack"].map(fn).join("\n").replace(/\/\/[^\n]*/g, "");
    assert.ok(code.includes("65535 * dt / S.kaia_hide_out"));
    assert.doesNotMatch(code, /\d\.\d/, "no float literals");
    assert.doesNotMatch(code, /=>|Math\.|\bfunction\s*\(|\.map\(|\.forEach\(|`/, "no closures or JS-only helpers");
    for (const m of code.matchAll(/[^/]\/(?![/*])[^;\n]*/g)) assert.match(m[0], /\| 0/, "a division without | 0: " + m[0].trim());
    // the mark alpha in matrix.js and the lift in put()
    const mx = readFileSync(join(here, "..", "src", "matrix.js"), "utf8").replace(/\r\n/g, "\n");
    const mixFn = mx.split("export function mix(")[1].split("\n}\n")[0];
    assert.doesNotMatch(mixFn, /\d\.\d|Math\.|=>/);
    for (const m of mixFn.matchAll(/[^/]\/(?![/*])[^;\n]*/g)) assert.match(m[0], /\| 0/, "mix: " + m[0].trim());
    const lift = readFileSync(join(here, "..", "src", "kaia.js"), "utf8").split("\n").filter((l) => l.includes("fr.hd") && !l.trim().startsWith("//"));
    for (const l of lift.filter((x) => x.includes("/"))) assert.match(l, /\| 0/);
});
