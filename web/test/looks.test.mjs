// The looks per event (v1.6): ids and names, the one-shots end within their length (the wakes at their speed), the
// states loop without a seam, the same t gives the same frame, the ids stay in range, and the code copies into C++.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { frameOf, renderFrame, resolvePlay } from "../src/frame.js";
import * as K from "../src/kaia.js";
import { LOOK_COUNT, LOOK_NAMES, look_ms, shotLength } from "../src/looks.js";
import * as LK from "../src/looks.js";
import { BallMatrix } from "../src/matrix.js";
import { DEFAULTS, LOOK_KEYS, normalize } from "../src/settings.js";
import * as WK from "../src/wakes.js";

const S = Object.assign({}, DEFAULTS, { back_mode: 2, back_pal: 13, clock_style: 1, kaia_anim: 1 });
const C = { millis: 250000, synced: true, hour: 14, minute: 32, ms: 700, night: false, duck: 255 };
const STATES = [K.A_LISTENING, K.A_THINKING, K.A_SPEAKING], SHOTS = [K.A_DONE, K.A_ERROR, K.A_NOTIFY];
const at = (s, anim, look, t, extra) => frameOf(s, { ...C, play: { anim, style: s.kaia_anim, look, t, color: null, ...extra } });
const none = frameOf(S, { ...C, play: null });
const diff = (a, b) => Math.max(...[...a].map((v, i) => Math.max(Math.abs(((v >> 16) & 255) - ((b[i] >> 16) & 255)), Math.abs(((v >> 8) & 255) - ((b[i] >> 8) & 255)), Math.abs((v & 255) - (b[i] & 255)))));

test("ids and Russian names per event, and the one-shots' base lengths", () => {
    assert.equal(LOOK_NAMES.length, 7);
    assert.equal(LOOK_NAMES[K.A_WAKE], WK.WAKE_NAMES);
    for (const n of [...STATES, ...SHOTS]) {
        assert.equal(LOOK_NAMES[n].length, LOOK_COUNT, K.ANIM_NAMES[n]);
        assert.deepEqual(LOOK_NAMES[n].slice(0, 4), ["Как у стиля", "Рябь", "Орбита", "Искры"]);
    }
    assert.deepEqual(LOOK_NAMES[K.A_LISTENING].slice(4), ["Эхо", "Прилив", "Сияние", "Взгляд", "Пузырьки"]);
    assert.deepEqual(LOOK_NAMES[K.A_THINKING].slice(4), ["Змейка", "Нейроны", "Песочные часы", "Три точки", "Атом"]);
    assert.deepEqual(LOOK_NAMES[K.A_SPEAKING].slice(4), ["Эквалайзер", "Осциллограф", "Лучи", "Динамики", "Губы"]);
    assert.deepEqual(LOOK_NAMES[K.A_DONE].slice(4), ["Галочка", "Шкала", "Конфетти", "Кольцо", "«ОК»"]);
    assert.deepEqual(LOOK_NAMES[K.A_ERROR].slice(4), ["Нет-нет", "Крест", "Сбой", "Сирена", "Отключение"]);
    assert.deepEqual(LOOK_NAMES[K.A_NOTIFY].slice(4), ["«!»", "Тук-тук", "Маяк", "Конверт", "Значок"]);
    assert.deepEqual(look_ms, [[1600, 1500, 1800, 1700, 1600], [1400, 1600, 1300, 1600, 1500], [1500, 1500, 1600, 1700, 1600]]);
    // 0 is the style's own, 1–3 a style's: the lengths of v1.5
    for (let style = 1; style <= 3; style++) {
        for (const n of SHOTS) {
            assert.equal(shotLength(n, 0, style), K.shot_ms[style - 1][n - K.A_DONE + 1]);
            for (let v = 1; v <= 3; v++) assert.equal(shotLength(n, v, style), K.shot_ms[v - 1][n - K.A_DONE + 1]);
        }
    }
    // the settings: one key per event, 0 by default
    assert.deepEqual(LOOK_KEYS.slice(1).map((k) => DEFAULTS[k]), [0, 0, 0, 0, 0, 0]);
    assert.equal(normalize({ kaia_done: "6" }).kaia_done, 6);
});

test("look 0 follows the style, 1–3 draw that style's version whatever the style", () => {
    for (let style = 1; style <= 3; style++) {
        const s = { ...S, kaia_anim: style };
        for (const n of [...STATES, ...SHOTS]) {
            assert.deepEqual(at(s, n, 0, 300), at(s, n, style, 300), style + "/" + n);
            for (let v = 1; v <= 3; v++) assert.deepEqual(at(s, n, v, 300), at({ ...s, kaia_anim: v }, n, 0, 300), style + "/" + n + "/" + v);
        }
    }
    // v1.5's play without a look is look 0 (and the wake's look under its old name)
    assert.deepEqual(frameOf(S, { ...C, play: { anim: K.A_DONE, style: 1, t: 300 } }), at(S, K.A_DONE, 0, 300));
    assert.equal(resolvePlay({ anim: K.A_WAKE, style: 1, wake: 9, speed: 100, t: 10 }).look, 9);
});

