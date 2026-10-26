// The canvas layer: the 128 balls on the real layout (matrix.cpp diagToLed), glossy ping-pong balls on the
// hexagon plate. The unlit balls and the gloss are drawn once per size; a frame adds only the light.
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
    if (!v.base) {
        v.base = layer(L, (c) => {
            plate(c, L);
            if (v.simple) return;
            for (let i = 0; i < MX_LED_AMOUNT; i++) {
                const x = L.X(ballX[i]), y = L.Y(ballY[i]);
                const g = c.createRadialGradient(x - 0.28 * r, y - 0.32 * r, r * 0.1, x, y, r);
                g.addColorStop(0, "#4a4c54");
                g.addColorStop(1, "#16171b");
                c.fillStyle = g;
                c.beginPath();
                c.arc(x, y, r, 0, 6.2832);
                c.fill();
            }
        });
        v.gloss = v.simple ? null : layer(L, (c) => {
            c.fillStyle = "rgba(255,255,255,.2)";
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
    const c = v.ctx, L = v.L, r = caches(v);
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
        if (v.simple) {
            c.fillStyle = "rgb(" + Math.min(255, 32 + R * 0.95 | 0) + "," + Math.min(255, 34 + G * 0.95 | 0) + "," + Math.min(255, 38 + B * 0.95 | 0) + ")";
            c.beginPath();
            c.arc(x, y, r, 0, 6.2832);
            c.fill();
            continue;
        }
        const l = Math.max(R, G, B) / 255;
        if (l <= 0.012) continue;
        c.globalCompositeOperation = "lighter";
        const wr = R + (255 - R) * 0.22 * l | 0, wg = G + (255 - G) * 0.22 * l | 0, wb = B + (255 - B) * 0.22 * l | 0, rgb = R + "," + G + "," + B;
        let g = c.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(" + wr + "," + wg + "," + wb + ",.95)");
        g.addColorStop(0.7, "rgba(" + rgb + ",.78)");
        g.addColorStop(1, "rgba(" + rgb + ",.42)");
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, r, 0, 6.2832);
        c.fill();
        g = c.createRadialGradient(x, y, r * 0.6, x, y, r * 1.9);
        g.addColorStop(0, "rgba(" + rgb + "," + (0.3 * l).toFixed(3) + ")");
        g.addColorStop(1, "rgba(" + rgb + ",0)");
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, r * 1.9, 0, 6.2832);
        c.fill();
        c.globalCompositeOperation = "source-over";
    }
    if (v.gloss) c.drawImage(v.gloss, 0, 0, L.W, L.H);
    c.restore();
}
