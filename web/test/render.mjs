// npm run test:render: dist/site.html?mock in headless Edge over CDP (Node's global WebSocket), at 390×844 and
// 1280×800, in the page's states. Shots go to web/shots/ (git-ignored). In each state an in-page check looks for
// anything wider than the viewport, overlapping controls, cut text and (on the phone) touch targets under 44 px;
// every request the page makes must stay on the page itself.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), web = resolve(here, "..");
const EDGE = process.env.EDGE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const page = join(web, "dist", "site.html"), shots = join(web, "shots");
const only = process.argv.slice(2);

if (!existsSync(page)) throw new Error("no dist/site.html: npm run build first");
const newest = (d) => readdirSync(d).reduce((t, n) => Math.max(t, statSync(join(d, n)).mtimeMs), 0);
if (newest(join(web, "src")) > statSync(page).mtimeMs) throw new Error("dist/site.html is older than src/: npm run build first");
mkdirSync(shots, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
    const profile = mkdtempSync(join(tmpdir(), "ballclock-edge-"));
    const proc = spawn(EDGE, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
    const portFile = join(profile, "DevToolsActivePort");
    for (let k = 0; k < 150 && !existsSync(portFile); k++) await sleep(100);
    for (let k = 0; k < 50; k++) {
        const t = existsSync(portFile) ? readFileSync(portFile, "utf8").split("\n") : [];
        if (t.length >= 2 && t[1].trim()) return { proc, profile, ws: "ws://127.0.0.1:" + t[0].trim() + t[1].trim() };
        await sleep(100);
    }
    proc.kill();
    throw new Error("Edge did not open its debug port");
}

function cdp(url) {
    const ws = new WebSocket(url);
    let id = 0;
    const wait = new Map(), handlers = [];
    ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id && wait.has(m.id)) {
            const w = wait.get(m.id);
            wait.delete(m.id);
            m.error ? w.no(new Error(m.error.message)) : w.ok(m.result);
        } else if (m.method) handlers.forEach((h) => h(m));
    };
    const open = new Promise((ok, no) => {
        ws.onopen = ok;
        ws.onerror = () => no(new Error("CDP socket"));
    });
    return {
        open,
        on: (h) => handlers.push(h),
        send: (method, params = {}, sessionId) => new Promise((ok, no) => {
            const n = ++id;
            wait.set(n, { ok, no });
            ws.send(JSON.stringify({ id: n, method, params, sessionId }));
        }),
        close: () => ws.close(),
    };
}

// the in-page check, as a string: it runs in the page
const CHECK = String.raw`(() => {
  const W = innerWidth, out = [], phone = W < 600;
  const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && !e.closest("[hidden]"); };
  const name = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).join(".") : "") + (e.textContent ? " «" + e.textContent.trim().slice(0, 24) + "»" : "");
  const scroller = (e) => { for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") return p; } return null; };
  if (document.documentElement.scrollWidth > W + 1) out.push("page scrolls sideways: " + document.documentElement.scrollWidth + " > " + W);
  for (const e of document.querySelectorAll("body *")) {
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect();
    if ((r.right > W + 1 || r.left < -1) && !scroller(e)) out.push("wider than the viewport: " + name(e) + " " + Math.round(r.left) + ".." + Math.round(r.right));
  }
  // cut text: a text box narrower than its text
  for (const e of document.querySelectorAll("body *")) {
    if (!vis(e) || e.closest(".tabs,#mk,.ksg") || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(e);
    if (s.overflow === "visible" && s.overflowX === "visible" && s.textOverflow !== "ellipsis") continue;
    const rg = document.createRange(); rg.selectNodeContents(e);
    const tw = rg.getBoundingClientRect().width, bw = e.getBoundingClientRect().width;
    if (tw > bw + 0.3 || e.scrollWidth > e.clientWidth + 1) out.push("cut text: " + name(e) + " " + Math.round(tw) + " in " + Math.round(bw));
  }
  // overlapping controls in the same layer (the fixed bars float over the page by design)
  const layer = (e) => (e.closest(".sbar,.tabs,.mini,.modal,.toast,.pop,.kb.open .evd,.hero") || document.body);
  const ctl = [...document.querySelectorAll("button,input,select,a,label.sw,summary")].filter((e) => vis(e) && !(e.tagName === "INPUT" && e.closest("label.sw")));
  for (let i = 0; i < ctl.length; i++) for (let j = i + 1; j < ctl.length; j++) {
    const a = ctl[i], b = ctl[j];
    if (a.contains(b) || b.contains(a) || layer(a) !== layer(b)) continue;
    // what shows of each: a control scrolled out of its strip (the chips beside «▶ На часах») is clipped by it
    const shown = (e) => { const r = e.getBoundingClientRect(), sc = scroller(e); if (!sc) return r; const c = sc.getBoundingClientRect(); return { left: Math.max(r.left, c.left), right: Math.min(r.right, c.right), top: Math.max(r.top, c.top), bottom: Math.min(r.bottom, c.bottom) }; };
    const p = shown(a), q = shown(b);
    const w = Math.min(p.right, q.right) - Math.max(p.left, q.left), h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
    if (w > 1 && h > 1) {
      const sa = scroller(a), sb = scroller(b);
      if (sa && sa === sb) { const c = sa.getBoundingClientRect(); if (Math.max(p.left, q.left) >= c.right || Math.min(p.right, q.right) <= c.left) continue; }
      out.push("overlap: " + name(a) + " / " + name(b));
    }
  }
  if (phone) for (const e of ctl) {
    if (e.closest("#mockbar") || e.closest(".modal") && e.tagName === "P") continue;
    const r = e.getBoundingClientRect(), sc = scroller(e);
    if (sc) { const c = sc.getBoundingClientRect(); if (r.left >= c.right || r.right <= c.left) continue; }
    if (r.height < 43.5 || r.width < 43.5) out.push("touch target " + Math.round(r.width) + "×" + Math.round(r.height) + ": " + name(e));
  }
  return [...new Set(out)];
})()`;

