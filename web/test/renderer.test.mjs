// The renderer against hand-computed values and against the firmware's own sources.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { backScale, duckAfter, frameOf, resolvePlay } from "../src/frame.js";
import * as K from "../src/kaia.js";
import { blend, sin8 } from "../src/lib8.js";
import { diagToLed, font_3x5_diag, font_4x5, gfx_font_3x5, ledDiag, rgb565to888, rgb565to888full, rgb888to565, xyToLed } from "../src/matrix.js";
import { inoise16 } from "../src/noise.js";
import { colorFromPalette16, gradientTo16, PAL_NAMES, PALETTES } from "../src/palettes.js";
import { brightNow, isNight } from "../src/redraw.js";
import { DEFAULTS } from "../src/settings.js";

const fw = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "firmware");
const read = (p) => readFileSync(join(fw, p), "utf8");
const bytesOf = (text) => [...text.matchAll(/0x([0-9a-f]{2})/gi)].map((m) => parseInt(m[1], 16));

// a dark clock to read the digits from: no background, white digits
const BASE = Object.assign({}, DEFAULTS, { back_mode: 0, clock_color: 0xffffff, kaia_anim: 1 });
const T1234 = { millis: 100000, synced: true, hour: 12, minute: 34, ms: 700, night: false, play: null, duck: 0 };
const lit = (f) => [...f].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);

test("sin8 (FastLED sin8_C) at 0, 64, 128, 192", () => {
    assert.deepEqual([0, 64, 128, 192].map(sin8), [128, 255, 128, 1]);
});

test("tent, smooth and mix truncate like C ints", () => {
    assert.equal(K.tent(0, 96), 255);
    assert.equal(K.tent(48, 96), 127);  // 48·255/96 = 127.5
    assert.equal(K.tent(-48, 96), 127);
    assert.equal(K.tent(96, 96), 0);
    assert.equal(K.smooth(0, 100, 50), 126);  // u = 127, 127²·511/65025 = 126.75
    assert.equal(K.smooth(0, 100, -5), 0);
    assert.equal(K.smooth(0, 100, 200), 255);
    assert.equal(K.smooth(100, 0, 25), 214);  // the other way round: u = 191
    assert.equal(K.mix(0x000000, 0xffffff, 128), 0x808080);
    assert.equal(K.mix(0xff0000, 0x0000ff, 64), 0xbf0040);
    assert.equal(K.mix(0x000010, 0x000000, 100), 0x00000a);  // 16 + (-1600/255 → -6), not -7
    assert.equal(K.wave(0, 100), 0);
    assert.equal(K.comet(5, 5 * 256, 44, 14 * 256), 255);
});

test("blend (FastLED nblend with blend8, BLEND_FIXED) and the RGB565 round trips", () => {
    assert.equal(blend(0x000000, 0xffffff, 0), 0x000000);
    assert.equal(blend(0x000000, 0xffffff, 255), 0xffffff);
    assert.equal(blend(0x000000, 0xff0000, 127), 0x7f0000);  // (0·256 + 255 + 255·127) >> 8 = 127
    assert.equal(rgb888to565(0x123456), (2 << 11) | (13 << 5) | 10);
    assert.equal(rgb565to888full(rgb888to565(0x123456)), 0x103552);
    assert.equal(rgb565to888(rgb888to565(0x123456)), 0x103450);
    assert.equal(rgb565to888full(rgb888to565(0xff0000)), 0xff0000);
});

test("inoise16 (FastLED 3.7.7) on the lattice and at a worked-out point", () => {
    assert.equal(inoise16(0, 0, 0), 32745);  // 19052·440 >> 8
    assert.equal(inoise16(0x30000, 0x70000, 0x10000), 32745);
    assert.equal(inoise16(0x8000, 0x8000, 0), 25705);  // by hand: X1 = 0, X2 = -8192, Y1 = -4096; (-4096 + 19052)·440 >> 8
});

test("palettes: a gradient palette as FastLED converts it, and ColorFromPalette16", () => {
    // Fire_gp: 0 black, 128 red, 224 yellow, 255 white → 16 slots with the slot rule for < 16 entries
    assert.deepEqual(PALETTES[1], [0x000000, 0x1f0000, 0x3f0000, 0x5f0000, 0x7f0000, 0x9f0000, 0xbf0000, 0xdf0000, 0xff0000,
        0xff0000, 0xff3300, 0xff6600, 0xff9900, 0xffcc00, 0xffff00, 0xffff00]);
    assert.equal(PALETTES.length, 31);
    assert.equal(PAL_NAMES.length, 31);
    for (const p of PALETTES) assert.equal(p.length, 16);
    assert.equal(colorFromPalette16(PALETTES[0], 0x1080, 255), 0x340000);  // (51·248 >> 8) + (102·9 >> 8)
    assert.equal(colorFromPalette16(PALETTES[0], 0x1080, 128), 0x1b0000);  // nscale8x3_video: 26 + 1
    assert.equal(colorFromPalette16(PALETTES[0], 0xf000, 255), 0xffffff);  // no blend at offset 0
});