test("every one-shot look ends within its length", () => {
    for (let style = 1; style <= 3; style++) {
        const s = { ...S, kaia_anim: style }, plain = frameOf(s, { ...C, play: null });
        for (const n of SHOTS) {
            for (let look = 0; look < LOOK_COUNT; look++) {
                const du = shotLength(n, look, style), p = { anim: n, style, look, t: du - 1, color: null };
                assert.ok(resolvePlay(p), K.ANIM_NAMES[n] + " " + look + " plays until its length");
                assert.equal(resolvePlay({ ...p, t: du }), null);
                // its last frame is the clock alone: the look has faded out by then
                assert.deepEqual(frameOf(s, { ...C, play: p }), plain, K.ANIM_NAMES[n] + " " + look + " style " + style + " at " + (du - 1));
                assert.notDeepEqual(at(s, n, look, du >> 1), plain, K.ANIM_NAMES[n] + " " + look + " draws");
            }
        }
    }
});

test("every wake ends within its length at its speed", () => {
    const fns = { 4: WK.dawnShot, 5: WK.radarShot, 6: WK.spiralShot, 7: WK.heartShot, 8: WK.eyeShot, 9: WK.starsShot, 10: WK.fireworkShot, 11: WK.rainShot, 12: WK.powerOnWake, 13: WK.bunnyWake, 14: WK.nameWake };
    for (let id = 4; id < WK.WAKE_COUNT; id++) {
        for (const sp of [50, 75, 100, 150, 200]) {
            const len = WK.wakeLength(id, sp), du = WK.wake_ms[id];
            // the wake alone, at the u of the last ms before the listening takes over
            const m = new BallMatrix();
            renderFrame(m, S, { ...C, play: null });
            const base = Uint32Array.from(m.leds);
            K.useMatrix(m);
            K.fr.sc = 255;
            K.fr.dg = 89;
            fns[id](K.A_WAKE, Math.min(du, (len - 1) * sp / 100 | 0), du, S.kaia_color);
            assert.deepEqual(Uint32Array.from(m.leds), base, "wake " + id + " at " + sp + " % still draws at " + (len - 1));
            assert.equal(resolvePlay({ anim: K.A_WAKE, style: 1, look: id, speed: sp, t: len }).anim, K.A_LISTENING);
        }
    }
    // and the listening after it is the listening's look
    const p = resolvePlay({ anim: K.A_WAKE, style: 2, look: 13, lk: 6, speed: 100, t: 2000 + 300 });
    assert.equal(p.anim, K.A_LISTENING);
    assert.equal(p.look, 6);
    assert.equal(p.t, 300);
});

test("the listening under the end of a wake is the listening's look, and it carries on after it", () => {
    for (const lk of [0, 2, 4, 6, 8]) {
        for (const id of [1, 3, 8, 14]) {
            const s = { ...S, kaia_anim: 3 }, len = WK.wakeLength(id, 100);
            const last = frameOf(s, { ...C, play: { anim: K.A_WAKE, style: 3, look: id, lk, speed: 100, t: len - 1 } });
            // the listening's look at its own t = -1, as it runs under the wake
            const m = new BallMatrix();
            renderFrame(m, s, { ...C, play: null });
            K.useMatrix(m);
            K.fr.sc = s.kaia_bright;
            K.fr.dg = 89;
            LK.stateLook(3, lk, K.A_LISTENING, -1, s.kaia_color, 255);
            const after = m.leds;
            assert.ok(diff(last, after) <= (id > 3 ? 12 : 120), "wake " + id + " → listening " + lk + ": " + diff(last, after));
        }
    }
});

// exact loop periods, ms: every term is t·w/1000 (256 a turn) or a posMod, so frame(t + P) = frame(t)
const LOOP = {
    [K.A_LISTENING]: { 4: 1600, 5: 64000, 6: 256000, 7: 256000 },
    [K.A_THINKING]: { 4: 3500, 6: 3000, 7: 1200, 8: 42432000 },  // Атом: its turns (1300, 1500, 1700 ms) and its nucleus (wave 300)
    [K.A_SPEAKING]: { 4: 256000, 5: 256000, 6: 256000, 7: 256000, 8: 256000 },
};