const STATES = [
    { name: "kaia", go: "" },
    { name: "kaia-full", go: "", full: true },
    { name: "compare", go: "ballclock.setSrc('cmp')" },
    { name: "now-mirror", go: "ballclock.setSrc('now'); ballclock.setLive('mirror')", wait: 1500 },
    { name: "look", go: "ballclock.showTab('look')" },
    { name: "light", go: "ballclock.showTab('light')" },
    { name: "net", go: "ballclock.showTab('net')" },
    { name: "sys", go: "ballclock.showTab('sys')" },
    { name: "draft", go: "document.querySelector('[data-tc=\"0:8\"]').click(); document.querySelector('[data-sp=\"150\"]').click()", wait: 900 },
    { name: "password", go: "document.querySelector('[data-m=auth]').click()", wait: 900 },
    { name: "offline", go: "document.querySelector('[data-m=offline]').click()", wait: 1500 },
    { name: "access-point", go: "document.querySelector('[data-m=ap]').click()", wait: 900 },
    { name: "update", go: "document.querySelector('[data-m=upd]').click()", wait: 900 },
    { name: "text", go: "document.querySelector('[data-m=text]').click(); ballclock.setSrc('now')", wait: 1500 },
    { name: "reduced-motion", go: "", rm: true },
    { name: "tiles", go: "ballclock.setEvent(0, true); ballclock.tilesAt(600)", wait: 350, el: ".wg", desk: true },
    // the palette picker: a tap and a step put the palette in the draft and on the preview
    { name: "picker", go: "ballclock.showTab('look'); document.querySelector('[data-pick=\"52\"]').click()", wait: 500, el: "[data-f=back_pal]",
        expect: "ballclock.S().back_pal === 52 && document.getElementById('pcn').textContent === 'Неон' && /На часах: Океан/.test(document.getElementById('pcs').textContent)" },
    { name: "picker-step", go: "ballclock.showTab('look'); document.querySelector('[data-pstep=\"1\"]').click(); document.querySelector('[data-pstep=\"1\"]').click()", wait: 500,
        expect: "ballclock.S().back_pal === 38 && document.querySelector('.pc.sel').dataset.pick === '38'" },
    // each event's gallery: beside the list on the desktop, a sheet under the preview on the phone
    ...["wake", "listening", "thinking", "speaking", "done", "error", "notify"].map((e, n) => ({ name: "gallery-" + e, go: "ballclock.setEvent(" + n + ", true)", wait: 900, el: "#kb", desk: true,
        expect: "document.querySelectorAll('#evg .tile').length === " + (n ? 9 : 15) + " && document.querySelector('.er.on').dataset.ev === '" + n + "' && document.querySelector('[data-ks=\"" + n + "\"]').classList.contains('on')" })),
    // the phone: the preview stays in view while a palette or an animation is picked
    { name: "phone-preview", go: "ballclock.showTab('look'); document.querySelector('.brows').scrollIntoView(); document.querySelector('[data-pick=\"45\"]').click()", wait: 700,
        expect: "innerWidth > 900 || (() => { const h = document.getElementById('hero').getBoundingClientRect(); return h.top > -2 && h.bottom > 200; })()" },
    // the unlit balls at transparency 0, 50 and 100 % over a draft without background: kept in localStorage, never sent
    // to the clock (reset after the shot)
    { name: "unlit-0", go: "const sel = document.querySelector('[data-k=back_mode]'); sel.value = 0; sel.dispatchEvent(new Event('input', { bubbles: true })); ballclock.setU(0x4a4d55, 0); ballclock.play('off')", wait: 400, after: "ballclock.setU(0xc8c3b4, 0)",
        expect: "localStorage.getItem('ballclock.unlit') === '{\"c\":\"#4a4d55\",\"tr\":0}'" },
    { name: "unlit-50", go: "const sel = document.querySelector('[data-k=back_mode]'); sel.value = 0; sel.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('gear').click(); ballclock.setU(0xdfe6ee, 50); ballclock.play('off')", wait: 600, after: "ballclock.setU(0xc8c3b4, 0)",
        expect: "!document.getElementById('pop').hidden && document.getElementById('utro').textContent === '50 %' && JSON.parse(localStorage.getItem('ballclock.unlit')).tr === 50" },
    { name: "unlit-100", go: "const sel = document.querySelector('[data-k=back_mode]'); sel.value = 0; sel.dispatchEvent(new Event('input', { bubbles: true })); ballclock.setU(0xc8c3b4, 100); ballclock.play('off')", wait: 400, after: "ballclock.setU(0xc8c3b4, 0)",
        expect: "JSON.parse(localStorage.getItem('ballclock.unlit')).tr === 100 && !ballclock.mock.M.settings.unlit" },
    // 20 frames a second with the CPU 4× slower, a wake on the big preview and the gallery in view
    { name: "fps", go: "ballclock.setEvent(0, true); document.querySelector('.wg').scrollIntoView(); ballclock.play('wake'); window.__f0 = ballclock.P.frames; setTimeout(() => (window.__fps = (ballclock.P.frames - window.__f0) / 3), 3000)", wait: 3300, cpu: 4,
        expect: "window.__fps >= 18 || (console.log('fps ' + window.__fps), false)", report: "window.__fps" },
    // the flows: what the mock clock got
    { name: "saved", go: "document.querySelector('[data-tc=\"0:6\"]').click(); document.querySelector('[data-sp=\"200\"]').click(); ballclock.setEvent(4, false); document.querySelector('[data-tc=\"4:7\"]').click(); setTimeout(() => document.getElementById('sbsave').click(), 300)", wait: 2500,
        expect: "ballclock.mock.M.settings.kaia_wake === 6 && ballclock.mock.M.settings.kaia_wake_speed === 200 && ballclock.mock.M.settings.kaia_done === 7 && document.getElementById('sbar').hidden" },
    // the try-out for every kind: a wake with its speed, a state for 6 s, a one-shot; nothing saved
    { name: "try-out", go: "ballclock.setEvent(0, true); document.querySelector('[data-tc=\"0:13\"]').click(); document.querySelector('.gfoot [data-act=onclock]').click()", wait: 900,
        expect: "ballclock.mock.M.play && ballclock.mock.M.play.look === 13 && ballclock.mock.M.play.speed === 100 && ballclock.mock.M.settings.kaia_wake === 0 && /Идёт на часах: Пробуждение · 13 Зайчик/.test(document.querySelector('.gfoot .cl-st').textContent)" },
    { name: "try-out-state", go: "ballclock.setEvent(1, true); document.querySelector('[data-tc=\"1:5\"]').click(); document.querySelector('.gfoot [data-act=onclock]').click()", wait: 900,
        expect: "ballclock.mock.M.play && ballclock.mock.M.play.anim === 1 && ballclock.mock.M.play.look === 5 && ballclock.mock.M.play.ms === 6000 && ballclock.mock.M.settings.kaia_listen === 0" },
    { name: "try-out-shot", go: "ballclock.setEvent(4, false); document.querySelector('[data-tc=\"4:6\"]').click(); document.querySelector('.pvf [data-act=onclock]').click()", wait: 700,
        expect: "ballclock.mock.M.play && ballclock.mock.M.play.anim === 4 && ballclock.mock.M.play.look === 6 && ballclock.mock.M.settings.kaia_done === 0 && ballclock.LIVE.play && ballclock.LIVE.play.look === 6" },
    { name: "login", go: "document.querySelector('[data-m=auth]').click(); setTimeout(() => { document.getElementById('lp').value = 'kaia'; document.getElementById('lg').click(); }, 900)", wait: 2200,
        expect: "ballclock.P.conn === 'ok' && document.getElementById('modal').hidden && !document.getElementById('logout').hidden" },
];
const SIZES = [{ w: 390, h: 844, phone: true }, { w: 1280, h: 800 }];

