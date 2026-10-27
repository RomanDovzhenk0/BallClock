// firmware/src/matrix.cpp + matrix.h (BallMatrix) and the parts of GyverGFX-dev it draws with:
// the colour (setColor24 → rgb888to565, getColor24 / getColor24full), the cursor and print() of a map font.
// The strip keeps the colours as drawn: NeoPixel's setBrightness belongs to the output, not to the frame.

export const MX_LED_AMOUNT = 128, MX_XY_W = 39, MX_XY_H = 13, MX_DIAG_W = 20, MX_DIAG_H = 7;

// BallClock Generator
export const xyToLed = [
    [0, 0, 0, 13, 0, 14, 0, 27, 0, 28, 0, 41, 0, 42, 0, 55, 0, 56, 0, 69, 0, 70, 0, 83, 0, 84, 0, 97, 0, 98, 0, 111, 0, 112, 0, 125, 0, 0, 0],
    [0, 0, 2, 0, 12, 0, 15, 0, 26, 0, 29, 0, 40, 0, 43, 0, 54, 0, 57, 0, 68, 0, 71, 0, 82, 0, 85, 0, 96, 0, 99, 0, 110, 0, 113, 0, 124, 0, 0],
    [0, 3, 0, 11, 0, 16, 0, 25, 0, 30, 0, 39, 0, 44, 0, 53, 0, 58, 0, 67, 0, 72, 0, 81, 0, 86, 0, 95, 0, 100, 0, 109, 0, 114, 0, 123, 0, 126, 0],
    [1, 0, 4, 0, 10, 0, 17, 0, 24, 0, 31, 0, 38, 0, 45, 0, 52, 0, 59, 0, 66, 0, 73, 0, 80, 0, 87, 0, 94, 0, 101, 0, 108, 0, 115, 0, 122, 0, 127],
    [0, 5, 0, 9, 0, 18, 0, 23, 0, 32, 0, 37, 0, 46, 0, 51, 0, 60, 0, 65, 0, 74, 0, 79, 0, 88, 0, 93, 0, 102, 0, 107, 0, 116, 0, 121, 0, 128, 0],
    [0, 0, 6, 0, 8, 0, 19, 0, 22, 0, 33, 0, 36, 0, 47, 0, 50, 0, 61, 0, 64, 0, 75, 0, 78, 0, 89, 0, 92, 0, 103, 0, 106, 0, 117, 0, 120, 0, 0],
    [0, 0, 0, 7, 0, 20, 0, 21, 0, 34, 0, 35, 0, 48, 0, 49, 0, 62, 0, 63, 0, 76, 0, 77, 0, 90, 0, 91, 0, 104, 0, 105, 0, 118, 0, 119, 0, 0, 0],
];

export const diagToLed = [
    [13, 14, 27, 28, 41, 42, 55, 56, 69, 70, 83, 84, 97, 98, 111, 112, 125, 0, 0, 0],
    [2, 12, 15, 26, 29, 40, 43, 54, 57, 68, 71, 82, 85, 96, 99, 110, 113, 124, 0, 0],
    [3, 11, 16, 25, 30, 39, 44, 53, 58, 67, 72, 81, 86, 95, 100, 109, 114, 123, 126, 0],
    [1, 4, 10, 17, 24, 31, 38, 45, 52, 59, 66, 73, 80, 87, 94, 101, 108, 115, 122, 127],
    [0, 5, 9, 18, 23, 32, 37, 46, 51, 60, 65, 74, 79, 88, 93, 102, 107, 116, 121, 128],
    [0, 0, 6, 8, 19, 22, 33, 36, 47, 50, 61, 64, 75, 78, 89, 92, 103, 106, 117, 120],
    [0, 0, 0, 7, 20, 21, 34, 35, 48, 49, 62, 63, 76, 77, 90, 91, 104, 105, 118, 119],
];

export function ledXY(x, y) {
    if (x < 0 || y < 0 || x >= MX_XY_W || y >= MX_XY_H) return -1;
    return ((y & 1) ? 0 : xyToLed[y >> 1][x]) - 1;
}

