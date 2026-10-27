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
