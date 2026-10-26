// The canvas layer: the 128 balls on the real layout (matrix.cpp diagToLed), glossy ivory ping-pong balls on the
// hexagon plate. The unlit balls and the gloss are drawn once per size and unlit setting; a frame adds only the light.
import { ledDiag, MX_DIAG_H, MX_DIAG_W, MX_LED_AMOUNT } from "./matrix.js";

const D = 39.9, S3 = Math.sqrt(3) / 2;
const ballX = new Float32Array(MX_LED_AMOUNT), ballY = new Float32Array(MX_LED_AMOUNT);
for (let y = 0; y < MX_DIAG_H; y++) {
    for (let x = 0; x < MX_DIAG_W; x++) {
        const i = ledDiag(x, y);
        if (i < 0) continue;
        ballX[i] = ((2 * x + 3 - y) * D) / 2;
        ballY[i] = y * S3 * D;
    }
}
// an unlit ball is ivory plastic (its shade darkens toward the rim); an LED inside makes the disc glow with its own hue
export const IVORY = 0xc8c3b4;

// the unlit balls' colour and transparency (0–100 %): only this page's look, kept in this browser, never sent to the
// clock. v bumps on a change, so the cached layers are drawn again.
export const UNLIT_KEY = "ballclock.unlit";
export const unlit = { c: IVORY, tr: 0, v: 0 };