test("the gradient palettes are the ones in palettes.cpp", () => {
    const text = read("src/palettes.cpp");
    const gp = {};
    for (const m of text.matchAll(/DEFINE_GRADIENT_PALETTE\((\w+)\)\s*\{([^}]*)\}/g)) gp[m[1]] = [...m[2].replace(/\/\/[^\n]*/g, "").matchAll(/\d+/g)].map((x) => +x);
    const order = [...text.matchAll(/^\s+(\w+_(?:p|gp)),$/gm)].map((m) => m[1]);
    assert.equal(order.length, 31);
    order.forEach((name, i) => {
        if (gp[name]) assert.deepEqual(PALETTES[i], gradientTo16(gp[name]), name);
    });
    assert.equal(Object.keys(gp).length, 17);
});

test("the layout and the fonts are the firmware's tables", () => {
    const mx = read("src/matrix.cpp");
    const table = (name) => [...mx.split(name)[1].split("};")[0].matchAll(/\{([^{}]*)\}/g)].map((r) => r[1].split(",").map((x) => +x));
    assert.deepEqual(table("diagToLed["), diagToLed);
    assert.deepEqual(table("xyToLed["), xyToLed);
    const glyphs = (f) => Object.keys(f.glyphs).sort((a, b) => a - b).flatMap((k) => f.glyphs[k]);
    assert.deepEqual(glyphs(font_3x5_diag), bytesOf(read("src/font_3x5_diag.h").split("{")[1].split("}")[0]));
    assert.deepEqual(glyphs(font_4x5), bytesOf(read("src/font_4x5.h").split("{")[1].split("}")[0]));
    const f35 = bytesOf(read("lib/GyverGFX-dev/src/default/font3x5.h").split("PROGMEM = {")[1].split("};")[0]);
    for (const k of Object.keys(gfx_font_3x5.glyphs)) assert.deepEqual(gfx_font_3x5.glyphs[k], f35.slice(k * 3, k * 3 + 3), "glyph " + k);
});

test("firmware/lib/GyverGFX-dev is the same as libraries/GyverGFX-dev", () => {
    const a = join(fw, "lib", "GyverGFX-dev"), b = join(fw, "..", "libraries", "GyverGFX-dev");
    const walk = (d, p = "") => readdirSync(join(d, p)).flatMap((n) => (statSync(join(d, p, n)).isDirectory() ? walk(d, join(p, n)) : [join(p, n)]));
    const fa = walk(a).sort(), fb = walk(b).sort();
    assert.deepEqual(fa, fb);
    for (const f of fa) assert.ok(readFileSync(join(a, f)).equals(readFileSync(join(b, f))), f);
});

// 12:34: the digits at cursors 1, 5, 11, 15 in row 1, column bytes with bit 0 on top
function digitLeds(font, x0s, text) {
    const out = new Set();
    [...text].forEach((ch, k) => {
        const cols = font.glyphs[ch.charCodeAt(0) - 33];
        cols.forEach((b, gx) => {
            for (let gy = 0; gy < 5; gy++) if ((b >> gy) & 1 && diagToLed[1 + gy][x0s[k] + gx]) out.add(diagToLed[1 + gy][x0s[k] + gx] - 1);
        });
    });
    return [...out].sort((a, b) => a - b);
}

test("the digits of 12:34 in each font land on the right LEDs", () => {
    const fonts = [gfx_font_3x5, font_3x5_diag, font_4x5];
    for (let s = 1; s <= 3; s++) {
        const f = frameOf({ ...BASE, clock_style: s }, T1234);
        assert.deepEqual(lit(f), digitLeds(fonts[s - 1], [1, 5, 11, 15], "1234"), "font " + s);
    }
    // font 1's «1»: column 0x02 at x 2, 0x1f at x 3 (rows 1–5)
    const one = lit(frameOf({ ...BASE, clock_style: 1 }, { ...T1234, hour: 11, minute: 11 }));
    for (const led of [15, 25, 24, 16, 17, 7]) assert.ok(one.includes(led), "LED " + led);
    assert.equal(lit(frameOf({ ...BASE, clock_style: 0 }, T1234)).length, 0);  // «Нет»
});