export function ledDiag(x, y) {
    if (x < 0 || y < 0 || x >= MX_DIAG_W || y >= MX_DIAG_H) return -1;
    return diagToLed[y][x] - 1;
}

// GyverGFX core/utils.cpp (the 0xff alpha byte they add is dropped: the RGB strip ignores it)
export const rgb888to565 = (col) => ((col >>> 8) & 0xf800) | ((col >>> 5) & 0x07e0) | ((col >>> 3) & 0x001f);
export const rgb565to888 = (col) => ((((col >> 8) & 0xf8) << 16) | (((col >> 3) & 0xfc) << 8) | ((col << 3) & 0xf8));
export function rgb565to888full(col) {
    const r = (((col >> 11) * 255 + 15) / 31) | 0;
    const g = ((((col >> 5) & 0x3f) * 255 + 31) / 63) | 0;
    const b = (((col & 0x1f) * 255 + 15) / 31) | 0;
    return (r << 16) | (g << 8) | b;
}

// gfx_map_font_t {bitmap, from, to, width, lineHeight}: one byte per column, bit 0 at the top.
// gfx_font_3x5 (GyverGFX-dev default/font3x5.h): only the glyphs the clock prints, by index (char - 33).
export const gfx_font_3x5 = { from: 0, to: 159, width: 3, lineHeight: 5, glyphs: {
    12: [0x04, 0x04, 0x04],  // -
    15: [0x1f, 0x11, 0x1f], 16: [0x00, 0x02, 0x1f], 17: [0x1d, 0x15, 0x17], 18: [0x11, 0x15, 0x1f], 19: [0x07, 0x04, 0x1f],
    20: [0x17, 0x15, 0x1d], 21: [0x1f, 0x15, 0x1d], 22: [0x01, 0x01, 0x1f], 23: [0x1f, 0x15, 0x1f], 24: [0x17, 0x15, 0x1f],
} };

// src/font_3x5_diag.h (drawn for the diagonal grid)
export const font_3x5_diag = { from: 15, to: 24, width: 3, lineHeight: 5, glyphs: {
    15: [0x0f, 0x11, 0x1e], 16: [0x00, 0x02, 0x1f], 17: [0x0d, 0x15, 0x16], 18: [0x09, 0x15, 0x1e], 19: [0x03, 0x04, 0x1f],
    20: [0x13, 0x15, 0x19], 21: [0x0f, 0x15, 0x18], 22: [0x01, 0x01, 0x1e], 23: [0x0f, 0x15, 0x1e], 24: [0x03, 0x15, 0x1e],
} };

// src/font_4x5.h
export const font_4x5 = { from: 15, to: 24, width: 4, lineHeight: 5, glyphs: {
    15: [0x03, 0x09, 0x12, 0x18], 16: [0x00, 0x03, 0x0c, 0x10], 17: [0x01, 0x0d, 0x16, 0x10], 18: [0x01, 0x05, 0x16, 0x18], 19: [0x03, 0x04, 0x06, 0x18],
    20: [0x03, 0x05, 0x14, 0x18], 21: [0x03, 0x0d, 0x14, 0x18], 22: [0x01, 0x01, 0x1e, 0x00], 23: [0x03, 0x0d, 0x16, 0x18], 24: [0x03, 0x05, 0x16, 0x18],
} };

// kaia.cpp's mix(): each channel from a towards b by k / 255, truncating toward zero
export function mix(a, b, k) {
    let out = 0;
    for (let s = 0; s <= 16; s += 8) {
        const ca = (a >> s) & 0xff, cb = (b >> s) & 0xff;
        out |= (ca + ((cb - ca) * k / 255 | 0)) << s;
    }
    return out >>> 0;
}