// the stored setting, or v1.5.2's ivory, opaque
export function readUnlit(store) {
    try {
        const j = JSON.parse(store.getItem(UNLIT_KEY) || "null");
        if (j && /^#[0-9a-f]{6}$/i.test(j.c) && j.tr >= 0 && j.tr <= 100) return { c: parseInt(j.c.slice(1), 16), tr: Math.round(j.tr) };
    } catch {
        // no storage, or something else under the key
    }
    return { c: IVORY, tr: 0 };
}

// use u = {c, tr}; with a store, keep it there (the default as nothing)
export function setUnlit(u, store) {
    unlit.c = u.c;
    unlit.tr = u.tr;
    unlit.v++;
    if (!store) return;
    try {
        if (u.c === IVORY && !u.tr) store.removeItem(UNLIT_KEY);
        else store.setItem(UNLIT_KEY, JSON.stringify({ c: "#" + u.c.toString(16).padStart(6, "0"), tr: u.tr }));
    } catch {
        // private mode: the setting lives only in this tab
    }
}

const rgbOf = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const css = (a) => "rgb(" + a.map((x) => Math.round(x)).join(",") + ")";
const CX = (19 * D) / 2, CY = 3 * S3 * D;
const R_ = D / 2 + 0.12 * D, TIP = -1.1547 * R_, HX = 0.5774 * (CY + R_);
const X0 = TIP - 0.45 * D, X1 = 2 * CX - TIP + 0.45 * D, Y0 = -R_ - 0.45 * D, Y1 = 2 * CY + R_ + 0.45 * D;
const PLATE = [[TIP, CY], [TIP + HX, -R_], [2 * CX - TIP - HX, -R_], [2 * CX - TIP, CY], [2 * CX - TIP - HX, 2 * CY + R_], [TIP + HX, 2 * CY + R_]];

// the CSS size of a preview W px wide
export function layout(W) {
    const s = W / (X1 - X0);
    return { W, s, H: Math.ceil((Y1 - Y0) * s), X: (x) => (x - X0) * s, Y: (y) => (y - Y0) * s };
}

const dpr = () => Math.min(2, window.devicePixelRatio || 1);

// size a canvas for W css px; returns its context and layout
export function fitCanvas(cv, W) {
    const L = layout(W), k = dpr();
    cv.style.width = W + "px";
    cv.style.height = L.H + "px";
    cv.width = Math.round(W * k);
    cv.height = Math.round(L.H * k);
    const ctx = cv.getContext("2d");
    ctx.setTransform(k, 0, 0, k, 0, 0);
    return { cv, ctx, L, base: null, gloss: null, simple: W < 200 };
}

function layer(L, draw) {
    const k = dpr(), c = document.createElement("canvas");
    c.width = Math.round(L.W * k);
    c.height = Math.round(L.H * k);
    const x = c.getContext("2d");
    x.setTransform(k, 0, 0, k, 0, 0);
    draw(x);
    return c;
}

function plate(c, L) {
    c.beginPath();
    PLATE.forEach((p, k) => (k ? c.lineTo(L.X(p[0]), L.Y(p[1])) : c.moveTo(L.X(p[0]), L.Y(p[1]))));
    c.closePath();
    c.fillStyle = "#0a0b0e";
    c.fill();
    c.lineJoin = "round";
    c.lineWidth = Math.max(1, L.s * 3);
    c.strokeStyle = "#2a2d34";
    c.stroke();
}

function caches(v) {
    const L = v.L, r = (D / 2) * L.s * 0.93;
    if (!v.base || v.uv !== unlit.v) {
        v.uv = unlit.v;
        // the ivory of v1.5.2 as it was; another colour: lighter at the highlight, darker at the rim
        const u = rgbOf(unlit.c), al = 1 - unlit.tr / 100;
        const st = unlit.c === IVORY ? ["#ebe6d6", "#c8c3b1", "#6f6b5d"] : [css(u.map((x) => x + (255 - x) * 0.6)), css(u), css(u.map((x) => x * 0.55))];
        v.base = layer(L, (c) => {
            plate(c, L);
            if (v.simple) return;
            c.globalAlpha = al;
            for (let i = 0; i < MX_LED_AMOUNT; i++) {
                const x = L.X(ballX[i]), y = L.Y(ballY[i]);
                const g = c.createRadialGradient(x - 0.28 * r, y - 0.32 * r, r * 0.1, x, y, r);
                g.addColorStop(0, st[0]);
                g.addColorStop(0.55, st[1]);
                g.addColorStop(1, st[2]);
                c.fillStyle = g;
                c.beginPath();
                c.arc(x, y, r, 0, 6.2832);
                c.fill();
            }
        });
        v.gloss = v.simple ? null : layer(L, (c) => {
            c.fillStyle = "rgba(255,255,255," + (0.38 * (0.3 + 0.7 * al)).toFixed(3) + ")";
            for (let i = 0; i < MX_LED_AMOUNT; i++) {
                const x = L.X(ballX[i]), y = L.Y(ballY[i]);
                c.beginPath();
                c.ellipse(x - 0.32 * r, y - 0.38 * r, 0.27 * r, 0.17 * r, -0.6, 0, 6.2832);
                c.fill();
            }
        });
    }
    return r;
}

// leds: 0xRRGGBB per LED as drawn; gain: how the brightness shows (0.3 + 0.7·bright/255); dim: an extra factor
export function paint(v, leds, gain, clip) {
    const c = v.ctx, L = v.L, r = caches(v), u = rgbOf(unlit.c), al = 1 - unlit.tr / 100;
    c.save();
    if (clip) {
        c.beginPath();
        c.rect(clip[0], 0, clip[1] - clip[0], L.H);
        c.clip();
    }
    c.clearRect(0, 0, L.W, L.H);
    c.drawImage(v.base, 0, 0, L.W, L.H);
    for (let i = 0; i < MX_LED_AMOUNT; i++) {
        const col = leds[i], x = L.X(ballX[i]), y = L.Y(ballY[i]);
        const R = Math.min(255, ((col >> 16) & 255) * gain) | 0, G = Math.min(255, ((col >> 8) & 255) * gain) | 0, B = Math.min(255, (col & 255) * gain) | 0;
        const m = Math.max(R, G, B), l = m / 255;
        if (v.simple) {
            const a = l <= 0.012 ? 0 : 0.3 + 0.7 * Math.sqrt(l), k = m ? 255 / m : 0;
            c.fillStyle = "rgba(" + (u[0] + (R * k - u[0]) * a | 0) + "," + (u[1] + (G * k - u[1]) * a | 0) + "," + (u[2] + (B * k - u[2]) * a | 0) + "," + (al + (1 - al) * a).toFixed(3) + ")";
            c.beginPath();
            c.arc(x, y, r, 0, 6.2832);
            c.fill();
            continue;
        }
        if (l <= 0.012) continue;
        // the hue at full strength, shown with a coverage that follows the brightness: a dim LED still tints the ivory
        const k = 255 / m, nr = R * k | 0, ng = G * k | 0, nb = B * k | 0, a = 0.3 + 0.7 * Math.sqrt(l);
        const wr = nr + (255 - nr) * 0.3 * l | 0, wg = ng + (255 - ng) * 0.3 * l | 0, wb = nb + (255 - nb) * 0.3 * l | 0, rgb = nr + "," + ng + "," + nb;
        let g = c.createRadialGradient(x, y, r * 1.0, x, y, r * 1.8);
        g.addColorStop(0, "rgba(" + rgb + "," + (0.26 * a * l).toFixed(3) + ")");
        g.addColorStop(1, "rgba(" + rgb + ",0)");
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, r * 1.8, 0, 6.2832);
        c.fill();
        g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(" + wr + "," + wg + "," + wb + "," + (0.96 * a).toFixed(3) + ")");
        g.addColorStop(0.7, "rgba(" + rgb + "," + (0.88 * a).toFixed(3) + ")");
        g.addColorStop(1, "rgba(" + rgb + "," + (0.66 * a).toFixed(3) + ")");
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, r, 0, 6.2832);
        c.fill();
    }
    if (v.gloss) c.drawImage(v.gloss, 0, 0, L.W, L.H);
    c.restore();
}