test("the leading zero, the dots by ms and «-- --» before NTP", () => {
    const at = (s, c) => frameOf({ ...BASE, ...s }, { ...T1234, ...c });
    const nine = at({ clock_style: 1 }, { hour: 9, minute: 5 });
    const zero = at({ clock_style: 1, clock_style_zero: 1 }, { hour: 9, minute: 5 });
    assert.deepEqual(lit(zero), digitLeds(gfx_font_3x5, [1, 5, 11, 15], "0905"));
    assert.deepEqual(lit(nine), digitLeds(gfx_font_3x5, [5, 11, 15], "905"));
    const d1 = ledDiag(9, 2), d2 = ledDiag(9, 4), d3 = ledDiag(10, 4);
    assert.equal(at({ clock_style: 1 }, { ms: 300 })[d1], 0xf8fcf8);  // getColor24: 565 → 888 without the low bits
    assert.equal(at({ clock_style: 1 }, { ms: 300 })[d2], 0xf8fcf8);
    assert.equal(at({ clock_style: 3 }, { ms: 300 })[d3], 0xf8fcf8);
    assert.equal(at({ clock_style: 1 }, { ms: 50 })[d1], blend(0, 0xf8fcf8, 127));
    assert.equal(at({ clock_style: 1 }, { ms: 550 })[d1], blend(0, 0xf8fcf8, 127));
    assert.equal(at({ clock_style: 1 }, { ms: 601 })[d1], 0);
    const dashes = lit(at({ clock_style: 2 }, { synced: false }));
    const dash = (x) => [x, x + 1, x + 2].map((c) => diagToLed[3][c] - 1);
    assert.deepEqual(dashes, [...dash(1), ...dash(5), ...dash(12), ...dash(16)].sort((a, b) => a - b));
});

test("night mode: night_color digits on black", () => {
    const S = { ...BASE, back_mode: 2, night_color: 0xff0000 };
    const f = frameOf(S, { ...T1234, night: true });
    const digits = digitLeds(gfx_font_3x5, [1, 5, 11, 15], "1234");
    assert.deepEqual(lit(f), digits);
    for (const i of digits) assert.equal(f[i], 0xff0000);
    // the rule itself (isNight): below the threshold, inside the schedule
    const N = { ...DEFAULTS, night_mode: 1, night_trsh: 50, night_mode_auto: 1, night_mode_auto_since: 23 * 3600, night_mode_auto_to: 7 * 3600 };
    assert.equal(isNight(N, 10, 23, 30), true);
    assert.equal(isNight(N, 10, 12, 0), false);
    assert.equal(isNight(N, 60, 23, 30), false);
    assert.equal(isNight({ ...N, night_mode_auto: 0 }, 10, 12, 0), true);
});

test("the backgrounds: deterministic, moving with millis, stepped back by the overlay", () => {
    for (const mode of [1, 2]) {
        const S = { ...BASE, clock_style: 0, back_mode: mode, back_pal: 10, back_speed: 50 };
        const a = frameOf(S, T1234), b = frameOf(S, T1234), c = frameOf(S, { ...T1234, millis: T1234.millis + 640 });
        assert.deepEqual(a, b);
        assert.notDeepEqual(a, c);
        assert.equal(lit(a).length, 128, "every LED drawn");
        const ducked = frameOf(S, { ...T1234, duck: 255 });
        const sum = (f) => [...f].reduce((s, v) => s + ((v >> 16) & 255) + ((v >> 8) & 255) + (v & 255), 0);
        assert.ok(sum(ducked) < sum(a) * 0.6, "the background steps back");
    }
    assert.equal(backScale(255), 115);
    assert.equal(backScale(0), 255);
    assert.equal(duckAfter(0, true, 40), 255);
    assert.equal(duckAfter(255, false, 40), 0);
    // the gradient covers all 128 LEDs at every angle
    for (let a = -180; a <= 180; a += 15) assert.equal(lit(frameOf({ ...BASE, clock_style: 0, back_mode: 1, back_pal: 0, back_angle: a }, T1234)).length, 128, "angle " + a);
});

test("brightness: by hand, or the sensor mapped like Arduino map()", () => {
    assert.equal(brightNow({ auto_bright: 0, bright: 77 }, 500), 77);
    assert.equal(brightNow({ auto_bright: 1, adc_min: 0, adc_max: 1023, bright_min: 10, bright_max: 255 }, 512), 132);  // 512·245/1023 = 122.6 → 122 + 10
    assert.equal(brightNow({ auto_bright: 1, adc_min: 40, adc_max: 40, bright_min: 10, bright_max: 255 }, 512), 132);  // (10 + 255) / 2
    assert.equal(brightNow({ auto_bright: 1, adc_min: 100, adc_max: 200, bright_min: 0, bright_max: 255 }, 900), 255);
});