const edge = await launch();
const c = cdp(edge.ws);
await c.open;
let bad = 0;
const external = new Set();
try {
    const { targetId } = await c.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await c.send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m, p) => c.send(m, p, sessionId);
    c.on((m) => {
        if (m.method === "Network.requestWillBeSent" && !/^(file|data|about|blob):/.test(m.params.request.url)) external.add(m.params.request.url);
        if (m.method === "Runtime.exceptionThrown") {
            console.log("page error: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
            bad++;
        }
    });
    await s("Page.enable");
    await s("Runtime.enable");
    await s("Network.enable");
    const url = pathToFileURL(page).href + "?mock";
    for (const size of SIZES) {
        for (const st of STATES) {
            if (only.length && !only.includes(st.name)) continue;
            await s("Emulation.setDeviceMetricsOverride", { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: !!size.phone });
            await s("Emulation.setTouchEmulationEnabled", { enabled: !!size.phone });
            await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: st.rm ? "reduce" : "no-preference" }] });
            await s("Page.navigate", { url });
            await sleep(1400);
            await s("Emulation.setCPUThrottlingRate", { rate: st.cpu || 1 });
            if (st.go) await s("Runtime.evaluate", { expression: st.go });
            await sleep(st.wait || 700);
            const r = await s("Runtime.evaluate", { expression: CHECK, returnByValue: true });
            const issues = r.result.value || [];
            if (st.report) console.log("  " + st.name + ": " + JSON.stringify((await s("Runtime.evaluate", { expression: st.report, returnByValue: true })).result.value));
            if (st.expect && (await s("Runtime.evaluate", { expression: st.expect, returnByValue: true })).result.value !== true) issues.push("the flow did not reach: " + st.expect);
            const tag = size.w + "-" + st.name;
            if (issues.length) {
                bad += issues.length;
                console.log("✖ " + tag + "\n   " + issues.join("\n   "));
            } else console.log("✔ " + tag);
            let clip;
            if (st.full) {
                // a tall viewport, not captureBeyondViewport: Edge swaps red and blue of small canvases in those shots
                const m = await s("Page.getLayoutMetrics");
                await s("Emulation.setDeviceMetricsOverride", { width: size.w, height: Math.min(6000, Math.ceil(m.cssContentSize.height)), deviceScaleFactor: 1, mobile: !!size.phone });
                await sleep(900);
            }
            if (st.el && !(st.desk && size.phone)) {
                const b = await s("Runtime.evaluate", { expression: "(() => { const e = document.querySelector('" + st.el + "'); const top = innerWidth > 900 ? 120 : 0; scrollTo(0, e.getBoundingClientRect().top + scrollY - top); const r = e.getBoundingClientRect(); return [r.x + scrollX, r.y + scrollY, r.width, Math.min(r.height, innerHeight - top)]; })()", returnByValue: true });
                const [x, y, w, h] = b.result.value;
                clip = { x, y, width: w, height: h, scale: 2 };
            }
            const shot = await s("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip });
            writeFileSync(join(shots, tag + ".png"), Buffer.from(shot.data, "base64"));
            if (st.after) await s("Runtime.evaluate", { expression: st.after });
        }
    }
    await c.send("Browser.close");
} finally {
    c.close();
    await sleep(500);
    try {
        rmSync(edge.profile, { recursive: true, force: true });
    } catch {
        // Edge may still hold its profile for a moment
    }
}
for (const u of external) console.log("✖ a request off the page: " + u);
bad += external.size;
console.log(bad ? bad + " issue(s); shots in web/shots/" : "clean; shots in web/shots/");
process.exit(bad ? 1 : 0);
