// The clock's time between two /kaia/state answers. Each answer gives its local time as text (whole seconds)
// and ms = millis() when it was made. NTP's second starts at millis ≡ φ (mod 1000), unknown at first:
// every answer rules out the φ that would have put it in another second, so the dots come into step.

const STEP = 5;  // φ candidates every 5 ms

export function parseTime(text) {
    const m = /(\d{1,2}):(\d{2}):(\d{2})/.exec(text || "");
    return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

export class ClockSync {
    constructor() {
        this.ref = null;  // the first answer of the run: {sec, ms}
        this.last = null;
        this.cand = null;
    }

    // sec: seconds since midnight in the answer; ms: its millis
    add(sec, ms) {
        if (this.last && ms < this.last.ms) this.ref = null;  // the clock rebooted
        if (!this.ref) {
            this.ref = { sec, ms };
            this.cand = [];
            for (let p = 0; p < 1000; p += STEP) this.cand.push(p);
        } else {
            const want = (((sec - this.ref.sec) % 86400) + 86400) % 86400;
            const keep = this.cand.filter((p) => Math.floor((ms - p) / 1000) - Math.floor((this.ref.ms - p) / 1000) === want);
            if (keep.length) this.cand = keep;
            else this.reset(sec, ms);  // NTP stepped: start over from this answer
        }
        this.last = { sec, ms };
    }

    reset(sec, ms) {
        this.ref = null;
        this.add(sec, ms);
    }

    // the middle of the φ still possible (the arc opposite the widest gap)
    phase() {
        const c = this.cand;
        if (!c || !c.length || c.length * STEP >= 1000) return 0;
        let gap = 0, at = 0;
        for (let k = 0; k < c.length; k++) {
            const next = k + 1 < c.length ? c[k + 1] : c[0] + 1000, g = next - c[k];
            if (g > gap) gap = g, at = k + 1;
        }
        const start = c[at % c.length], span = 1000 - gap + STEP;
        return Math.round(start + span / 2 - STEP / 2) % 1000;
    }

    // how sure: the width of the φ window, ms
    spread() {
        return this.cand ? Math.min(1000, this.cand.length * STEP) : 1000;
    }

    // the clock's time at its millis()
    at(millis) {
        if (!this.last) return { hour: 0, minute: 0, second: 0, ms: 0 };
        const p = this.phase();
        const d = Math.floor((millis - p) / 1000) - Math.floor((this.last.ms - p) / 1000);
        const s = ((this.last.sec + d) % 86400 + 86400) % 86400;
        return { hour: (s / 3600) | 0, minute: ((s % 3600) / 60) | 0, second: s % 60, ms: (((millis - p) % 1000) + 1000) % 1000 };
    }
}