test("the ball tables (buildTables) hold the hexagon's rings, lens and sparks", () => {
    assert.deepEqual([...K.ring_len], [44, 38, 32, 14]);
    assert.equal(K.ring_len.reduce((a, b) => a + b), 128);
    assert.ok(Math.max(...K.b_dist) <= 38);
    for (let k = 0; k < K.SPARKS; k++) assert.equal(K.ringOf(K.spark[k][0]), 0, "spark " + k + " starts on the rim");
    assert.ok(K.tracks.len > 0 && K.tracks.len <= 32);
});

test("the overlay: kaia_bright, the night rule and what the digit balls keep", () => {
    const S = { ...BASE, clock_style: 1, kaia_anim: 1 };
    const play = { anim: K.A_SPEAKING, style: 1, wake: 0, speed: 100, t: 700, color: null };
    const day = frameOf(S, { ...T1234, play });
    assert.notDeepEqual(day, frameOf(S, T1234));
    const off = frameOf({ ...S, kaia_bright: 0 }, { ...T1234, play });
    assert.deepEqual(off, frameOf(S, T1234));
    const n2 = frameOf({ ...S, kaia_night: 2 }, { ...T1234, night: true, play });
    assert.deepEqual(n2, frameOf({ ...S, kaia_night: 2 }, { ...T1234, night: true }));
    const n0 = frameOf({ ...S, kaia_night: 0 }, { ...T1234, night: true, play });
    const n1 = frameOf({ ...S, kaia_night: 1 }, { ...T1234, night: true, play });
    const sum = (f) => [...f].reduce((s, v) => s + (v & 255), 0);
    assert.ok(sum(n1) < sum(n0), "dimmer at night");
    // the digit balls keep the time readable: a white digit over a strong overlay stays brighter than its neighbours
    const digits = digitLeds(gfx_font_3x5, [1, 5, 11, 15], "1234");
    const rest = [...day.keys()].filter((i) => !digits.includes(i));
    const r = (i) => (day[i] >> 16) & 255;
    assert.ok(digits.reduce((s, i) => s + r(i), 0) / digits.length > rest.reduce((s, i) => s + r(i), 0) / rest.length + 100);
});

test("every style: each state and one-shot draws, and ends after shot_ms", () => {
    const S = { ...BASE, clock_style: 1 };
    const none = frameOf(S, T1234);
    for (let style = 1; style <= 3; style++) {
        for (const anim of [K.A_LISTENING, K.A_THINKING, K.A_SPEAKING]) {
            assert.notDeepEqual(frameOf(S, { ...T1234, play: { anim, style, t: 900, color: null } }), none, style + "/" + anim);
        }
        for (const anim of [K.A_DONE, K.A_ERROR, K.A_NOTIFY]) {
            const du = K.shot_ms[style - 1][anim - K.A_DONE + 1];
            const p = { anim, style, t: 120, color: null };
            assert.notDeepEqual(frameOf(S, { ...T1234, play: p }), none, style + "/" + anim);
            assert.equal(resolvePlay({ ...p, t: du - 1 }) !== null, true);
            assert.equal(resolvePlay({ ...p, t: du }), null);
            assert.deepEqual(frameOf(S, { ...T1234, play: { ...p, t: du } }), none);
        }
        // a state ends after its ms (30 s by default)
        assert.equal(resolvePlay({ anim: K.A_THINKING, style, t: 29999 }) !== null, true);
        assert.equal(resolvePlay({ anim: K.A_THINKING, style, t: 30000 }), null);
        assert.equal(resolvePlay({ anim: K.A_THINKING, style, t: 500, ms: 400 }), null);
    }
    // done is green, error red, notify amber unless the call gave a colour
    const g = frameOf({ ...S, back_mode: 0, clock_style: 0 }, { ...T1234, play: { anim: K.A_DONE, style: 1, t: 50, color: null } });
    assert.ok(g.some((v) => ((v >> 8) & 255) > ((v >> 16) & 255) && ((v >> 8) & 255) > 0));
});

test("the same settings and time give the same frame", () => {
    const S = { ...DEFAULTS, back_mode: 2, back_pal: 13, kaia_anim: 2, kaia_wake: 6, kaia_wake_speed: 150 };
    const c = { ...T1234, ms: 260, duck: 140, play: { anim: K.A_WAKE, style: 2, wake: 6, speed: 150, t: 700, color: null } };
    const a = frameOf(S, c);
    frameOf({ ...S, kaia_anim: 3 }, { ...c, play: { anim: K.A_ERROR, style: 3, t: 300 } });  // something else in between
    assert.deepEqual(frameOf(S, c), a);
});
