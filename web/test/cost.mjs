// The cost of one frame of an animation, read from the source: the integer divisions (the ESP8266 has no divider, so
// they dominate), the voice() and hash8() calls and the put() calls, with every loop multiplied by its bound and every
// helper the function calls counted in. Worst case: both sides of an if count. Not a test file: styles.test.mjs uses it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
// loop bounds by name; len (a spark path), nt (the mark's track) and w (a pictogram's width) at their largest
const CONST = { MX_LED_AMOUNT: 128, SPARKS: 18, SPARK_LEN: 12, len: 12, nt: 32, w: 11 };

// every top-level function of the drawing's modules: name → its body (comments out)
export function functions(files = ["lib8.js", "matrix.js", "kaia.js", "wakes.js", "looks.js", "styles.js"]) {
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