// the strip and the GFX state of BallMatrix
export class BallMatrix {
    constructor() {
        this.leds = new Uint32Array(MX_LED_AMOUNT);
        this.marks = new Uint8Array(MX_LED_AMOUNT);
        this.marking = false;
        this.alpha = 255;  // v1.7: while marking, setXY draws this much of the new colour over what is there (255 = all)
        this.diag = false;
        this.w = MX_XY_W;
        this.h = MX_XY_H;
        this.color = 1;  // 565
        this.buf16 = 0;
        this.buf32 = 0;
        this.cx = 0;
        this.cy = 0;
        this.font = gfx_font_3x5;
    }

    clear() {
        this.leds.fill(0);
    }

    setLED(idx, color) {
        if (idx >= 0 && idx < MX_LED_AMOUNT) this.leds[idx] = color & 0xffffff;
    }

    getLED(idx) {
        return idx >= 0 && idx < MX_LED_AMOUNT ? this.leds[idx] : 0;
    }

    // setLED(int x, int y, color) / getLED(int x, int y)
    setXY(x, y, color) {
        const led = this.diag ? ledDiag(x, y) : ledXY(x, y);
        if (led < 0) return;
        if (this.marking) {
            this.marks[led] = 1;
            if (this.alpha < 255) color = mix(this.getLED(led), color, this.alpha);
        }
        this.setLED(led, color);
    }

    getXY(x, y) {
        const led = this.diag ? ledDiag(x, y) : ledXY(x, y);
        return led >= 0 ? this.getLED(led) : 0;
    }

    beginMarks() {
        this.marks.fill(0);
        this.marking = true;
    }

    endMarks() {
        this.marking = false;
    }

    marked(idx) {
        return this.marks[idx] === 1;
    }

    setModeXY() {
        this.diag = false;
        this.w = MX_XY_W;
        this.h = MX_XY_H;
    }

    setModeDiag() {
        this.diag = true;
        this.w = MX_DIAG_W;
        this.h = MX_DIAG_H;
    }

    setColor24(c) {
        this.color = rgb888to565(c);
    }

    getColor24() {
        return rgb565to888(this.color);
    }

    // BallMatrix::fastSet
    fastSet(x, y) {
        if (this.buf16 !== this.color) {
            this.buf16 = this.color;
            this.buf32 = rgb565to888full(this.color);
        }
        this.setXY(x, y, this.buf32);
    }

    setFont(f) {
        this.font = f;
    }

    setCursor(x, y) {
        this.cx = x;
        this.cy = y;
    }

    // GyverGFX::print of a text through write(): a map font, scale 1, the text bound 0 .. width-1, no wrap
    print(text) {
        for (const ch of String(text)) this.write(ch.charCodeAt(0));
    }

    write(data) {
        const f = this.font, bound1 = this.w - 1;
        const lineHeight = f.lineHeight >= 8 ? f.lineHeight : f.lineHeight + 1;
        const interval = lineHeight >> 4 || 1;
        if (this.cx >= bound1 || this.cy >= this.h) return;
        if (data === 32) {
            this.cx += f.width;  // getSpaceSize of a map font
            return;
        }
        if (data < 33 || data === 127) return;
        const idx = data - 33;  // Decoder::getIndex for ASCII
        if (idx < f.from || idx > f.to) return;
        const cols = f.glyphs[idx] || new Array(f.width).fill(0);
        for (let x = 0; x < f.width; x++) this.drawByte(cols[x]);
        this.cx += interval;
    }

    // GyverGFX::_drawByte at scale 1, then fastByte: bit i of the column lands at y = cy + i
    drawByte(data) {
        if (this.cx >= 0 && this.cx <= this.w - 1) {
            const shift = this.cy & 7;
            if (shift) {
                this.byteAt(this.cx, this.cy - shift, (data << shift) & 255);
                this.byteAt(this.cx, this.cy - shift + 8, data >> (8 - shift));
            } else {
                this.byteAt(this.cx, this.cy, data);
            }
        }
        this.cx++;
    }

    byteAt(x, y, data) {
        if (y < 0 || y >= this.h) return;
        for (let i = 0; i < 8; i++) {
            if (y >= this.h) break;
            if (data & 1) this.fastSet(x, y);
            data >>= 1;
            y++;
        }
    }
}
