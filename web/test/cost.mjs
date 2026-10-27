// The cost of one frame of an animation, read from the source: the integer divisions (the ESP8266 has no divider, so
// they dominate), the voice() and hash8() calls and the put() calls, with every loop multiplied by its bound and every
// helper the function calls counted in. Worst case: both sides of an if count. Not a test file: styles.test.mjs uses it.
// v1.9 adds styleDivs, the divisions a frame really runs (nature.test.mjs, games.test.mjs; `node test/cost.mjs --divs 4 5 …`
// prints them).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
// loop bounds by name; len (a spark path), nt (the mark's track) and w (a pictogram's width) at their largest; v1.9:
// m (the lights flies() draws), nm (embers()) and n (the blocks tetAt() looks at) at theirs
const CONST = { MX_LED_AMOUNT: 128, SPARKS: 18, SPARK_LEN: 12, len: 12, nt: 32, w: 11, m: 18, nm: 8, n: 12 };

// every top-level function of the drawing's modules: name → its body (comments out)
export function functions(files = ["lib8.js", "matrix.js", "kaia.js", "wakes.js", "looks.js", "styles.js", "nature.js", "games.js"]) {
    const fns = new Map();
    for (const f of files) {
        const text = readFileSync(join(src, f), "utf8").replace(/\r\n/g, "\n").replace(/\/\/[^\n]*/g, "");
        for (const m of text.matchAll(/^(?:export )?function (\w+)\(([^)]*)\) \{\n([\s\S]*?)\n\}$/gm)) fns.set(m[1], m[3]);
    }
    return fns;
}

// the iterations of a for header "let i = A; i < B; i++" (also <=, >= with --, += S)
function bound(h) {
    // "q2 < 4 && head - q2 >= 0": the first bound, at most that many
    const m = h.match(/let (\w+) = ([^;]+); \1 (<=|<|>=|>) ([^;&|]+?)(?: &&[^;]*)?; \1(\+\+|--|\s*[+-]= (\d+))/);
    if (!m) throw new Error("a loop the cost cannot read: for (" + h + ")");
    const num = (s) => (s.trim() in CONST ? CONST[s.trim()] : Number(s.trim()));
    // "let m = j; m <= j + 1": a window of fixed width over a variable start
    const w = m[4].trim().match(/^(\w+) \+ (\d+)$/);
    if (w && w[1] === m[2].trim()) return (m[3] === "<=" ? 1 : 0) + +w[2];
    const a = num(m[2]), b = num(m[4]), step = m[6] ? +m[6] : 1;
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("a loop bound the cost cannot read: for (" + h + ")");
    const span = m[3] === "<" ? b - a : m[3] === "<=" ? b - a + 1 : m[3] === ">=" ? a - b + 1 : a - b;
    return Math.max(0, Math.ceil(span / step));
}

const KEYS = ["div", "voice", "hash8", "put"];

// the cost of one call of fn: {div, voice, hash8, put}
export function costOf(fns, name, memo = new Map()) {
    if (memo.has(name)) return memo.get(name);
    const body = fns.get(name), c = { div: 0, voice: 0, hash8: 0, put: 0 };
    memo.set(name, c);
    if (!body) return c;
    const stack = [];  // {kind: "block" | "stmt", k}
    let k = 1, depth = 0, i = 0;
    const add = (o, n) => KEYS.forEach((key) => (c[key] += o[key] * n));
    while (i < body.length) {
        const rest = body.slice(i);
        let m;
        if ((m = rest.match(/^for \(([^)]*)\)\s*/))) {
            const n = bound(m[1]);
            i += m[0].length;
            if (body[i] === "{") {
                stack.push({ kind: "block", k });
                i++;
            } else stack.push({ kind: "stmt", k, depth });
            k *= n;
            continue;
        }
        const ch = body[i];
        if (ch === "{") stack.push({ kind: "block", k });
        else if (ch === "}") {
            const s = stack.pop();
            if (s) k = s.k;
            while (stack.length && stack[stack.length - 1].kind === "stmt" && stack[stack.length - 1].depth === depth) k = stack.pop().k;
        } else if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === ";") {
            while (stack.length && stack[stack.length - 1].kind === "stmt" && stack[stack.length - 1].depth === depth) k = stack.pop().k;
        } else if (ch === "/") c.div += k;
        else if ((m = rest.match(/^\b([A-Za-z_]\w*)\(/)) && (i === 0 || !/[\w.]/.test(body[i - 1]))) {
            const f = m[1];
            if (f === "voice" || f === "hash8" || f === "put") c[f] += k;
            if (fns.has(f) && f !== name) add(costOf(fns, f, memo), k);
            i += f.length;
            continue;
        }
        i++;
    }
    return c;
}

