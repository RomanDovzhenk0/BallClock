// FastLED 3.7.7 src/noise.cpp: inoise16(x, y, z) with FASTLED_NOISE_FIXED 1 (EASE16 = ease16InOutQuad),
// LERP = lerp15by16 and AVG15 = avg15 (the overflow-safe average).
import { avg15, ease16InOutQuad, lerp15by16 } from "./lib8.js";

const NP = [
    151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225,
    140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
    247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
    57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
    74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
    60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
    65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169,
    200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
    52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212,
    207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
    119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
    129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
    218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241,
    81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
    184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
    222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
    151];

const s16 = (v) => (v << 16) >> 16;

function grad16(hash, x, y, z) {
    hash &= 15;
    let u = hash < 8 ? x : y;
    let v = hash < 4 ? y : hash === 12 || hash === 14 ? x : z;
    if (hash & 1) u = s16(-u);
    if (hash & 2) v = s16(-v);
    return avg15(u, v);
}

// x, y, z: uint32
export function inoise16_raw(x, y, z) {
    const X = (x >>> 16) & 0xff, Y = (y >>> 16) & 0xff, Z = (z >>> 16) & 0xff;
    const A = (NP[X] + Y) & 255, AA = (NP[A] + Z) & 255, AB = (NP[A + 1] + Z) & 255;
    const B = (NP[X + 1] + Y) & 255, BA = (NP[B] + Z) & 255, BB = (NP[B + 1] + Z) & 255;
    let u = x & 0xffff, v = y & 0xffff, w = z & 0xffff;
    const xx = (u >> 1) & 0x7fff, yy = (v >> 1) & 0x7fff, zz = (w >> 1) & 0x7fff;
    const N = 0x8000;
    u = ease16InOutQuad(u);
    v = ease16InOutQuad(v);
    w = ease16InOutQuad(w);
    const X1 = lerp15by16(grad16(NP[AA], xx, yy, zz), grad16(NP[BA], s16(xx - N), yy, zz), u);
    const X2 = lerp15by16(grad16(NP[AB], xx, s16(yy - N), zz), grad16(NP[BB], s16(xx - N), s16(yy - N), zz), u);
    const X3 = lerp15by16(grad16(NP[AA + 1], xx, yy, s16(zz - N)), grad16(NP[BA + 1], s16(xx - N), yy, s16(zz - N)), u);
    const X4 = lerp15by16(grad16(NP[AB + 1], xx, s16(yy - N), s16(zz - N)), grad16(NP[BB + 1], s16(xx - N), s16(yy - N), s16(zz - N)), u);
    const Y1 = lerp15by16(X1, X2, v);
    const Y2 = lerp15by16(X3, X4, v);
    return lerp15by16(Y1, Y2, w);
}

export function inoise16(x, y, z) {
    const ans = inoise16_raw(x >>> 0, y >>> 0, z >>> 0) + 19052;
    const pan = Math.imul(ans >>> 0, 440) >>> 0;
    return (pan >>> 8) & 0xffff;
}
