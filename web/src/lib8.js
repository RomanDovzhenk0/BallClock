// FastLED 3.7.7 lib8tion, as the ESP8266 build compiles it: the plain C versions,
// FASTLED_SCALE8_FIXED 1 and FASTLED_BLEND_FIXED 1 (src/fastled_config.h).
// Colours are 0xRRGGBB numbers; every byte op wraps like uint8_t.

const b_m16_interleave = [0, 49, 49, 41, 90, 27, 117, 10];

// lib8tion/trig8.h sin8_C
export function sin8(theta) {
    theta &= 255;
    let offset = theta;
    if (theta & 0x40) offset = (255 - offset) & 255;
    offset &= 0x3f;
    let secoffset = offset & 0x0f;
    if (theta & 0x40) secoffset++;
    const s2 = (offset >> 4) * 2;
    const b = b_m16_interleave[s2], m16 = b_m16_interleave[s2 + 1];
    const mx = (m16 * secoffset) >> 4;
    let y = (mx + b) << 24 >> 24;  // int8_t
    if (theta & 0x80) y = -y << 24 >> 24;
    return (y + 128) & 255;
}

// lib8tion/scale8.h scale8_LEAVING_R1_DIRTY (fixed)
export const scale8 = (i, scale) => (i * (scale + 1)) >> 8;

// lib8tion/math8.h qadd8
export const qadd8 = (i, j) => (i + j > 255 ? 255 : i + j);

// lib8tion/scale8.h nscale8x3_video on one channel
export const scale8Video = (c, scale) => (c === 0 ? 0 : ((c * scale) >> 8) + (scale !== 0 ? 1 : 0));

// lib8tion/math8.h blend8 (BLEND_FIXED, SCALE8_FIXED): uint16 partial
export function blend8(a, b, amountOfB) {
    let partial = ((a << 8) | b) & 0xffff;
    partial = (partial + b * amountOfB) & 0xffff;
    partial = (partial - a * amountOfB) & 0xffff;
    return partial >> 8;
}

// colorutils nblend through blend(p1, p2, amountOfP2)
export function blend(c1, c2, amount) {
    amount &= 255;
    if (amount === 0) return c1 & 0xffffff;
    if (amount === 255) return c2 & 0xffffff;
    return (blend8((c1 >> 16) & 255, (c2 >> 16) & 255, amount) << 16) | (blend8((c1 >> 8) & 255, (c2 >> 8) & 255, amount) << 8) | blend8(c1 & 255, c2 & 255, amount);
}

// lib8tion/scale8.h scale16 (fixed); i, scale: uint16
export const scale16 = (i, scale) => Math.floor((i * (1 + scale)) / 65536);

// lib8tion.h ease16InOutQuad
export function ease16InOutQuad(i) {
    let j = i;
    if (j & 0x8000) j = 65535 - j;
    const jj = scale16(j, j);
    let jj2 = (jj << 1) & 0xffff;
    if (i & 0x8000) jj2 = 65535 - jj2;
    return jj2;
}

export const i16 = (v) => (v << 16) >> 16;

// lib8tion.h lerp15by16: a, b int16, frac uint16
export function lerp15by16(a, b, frac) {
    if (b > a) return i16(a + scale16((b - a) & 0xffff, frac));
    return i16(a - scale16((a - b) & 0xffff, frac));
}

// lib8tion/math8.h avg15 (C)
export const avg15 = (i, j) => i16((i >> 1) + (j >> 1) + (i & 1));
