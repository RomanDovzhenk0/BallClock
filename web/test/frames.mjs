// A fixed set of frames (three clocks, day and night, every event in the three styles at two moments), folded into one
// SHA-256: v1.6.2's drawing, to hold the Digit fade to "with kaia_hide 0 every frame is the same bit for bit".
// Not a test file: hide.test.mjs runs it on the renderer, and it was run once on the sources of v1.6.2 for GOLDEN.
import { createHash } from "node:crypto";

export function digestOf(frameOf, DEFAULTS, extra = {}) {
    const sets = [
        { back_mode: 2, back_pal: 13, clock_style: 1, clock_color: 0xffffff },
        { back_mode: 1, back_pal: 5, back_angle: 40, clock_style: 2, clock_color: 0x80ff00, clock_style_zero: 1 },
        { back_mode: 0, clock_style: 3, clock_color: 0xff8000 },
    ];
    const h = createHash("sha256");
    let n = 0;
    sets.forEach((set, k) => {
        for (const night of [false, true]) {
            for (const kaia_night of k ? [1] : [0, 1, 2]) {
                const S = { ...DEFAULTS, ...set, kaia_anim: 1 + k, kaia_night, ...extra };
                for (const anim of [0, 1, 2, 3, 4, 5, 6]) {
                    for (const style of [1, 2, 3]) {
                        for (const look of [0, 5]) {
                            for (const t of [250, 1100]) {
                                const c = { millis: 250000 + t, synced: k !== 2, hour: 9 + k, minute: 5 + t % 7, ms: (t * 3) % 1000, night, duck: t > 500 ? 255 : 140 };
                                const f = frameOf(S, { ...c, play: { anim, style, look, lk: 4, speed: 100, t, color: null } });
                                h.update(Buffer.from(f.buffer, f.byteOffset, f.byteLength));
                                n++;
                            }
                        }
                    }
                }
                h.update(Buffer.from(frameOf(S, { millis: 7777, synced: true, hour: 23, minute: 59, ms: 450, night, play: null, duck: 0 }).buffer));
                n++;
            }
        }
    });
    return { sha: h.digest("hex"), frames: n };
}

// Every id of v1.6 (styles 1–3, looks 0–8, wakes 0–14 at three speeds, the listening's look after a wake) at a few
// moments, folded into one SHA-256: v1.8 appends ids and must leave these frames as they were. Run once on the
// sources of v1.7 (main at a48d451) for styles.test.mjs.
export function idsDigestOf(frameOf, DEFAULTS) {
    const h = createHash("sha256");
    let n = 0;
    const add = (S, c) => {
        const f = frameOf(S, c);
        h.update(Buffer.from(f.buffer, f.byteOffset, f.byteLength));
        n++;
    };
    for (let style = 1; style <= 3; style++) {
        const S = { ...DEFAULTS, back_mode: 2, back_pal: 13, clock_style: 1, kaia_anim: style };
        const c = (t) => ({ millis: 250000 + t, synced: true, hour: 14, minute: 32, ms: t % 1000, night: false, duck: 255, hide: 40000 });
        for (const anim of [1, 2, 3, 4, 5, 6]) {
            for (let look = 0; look <= 8; look++) {
                for (const t of [120, 700, 1350, 5100]) add(S, { ...c(t), play: { anim, style, look, lk: 0, speed: 100, t, color: null, ms: 1e9 } });
            }
        }
        for (let wake = 0; wake <= 14; wake++) {
            for (const speed of [50, 100, 200]) {
                for (const lk of [0, 3, 6]) {
                    for (const t of [150, 900, 1700, 2600]) add(S, { ...c(t), play: { anim: 0, style, look: wake, lk, speed, t, color: null } });
                }
            }
        }
    }
    return { sha: h.digest("hex"), frames: n };
}

// Every id of v1.8 (styles 1–9, looks 0–14, wakes 0–20 at two speeds, the listening's look after a wake, an old one
// and a style's version) at a few moments, folded into one SHA-256: v1.9 appends ids through tables and must leave
// these frames as they were. Run once on the sources of v1.8 (main at 85c9f66) for nature.test.mjs.
export function v18DigestOf(frameOf, DEFAULTS) {
    const h = createHash("sha256");
    let n = 0;
    const add = (S, c) => {
        const f = frameOf(S, c);
        h.update(Buffer.from(f.buffer, f.byteOffset, f.byteLength));
        n++;
    };
    for (let style = 1; style <= 9; style++) {
        const S = { ...DEFAULTS, back_mode: 2, back_pal: 13, clock_style: 1, kaia_anim: style };
        const c = (t) => ({ millis: 250000 + t, synced: true, hour: 14, minute: 32, ms: t % 1000, night: false, duck: 255, hide: 40000 });
        for (const anim of [1, 2, 3, 4, 5, 6]) {
            for (let look = 0; look <= 14; look++) {
                for (const t of [120, 800, 1450]) add(S, { ...c(t), play: { anim, style, look, lk: 0, speed: 100, t, color: null, ms: 1e9 } });
            }
        }
        for (let wake = 0; wake <= 20; wake++) {
            for (const speed of [50, 150]) {
                for (const lk of [0, 12]) {
                    for (const t of [300, 1500, 2700]) add(S, { ...c(t), play: { anim: 0, style, look: wake, lk, speed, t, color: null } });
                }
            }
        }
    }
    return { sha: h.digest("hex"), frames: n };
}

// Every id of v1.9 part 1 (styles 1–12, looks 0–17, wakes 0–23 at two speeds, the listening's look after a wake, an old
// one and a style's version) at a few moments, folded into one SHA-256: part 2 appends ids through the same tables and
// must leave these frames as they were. Run once on the sources of part 1 (main at 2924f2c) for games.test.mjs.
export function v19aDigestOf(frameOf, DEFAULTS) {
    const h = createHash("sha256");
    let n = 0;
    const add = (S, c) => {
        const f = frameOf(S, c);
        h.update(Buffer.from(f.buffer, f.byteOffset, f.byteLength));
        n++;
    };
    for (let style = 1; style <= 12; style++) {
        const S = { ...DEFAULTS, back_mode: 2, back_pal: 13, clock_style: 1, kaia_anim: style };
        const c = (t) => ({ millis: 250000 + t, synced: true, hour: 14, minute: 32, ms: t % 1000, night: false, duck: 255, hide: 40000 });
        for (const anim of [1, 2, 3, 4, 5, 6]) {
            for (let look = 0; look <= 17; look++) {
                for (const t of [150, 1250]) add(S, { ...c(t), play: { anim, style, look, lk: 0, speed: 100, t, color: null, ms: 1e9 } });
            }
        }
        for (let wake = 0; wake <= 23; wake++) {
            for (const speed of [50, 150]) {
                for (const lk of [0, 16]) {
                    for (const t of [400, 2300]) add(S, { ...c(t), play: { anim: 0, style, look: wake, lk, speed, t, color: null } });
                }
            }
        }
    }
    return { sha: h.digest("hex"), frames: n };
}
