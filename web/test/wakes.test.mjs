// The wakes of v1.5 and v1.6: ids and names, lengths with the speed, determinism, the hand-over to listening, and that the
// new ones stay portable to C++ (integers, no closures).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { frameOf, renderFrame, resolvePlay } from "../src/frame.js";
import * as K from "../src/kaia.js";
import { BallMatrix } from "../src/matrix.js";
import { DEFAULTS } from "../src/settings.js";
import { WAKE_COUNT, WAKE_NAMES, wake_ms, wakeLength } from "../src/wakes.js";

const S = Object.assign({}, DEFAULTS, { back_mode: 2, back_pal: 13, clock_style: 1, kaia_anim: 1 });
const C = { millis: 250000, synced: true, hour: 14, minute: 32, ms: 700, night: false, duck: 255 };
const wake = (style, id, speed, t) => ({ anim: K.A_WAKE, style, wake: id, speed, t, color: null });
// the style's listening at its time t (also before 0, as it runs under the wake), over the same clock
function listeningAt(s, style, t) {
    const m = new BallMatrix();
    renderFrame(m, s, { ...C, play: null });
    K.useMatrix(m);
    K.fr.sc = s.kaia_bright;
    K.fr.dg = 89;
    K.stateDraw(style, K.A_LISTENING, t, s.kaia_color, 255);
    return m.leds;
}
const diff = (a, b) => Math.max(...[...a].map((v, i) => Math.max(Math.abs(((v >> 16) & 255) - ((b[i] >> 16) & 255)), Math.abs(((v >> 8) & 255) - ((b[i] >> 8) & 255)), Math.abs((v & 255) - (b[i] & 255)))));

test("ids and names in the site's order", () => {
    assert.equal(WAKE_COUNT, 24);
    assert.deepEqual(WAKE_NAMES.slice(0, 4), ["Как у стиля", "Рябь", "Орбита", "Искры"]);
    assert.deepEqual(WAKE_NAMES.slice(4, 15), ["Рассвет", "Радар", "Спираль", "Сердцебиение", "Глаз", "Звёзды", "Салют", "Дождь", "Включение", "Зайчик", "«КАЯ»"]);
    assert.deepEqual(WAKE_NAMES.slice(15, 21), ["Пинг-понг", "Калейдоскоп", "Лава-лампа", "Мордашка", "Галактика", "Сканер"]);  // v1.8: the styles' wakes
    assert.deepEqual(WAKE_NAMES.slice(21), ["Снежинка", "Светлячки", "Пламя"]);  // v1.9: catalog A's
    // wakes 1–3 keep the lengths of the styles' own wakes
    for (let s = 1; s <= 3; s++) assert.equal(wake_ms[s], K.shot_ms[s - 1][0]);
    for (let id = 4; id < WAKE_COUNT; id++) assert.ok(wake_ms[id] >= 1200 && wake_ms[id] <= 2500, "wake " + id);
});

test("the wake lengths at 50, 100 and 200 %", () => {
    const at = (sp) => [...Array(WAKE_COUNT - 1).keys()].map((k) => wakeLength(k + 1, sp));
    assert.deepEqual(at(100), [1900, 2000, 2000, 2000, 1800, 2000, 1900, 2200, 2000, 2200, 2000, 1800, 2000, 2200, 1800, 2000, 2000, 1900, 2000, 2000, 2000, 2000, 2000]);
    assert.deepEqual(at(50), [3800, 4000, 4000, 4000, 3600, 4000, 3800, 4400, 4000, 4400, 4000, 3600, 4000, 4400, 3600, 4000, 4000, 3800, 4000, 4000, 4000, 4000, 4000]);
    assert.deepEqual(at(200), [950, 1000, 1000, 1000, 900, 1000, 950, 1100, 1000, 1100, 1000, 900, 1000, 1100, 900, 1000, 1000, 950, 1000, 1000, 1000, 1000, 1000]);
    assert.equal(wakeLength(8, 150), 1466);  // 2200·100/150, truncated
    // the play turns into listening exactly then; 0 = the style's own
    for (const sp of [50, 100, 200]) {
        for (let style = 1; style <= 3; style++) {
            for (let id = 0; id < WAKE_COUNT; id++) {
                const len = wakeLength(id || style, sp);
                assert.equal(resolvePlay(wake(style, id, sp, len - 1)).anim, K.A_WAKE);
                const after = resolvePlay(wake(style, id, sp, len + 40));
                assert.equal(after.anim, K.A_LISTENING);
                assert.equal(after.t, 40, "the listening keeps real time");
            }
        }
    }
});