// v1.9: the divisions a frame really runs. The count above is a worst case: both sides of every if, every light of a
// loop on every ball. Catalog A skips the balls far from a light with a cheap |dx|, |dy| test before it divides, so
// that bound says little there. This one runs the frame under V8's block coverage and adds up every "/" of src/ (not a
// comment) times the count of the innermost block holding it: helpers, put() and its mix included. A child process
// measures, so that V8 compiles every drawing function with its block counters: a function compiled before the coverage
// starts only counts its calls.
const SRC = pathToFileURL(src).href + "/";
let session = null;
const slashes = new Map();  // url → the offsets of its division slashes

function divisionsIn(url) {
    if (slashes.has(url)) return slashes.get(url);
    const text = readFileSync(new URL(url), "utf8"), at = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== "/") continue;
        if (text[i + 1] === "/") {
            i = text.indexOf("\n", i);
            if (i < 0) break;
        } else if (text[i + 1] === "*") i = text.indexOf("*/", i) + 1;
        else at.push(i);
    }
    slashes.set(url, at);
    return at;
}

// the divisions run since the last call
async function taken() {
    const { result } = await session.post("Profiler.takePreciseCoverage");
    let n = 0;
    for (const sc of result) {
        if (!sc.url.startsWith(SRC)) continue;
        const ranges = sc.functions.flatMap((f) => f.ranges);
        for (const p of divisionsIn(sc.url)) {
            let best = null;
            for (const r of ranges) if (r.startOffset <= p && p < r.endOffset && (!best || r.endOffset - r.startOffset < best.endOffset - best.startOffset)) best = r;
            if (best) n += best.count;
        }
    }
    return n;
}

// the most divisions one frame of draw(t) runs, over the times ts
async function divsRun(draw, ts) {
    await taken();
    let most = 0;
    for (const t of ts) {
        draw(t);
        most = Math.max(most, await taken());
    }
    return most;
}

// the most divisions a frame of each style's 7 events runs over 2 s of frames (the states from t = 5 s), as
// {style: [wake, listening, thinking, speaking, done, error, notify]}
export function styleDivs(styles) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--divs", ...styles.map(String)], { encoding: "utf8" });
    if (r.status !== 0) throw new Error("cost.mjs --divs: " + r.stderr);
    return JSON.parse(r.stdout);
}

if (process.argv[2] === "--divs" && process.argv[1] === fileURLToPath(import.meta.url)) {
    session = new Session();
    session.connect();
    await session.post("Profiler.enable");
    await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
    const mod = (f) => import(SRC + f);
    const [K, { BallMatrix }, ST, WK] = await Promise.all([mod("kaia.js"), mod("matrix.js"), mod("styles.js"), mod("wakes.js")]);
    const m = new BallMatrix(), col = 0x00d1ff, ts = [...Array(40).keys()].map((k) => k * 50), out = {};
    const frame = (draw) => (t) => {
        m.clear();
        K.useMatrix(m);
        K.fr.sc = 255;
        K.fr.dg = 89;
        K.fr.hd = 0;
        draw(t);
    };
    for (const style of process.argv.slice(3).map(Number)) {
        const row = [await divsRun(frame((t) => ST.styleShot(style, K.A_WAKE, t, WK.wake_ms[WK.style_wake[style]], col)), ts)];
        for (const n of [K.A_LISTENING, K.A_THINKING, K.A_SPEAKING]) row.push(await divsRun(frame((t) => ST.styleState(style, n, t + 5000, col, 255)), ts));
        for (const n of [K.A_DONE, K.A_ERROR, K.A_NOTIFY]) row.push(await divsRun(frame((t) => ST.styleShot(style, n, t, ST.fam_ms[style - 4][n - K.A_DONE], col)), ts));
        out[style] = row;
    }
    process.stdout.write(JSON.stringify(out));
}