test("every state look loops without a seam", () => {
    for (const n of STATES) {
        for (const [look, per] of Object.entries(LOOP[n])) {
            for (const t of [1000, 12345, 61000, 100000]) {  // from 1 s: voice(t − a delay) runs on t ≥ 0
                const s = { ...S, back_mode: 0 };
                assert.deepEqual(at(s, n, +look, t + per, { ms: 1e9 }), at(s, n, +look, t, { ms: 1e9 }), K.ANIM_NAMES[n] + " " + look + " at " + t);
            }
        }
    }
    // Пузырьки: each bubble wraps from the top to the bottom at its own period, where its light is 0: the frame moves no
    // more than a bubble's own 1/16-row step (255 / 16 and rounding); a seam would jump by a whole bubble
    // Нейроны: never wraps (each flash is placed by hash8 of its number), so it has no seam to show
    const s = { ...S, back_mode: 0, clock_style: 0 };
    // where each bubble is: its wobble steps it sideways, and its faint side rims step from row to row with it
    const xs = (t) => LK.bub_x.map((x, j) => [x + (K.wave(t + j * 300, 170) * 2 / 128 | 0), (112 - (K.posMod(t + j * 470, 2200 + (j * 3 % 5) * 260) * 128 / (2200 + (j * 3 % 5) * 260) | 0)) >> 4]).join();
    let wraps = 0;
    for (let j = 0; j < 10; j++) {
        const per = 2200 + (j * 3 % 5) * 260;
        for (let w = per - j * 470 % per; w < 30000; w += per) {
            if (xs(w - 1).split(",").filter((v, k) => v !== xs(w).split(",")[k] && (k >> 1) !== j).length) continue;
            const d = diff(at(s, K.A_LISTENING, 8, w - 1, { ms: 1e9 }), at(s, K.A_LISTENING, 8, w, { ms: 1e9 }));
            assert.ok(d <= 24, "bubble " + j + " wraps at " + w + " with a jump of " + d);
            wraps++;
        }
    }
    assert.ok(wraps > 80, "wraps checked: " + wraps);
    for (const [n, look] of [[K.A_LISTENING, 8], [K.A_THINKING, 5]]) {
        // still drawing after an hour
        assert.notDeepEqual(at(s, n, look, 3600000, { ms: 1e9 }), frameOf(s, { ...C, play: null }));
    }
});

test("the same t gives the same frame, and each look is its own", () => {
    for (const n of [K.A_WAKE, ...STATES, ...SHOTS]) {
        const count = n === K.A_WAKE ? WK.WAKE_COUNT : LOOK_COUNT, seen = new Map();
        for (let look = 1; look < count; look++) {
            const t = n === K.A_WAKE ? WK.wake_ms[look] >> 1 : 450;
            const a = at(S, n, look, t, { speed: 100 });
            at({ ...S, kaia_anim: 3 }, K.A_ERROR, 6, 300);  // something else in between
            assert.deepEqual(at(S, n, look, t, { speed: 100 }), a, K.ANIM_NAMES[n] + " " + look);
            assert.notDeepEqual(a, none, K.ANIM_NAMES[n] + " " + look + " draws");
            const key = a.join(",");
            assert.ok(!seen.has(key), K.ANIM_NAMES[n] + " " + look + " looks like " + seen.get(key));
            seen.set(key, look);
        }
    }
});

test("ids in range: every id draws, and a look past the last is the last", () => {
    for (const n of [...STATES, ...SHOTS]) {
        assert.deepEqual(at(S, n, LOOK_COUNT, 500), at(S, n, LOOK_COUNT - 1, 500), K.ANIM_NAMES[n]);
    }
    assert.deepEqual(at(S, K.A_WAKE, WK.WAKE_COUNT, 700, { speed: 100 }).length, 128);
    // the boot tables the looks read stay on the plate
    assert.ok(Math.max(...WK.b_x) <= 38 && Math.max(...WK.b_row) <= 6);
    for (let p = -80; p <= 80; p += 4) for (let q = -24; q <= 24; q += 7) assert.ok(K.ballAt(p, q) < 128);
    for (let x = -4; x <= 42; x++) for (let r = -1; r <= 7; r++) assert.ok(K.ballRX(x, r) >= -1 && K.ballRX(x, r) < 128);
});

test("the looks are integer-only and copy line by line into C++", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "looks.js"), "utf8");
    const body = src.split("// ================= Слушает")[1];
    const fns = [...body.matchAll(/^export function (\w+)\((?:n, t, col, k|n, t, du, col)\) \{$/gm)].map((m) => m[1]);
    assert.equal(fns.length, 30);
    const code = body.replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /\d\.\d/, "no float literals");
    assert.doesNotMatch(code, /=>|Math\.|\bfunction\s*\(|\.map\(|\.forEach\(|`/, "no closures or JS-only helpers");
    for (const m of code.matchAll(/[^/]\/(?![/*])[^;\n]*/g)) assert.match(m[0], /\| 0/, "a division without | 0: " + m[0].trim());
    // the dispatch names every look once
    for (const f of fns) assert.equal(body.split(f + "(").length, 3, f);
});