test("each wake draws, the same inputs give the same frame, and it ends in the style's listening", () => {
    const none = frameOf(S, { ...C, play: null });
    for (let style = 1; style <= 3; style++) {
        const s = { ...S, kaia_anim: style };
        for (let id = 0; id < WAKE_COUNT; id++) {
            for (const sp of [50, 100, 200]) {
                const len = wakeLength(id || style, sp);
                const mid = { ...C, play: wake(style, id, sp, len >> 1) };
                const a = frameOf(s, mid);
                assert.notDeepEqual(a, none, style + "/" + id + "/" + sp);
                assert.deepEqual(frameOf(s, mid), a, "deterministic");
                // the last wake frame against the first frame of the listening after it
                const last = frameOf(s, { ...C, play: wake(style, id, sp, len - 1) });
                const d = diff(last, listeningAt(s, style, -1));
                // the old wakes hand over with their digit rule (dg 153 → 89): the digit balls may jump, nothing else
                assert.ok(d <= (id > 3 ? 12 : 120), "style " + style + " wake " + id + " at " + sp + "%: " + d);
            }
        }
    }
});

test("wake 0 at 100 % is the style's own wake of v1.4.1, and the speed only stretches it", () => {
    for (let style = 1; style <= 3; style++) {
        const s = { ...S, kaia_anim: style };
        for (const t of [0, 300, 900, 1500, 1899]) {
            assert.deepEqual(frameOf(s, { ...C, play: wake(style, 0, 100, t) }), frameOf(s, { ...C, play: wake(style, style, 100, t) }));
        }
        // at 200 % the wake at t is the wake at 2t of 100 %, but the listening under it runs on real time
        const fast = frameOf(s, { ...C, play: wake(style, 5, 200, 300) });
        assert.ok(diff(fast, frameOf(s, { ...C, play: wake(style, 5, 100, 600) })) <= 255);
    }
    // the radar's beam is where the speed puts it
    const beamAt = (sp, t) => {
        const f = frameOf({ ...S, back_mode: 0, clock_style: 0, kaia_anim: 2 }, { ...C, play: wake(2, 5, sp, t) });
        return [...f].reduce((s, v) => s + (v & 255), 0);
    };
    assert.equal(beamAt(200, 350), beamAt(100, 700));
});

test("the new wakes are integer-only and copy line by line into C++", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "wakes.js"), "utf8");
    const body = src.split("// ================= the new wakes")[1].split("// ================= the wake with its speed")[0];
    const fns = [...body.matchAll(/^export function (\w+)\(n, t, du, col\) \{$/gm)].map((m) => m[1]);
    assert.deepEqual(fns, ["dawnShot", "radarShot", "spiralShot", "heartShot", "eyeShot", "starsShot", "fireworkShot", "rainShot", "powerOnWake", "bunnyWake", "nameWake"]);
    const code = body.replace(/\/\/[^\n]*/g, "");
    assert.doesNotMatch(code, /\d\.\d/, "no float literals");
    assert.doesNotMatch(code, /=>|Math\.|\bfunction\s*\(|\.map\(|\.forEach\(|`/, "no closures or JS-only helpers");
    // every division truncates like C: "a / b | 0"
    for (const m of code.matchAll(/[^/]\/(?![/*])[^;\n]*/g)) assert.match(m[0], /\| 0/, "a division without | 0: " + m[0].trim());
});

test("each new wake is readable: it lights a good part of the hexagon at its peak", () => {
    for (let id = 4; id < WAKE_COUNT; id++) {
        let best = 0;
        for (let t = 0; t < wake_ms[id]; t += 100) {
            const f = frameOf({ ...S, back_mode: 0, clock_style: 0, kaia_anim: 1 }, { ...C, play: wake(1, id, 100, t) });
            best = Math.max(best, [...f].filter((v) => (v & 255) > 60).length);
        }
        assert.ok(best >= 10, "wake " + id + " lights " + best + " balls");
    }
});
