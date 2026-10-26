// firmware/src/palettes.cpp: the 61 palettes (0–30 of v1.5, 31–60 new in v1.6) as FastLED 3.7.7 builds them into CRGBPalette16
// (colorpalettes.cpp for the built-in ones, CRGBPalette16 = TProgmemRGBGradientPalette for the gradients)
// and getPaletteColor → ColorFromPalette16 (LINEARBLEND) → nscale8x3_video.
import { qadd8, scale8, scale8Video } from "./lib8.js";

const Black = 0x000000, Blue = 0x0000ff, DarkBlue = 0x00008b, SkyBlue = 0x87ceeb, LightBlue = 0xadd8e6, White = 0xffffff;
const Maroon = 0x800000, DarkRed = 0x8b0000, Red = 0xff0000, Orange = 0xffa500;
const SeaGreen = 0x2e8b57, MediumAquamarine = 0x66cdaa, Green = 0x008000, DarkGreen = 0x006400, ForestGreen = 0x228b22;

// colorpalettes.cpp
const HeatColors_p = [0x000000, 0x330000, 0x660000, 0x990000, 0xcc0000, 0xff0000, 0xff3300, 0xff6600, 0xff9900, 0xffcc00, 0xffff00, 0xffff33, 0xffff66, 0xffff99, 0xffffcc, 0xffffff];
const LavaColors_p = [Black, Maroon, Black, Maroon, DarkRed, DarkRed, Maroon, DarkRed, DarkRed, DarkRed, Red, Orange, White, Orange, Red, DarkRed];
const PartyColors_p = [0x5500ab, 0x84007c, 0xb5004b, 0xe5001b, 0xe81700, 0xb84700, 0xab7700, 0xabab00, 0xab5500, 0xdd2200, 0xf2000e, 0xc2003e, 0x8f0071, 0x5f00a1, 0x2f00d0, 0x0007f9];
const RainbowColors_p = [0xff0000, 0xd52a00, 0xab5500, 0xab7f00, 0xabab00, 0x56d500, 0x00ff00, 0x00d52a, 0x00ab55, 0x0056aa, 0x0000ff, 0x2a00d5, 0x5500ab, 0x7f0081, 0xab0055, 0xd5002b];
const RainbowStripeColors_p = [0xff0000, 0, 0xab5500, 0, 0xabab00, 0, 0x00ff00, 0, 0x00ab55, 0, 0x0000ff, 0, 0x5500ab, 0, 0xab0055, 0];
const CloudColors_p = [Blue, DarkBlue, DarkBlue, DarkBlue, DarkBlue, DarkBlue, DarkBlue, DarkBlue, Blue, DarkBlue, SkyBlue, SkyBlue, LightBlue, White, LightBlue, SkyBlue];
// MidnightBlue, DarkBlue, MidnightBlue, Navy, DarkBlue, MediumBlue, SeaGreen, Teal, CadetBlue, Blue, DarkCyan, CornflowerBlue, Aquamarine, SeaGreen, Aqua, LightSkyBlue
const OceanColors_p = [0x191970, DarkBlue, 0x191970, 0x000080, DarkBlue, 0x0000cd, SeaGreen, 0x008080, 0x5f9ea0, Blue, 0x008b8b, 0x6495ed, 0x7fffd4, SeaGreen, 0x00ffff, 0x87cefa];
// DarkGreen, DarkGreen, DarkOliveGreen, DarkGreen, Green, ForestGreen, OliveDrab, Green, SeaGreen, MediumAquamarine, LimeGreen, YellowGreen, LightGreen, LawnGreen, MediumAquamarine, ForestGreen
const ForestColors_p = [DarkGreen, DarkGreen, 0x556b2f, DarkGreen, Green, ForestGreen, 0x6b8e23, Green, SeaGreen, MediumAquamarine, 0x32cd32, 0x9acd32, 0x90ee90, 0x7cfc00, MediumAquamarine, ForestGreen];

// palettes.cpp: TProgmemRGBPalette16 (OrangeRed, FireBrick, Pink, DeepPink, Gold, Goldenrod, GreenYellow, LimeGreen, DeepSkyBlue, LightSkyBlue)
const WoodFireColors_p = [Black, 0x330e00, 0x661c00, 0x992900, 0xcc3700, 0xff4500, 0xff5800, 0xff6b00, 0xff7f00, 0xff9200, Orange, 0xffaf00, 0xffb900, 0xffc300, 0xffcd00, 0xffd700];
const NormalFire_p = [Black, 0x330000, 0x660000, 0x990000, 0xcc0000, Red, 0xff0c00, 0xff1800, 0xff2400, 0xff3000, 0xff3c00, 0xff4800, 0xff5400, 0xff6000, 0xff6c00, 0xff7800];
const LithiumFireColors_p = [Black, 0x240707, 0x470e0e, 0x6b1414, 0x8e1b1b, 0xb22222, 0xc14244, 0xd16166, 0xe08187, 0xf0a0a9, 0xffc0cb, 0xff9ec0, 0xff7bb5, 0xff59a9, 0xff369e, 0xff1493];
const SodiumFireColors_p = [Black, 0x332100, 0x664200, 0x996300, 0xcc8400, Orange, 0xffaf00, 0xffb900, 0xffc300, 0xffcd00, 0xffd700, 0xf8cd06, 0xf0c30d, 0xe9b913, 0xe1af1a, 0xdaa520];
const CopperFireColors_p = [Black, 0x001a00, 0x003300, 0x004d00, 0x006600, Green, 0x239909, 0x45b313, 0x68cc1c, 0x8ae626, 0xadff2f, 0x94f530, 0x7ceb30, 0x63e131, 0x4bd731, 0x32cd32];
const AlcoholFireColors_p = [Black, 0x000033, 0x000066, 0x000099, 0x0000cc, Blue, 0x0026ff, 0x004cff, 0x0073ff, 0x0099ff, 0x00bfff, 0x1bc2fe, 0x36c5fd, 0x51c8fc, 0x6ccbfb, 0x87cefa];

// palettes.cpp DEFINE_GRADIENT_PALETTE: index, r, g, b
const Fire_gp = [0, 0, 0, 0, 128, 255, 0, 0, 224, 255, 255, 0, 255, 255, 255, 255];
const Sunset_Real_gp = [0, 120, 0, 0, 22, 179, 22, 0, 51, 255, 104, 0, 85, 167, 22, 18, 135, 100, 0, 103, 198, 16, 0, 130, 255, 0, 0, 160];
const dkbluered_gp = [0, 1, 0, 4, 8, 1, 0, 13, 17, 1, 0, 29, 25, 1, 0, 52, 33, 1, 0, 83, 42, 1, 0, 123, 51, 1, 0, 174, 59, 1, 0, 235,
    68, 1, 2, 255, 76, 4, 17, 255, 84, 16, 45, 255, 93, 37, 82, 255, 102, 69, 127, 255, 110, 120, 168, 255, 119, 182, 217, 255,
    127, 255, 255, 255, 135, 255, 217, 184, 144, 255, 168, 123, 153, 255, 127, 73, 161, 255, 82, 40, 170, 255, 45, 18, 178, 255, 17, 5,
    186, 255, 2, 1, 195, 234, 0, 1, 204, 171, 0, 1, 212, 120, 0, 1, 221, 79, 0, 1, 229, 48, 0, 1, 237, 26, 0, 1, 246, 12, 0, 1, 255, 4, 0, 1];
const Optimus_Prime_gp = [0, 5, 16, 18, 25, 5, 16, 18, 51, 7, 25, 39, 76, 8, 38, 71, 102, 64, 99, 106, 127, 194, 189, 151, 153, 182, 63, 42, 178, 167, 6, 2, 204, 100, 3, 1, 229, 53, 1, 1, 255, 53, 1, 1];
const warmGrad_gp = [0, 252, 252, 172, 25, 239, 255, 61, 53, 247, 45, 17, 76, 197, 82, 19, 96, 239, 255, 61, 124, 83, 4, 1, 153, 247, 45, 17, 214, 23, 15, 17, 255, 1, 1, 1];
const coldGrad_gp = [0, 66, 186, 192, 43, 1, 22, 71, 79, 2, 104, 142, 117, 66, 186, 192, 147, 2, 104, 142, 186, 1, 22, 71, 224, 2, 104, 142, 255, 4, 27, 28];
const hotGrad_gp = [0, 157, 21, 2, 35, 229, 244, 16, 73, 255, 44, 7, 107, 142, 7, 1, 153, 229, 244, 16, 206, 142, 7, 1, 255, 135, 36, 0];
const pinkGrad_gp = [0, 249, 32, 145, 28, 208, 1, 7, 43, 249, 1, 19, 56, 126, 152, 10, 73, 234, 23, 84, 89, 224, 45, 119, 107, 232, 127, 158, 127, 244, 13, 89, 150, 188, 6, 52, 175, 177, 70, 14, 221, 194, 1, 8, 255, 112, 0, 1];
const comfy_gp = [0, 255, 255, 45, 43, 208, 93, 1, 137, 224, 1, 242, 181, 159, 1, 29, 255, 63, 4, 68];
const cyperpunk_gp = [0, 3, 6, 72, 38, 12, 50, 188, 109, 217, 35, 1, 135, 242, 175, 12, 178, 161, 32, 87, 255, 24, 6, 108];
const girl_gp = [0, 103, 1, 10, 33, 109, 1, 12, 76, 159, 5, 48, 119, 175, 55, 103, 127, 175, 55, 103, 178, 159, 5, 48, 221, 109, 1, 12, 255, 103, 1, 10];
const xmas_gp = [0, 0, 12, 0, 40, 0, 55, 0, 66, 1, 117, 2, 77, 1, 84, 1, 81, 0, 55, 0, 119, 0, 12, 0, 153, 42, 0, 0, 181, 121, 0, 0, 204, 255, 12, 8, 224, 121, 0, 0, 244, 42, 0, 0, 255, 42, 0, 0];
const acid_gp = [0, 0, 12, 0, 61, 153, 239, 112, 127, 0, 12, 0, 165, 106, 239, 2, 196, 167, 229, 71, 229, 106, 239, 2, 255, 0, 12, 0];
const blueSmoke_gp = [0, 0, 0, 0, 12, 1, 1, 3, 53, 8, 1, 22, 80, 4, 6, 89, 119, 2, 25, 216, 145, 7, 10, 99, 186, 15, 2, 31, 233, 2, 1, 5, 255, 0, 0, 0];
const gummy_gp = [0, 8, 47, 5, 31, 77, 122, 6, 63, 249, 237, 7, 95, 232, 51, 1, 127, 215, 0, 1, 159, 47, 1, 3, 191, 1, 7, 16, 223, 52, 22, 6, 255, 239, 45, 1];
// the 18 after 32 is in the firmware's table as it is
const leo_gp = [0, 0, 0, 0, 16, 0, 0, 0, 32, 0, 0, 0, 18, 0, 0, 0, 64, 16, 8, 0, 80, 80, 40, 0, 96, 16, 8, 0, 112, 0, 0, 0, 128, 0, 0, 0,
    144, 0, 0, 0, 160, 0, 0, 0, 176, 0, 0, 0, 192, 0, 0, 0, 208, 0, 0, 0, 224, 0, 0, 0, 240, 0, 0, 0, 255, 0, 0, 0];
const aurora_gp = [0, 17, 177, 13, 64, 121, 242, 5, 128, 25, 173, 121, 192, 250, 77, 127, 255, 171, 101, 221];
// v1.6 (KAIA-172), back_pal 31–60; the old 31 never move. 38–40 come from FastLED's Pacifica.ino (pacifica_palette_1, _3)
// and TwinkleFox.ino (Ice_p), the rest are KAIA-172's own. Each one loops: its last stop is its first.
const Amber_gp = [0, 255, 140, 0, 64, 255, 190, 40, 128, 200, 80, 0, 192, 255, 170, 30, 255, 255, 140, 0];
const Candle_gp = [0, 120, 40, 0, 70, 255, 150, 30, 130, 255, 210, 110, 190, 255, 150, 30, 255, 120, 40, 0];
const Terracotta_gp = [0, 168, 72, 40, 85, 222, 128, 70, 170, 140, 50, 40, 255, 168, 72, 40];
const PeachFizz_gp = [0, 255, 140, 110, 85, 255, 190, 140, 170, 240, 100, 100, 255, 255, 140, 110];
const Coral_gp = [0, 255, 80, 70, 90, 255, 140, 90, 170, 230, 50, 100, 255, 255, 80, 70];
const Honey_gp = [0, 255, 180, 20, 100, 255, 215, 90, 180, 200, 120, 10, 255, 255, 180, 20];
const Embers_gp = [0, 40, 6, 0, 60, 180, 30, 0, 120, 255, 100, 10, 180, 180, 30, 0, 255, 40, 6, 0];
const Pacifica_gp = [0, 0, 5, 7, 96, 0, 1, 20, 160, 0, 0, 38, 208, 0, 0, 70, 232, 20, 85, 75, 244, 40, 170, 80, 255, 0, 5, 7];
const PacificaDeep_gp = [0, 0, 2, 8, 68, 0, 8, 32, 136, 0, 14, 57, 204, 0, 28, 112, 238, 16, 64, 191, 248, 32, 96, 255, 255, 0, 2, 8];
const IceTwinkle_gp = [0, 12, 16, 64, 110, 24, 40, 110, 190, 24, 32, 128, 225, 80, 128, 192, 255, 12, 16, 64];
const Glacier_gp = [0, 200, 240, 255, 85, 90, 180, 240, 170, 30, 90, 200, 255, 200, 240, 255];
const Lagoon_gp = [0, 0, 180, 170, 85, 0, 120, 200, 170, 10, 60, 150, 255, 0, 180, 170];
const Twilight_gp = [0, 40, 30, 110, 85, 90, 60, 170, 170, 30, 70, 160, 255, 40, 30, 110];
const Moonlight_gp = [0, 200, 210, 235, 100, 110, 130, 200, 190, 40, 50, 120, 255, 200, 210, 235];
const Meadow_gp = [0, 60, 160, 40, 85, 170, 210, 60, 170, 30, 130, 60, 255, 60, 160, 40];
const Moss_gp = [0, 20, 70, 20, 100, 90, 140, 30, 180, 40, 110, 50, 255, 20, 70, 20];
const Autumn_gp = [0, 200, 60, 10, 70, 240, 150, 20, 140, 150, 40, 20, 200, 100, 50, 10, 255, 200, 60, 10];
const Sakura_gp = [0, 255, 190, 205, 100, 245, 130, 170, 180, 255, 225, 230, 255, 255, 190, 205];
const Dunes_gp = [0, 230, 190, 120, 90, 200, 130, 70, 170, 150, 90, 60, 255, 230, 190, 120];
const Tropics_gp = [0, 0, 120, 60, 80, 60, 200, 90, 160, 240, 200, 40, 210, 255, 90, 60, 255, 0, 120, 60];
const Dawn_gp = [0, 80, 40, 140, 80, 230, 90, 120, 150, 255, 170, 60, 210, 255, 220, 140, 255, 80, 40, 140];
const NeonNight_gp = [0, 255, 0, 140, 85, 120, 0, 255, 170, 0, 220, 255, 255, 255, 0, 140];
const Synthwave_gp = [0, 255, 40, 160, 70, 160, 30, 255, 140, 30, 60, 255, 200, 0, 230, 230, 255, 255, 40, 160];
const Toxic_gp = [0, 150, 255, 0, 90, 0, 200, 60, 170, 0, 60, 20, 220, 60, 230, 20, 255, 150, 255, 0];
const Electric_gp = [0, 0, 60, 255, 80, 0, 220, 255, 140, 255, 255, 255, 200, 0, 150, 255, 255, 0, 60, 255];
const Candy_gp = [0, 255, 60, 160, 64, 255, 200, 40, 128, 60, 230, 200, 192, 170, 90, 255, 255, 255, 60, 160];
const Laser_gp = [0, 255, 20, 20, 64, 255, 20, 200, 128, 20, 60, 255, 192, 20, 255, 120, 255, 255, 20, 20];
const Ultraviolet_gp = [0, 90, 0, 200, 100, 200, 30, 255, 170, 255, 120, 255, 255, 90, 0, 200];
const Linen_gp = [0, 235, 215, 185, 100, 215, 175, 140, 190, 190, 200, 200, 255, 235, 215, 185];
const DuskMist_gp = [0, 120, 110, 150, 100, 160, 140, 170, 190, 110, 130, 160, 255, 120, 110, 150];

// colorutils.cpp fill_gradient_RGB: saccum87 deltas (int16), accum88 (uint16)
function fillGradientRGB(e, startpos, sc, endpos, ec) {
    if (endpos < startpos) {
        const t = endpos, tc = ec;
        ec = sc;
        endpos = startpos;
        startpos = t;
        sc = tc;
    }
    const s16 = (v) => (v << 16) >> 16;
    const ch = (c, s) => (c >> s) & 255;
    const divisor = endpos - startpos || 1;
    const d = [16, 8, 0].map((s) => s16(s16(s16((ch(ec, s) - ch(sc, s)) << 7) / divisor | 0) * 2));
    const acc = [16, 8, 0].map((s) => ch(sc, s) << 8);
    for (let i = startpos; i <= endpos; i++) {
        e[i] = ((acc[0] >> 8) << 16) | ((acc[1] >> 8) << 8) | (acc[2] >> 8);
        for (let c = 0; c < 3; c++) acc[c] = (acc[c] + d[c]) & 0xffff;
    }
}

// colorutils.h CRGBPalette16& operator=(TProgmemRGBGradientPalette_bytes)
export function gradientTo16(gp) {
    const e = new Array(16).fill(0);
    let count = 0;
    do count++;
    while (gp[(count - 1) * 4] !== 255);
    const at = (k) => [gp[k * 4], (gp[k * 4 + 1] << 16) | (gp[k * 4 + 2] << 8) | gp[k * 4 + 3]];
    let lastSlotUsed = -1, k = 0;
    let rgbstart = at(0)[1], indexstart = 0;
    while (indexstart < 255) {
        k++;
        const [indexend, rgbend] = at(k);
        let istart8 = (indexstart / 16) | 0, iend8 = (indexend / 16) | 0;
        if (count < 16) {
            if (istart8 <= lastSlotUsed && lastSlotUsed < 15) {
                istart8 = lastSlotUsed + 1;
                if (iend8 < istart8) iend8 = istart8;
            }
            lastSlotUsed = iend8;
        }
        fillGradientRGB(e, istart8, rgbstart, iend8, rgbend);
        indexstart = indexend;
        rgbstart = rgbend;
    }
    return e;
}

export const PAL_NAMES = ["HeatColors", "Fire", "WoodFireColors", "NormalFire", "LithiumFireColors", "SodiumFireColors", "CopperFireColors",
    "AlcoholFireColors", "LavaColors", "PartyColors", "RainbowColors", "RainbowStripeColors", "CloudColors", "OceanColors", "ForestColors",
    "Sunset_Real", "Dkbluered", "OptimusPrime", "WarmGrad", "ColdGrad", "HotGrad", "PinkGrad", "Comfy", "Cyperpunk", "Girl", "Xmas", "Acid",
    "BlueSmoke", "Gummy", "Leo", "Aurora",
    "Amber", "Candle", "Terracotta", "PeachFizz", "Coral", "Honey", "Embers", "Pacifica", "PacificaDeep", "IceTwinkle", "Glacier", "Lagoon",
    "Twilight", "Moonlight", "Meadow", "Moss", "Autumn", "Sakura", "Dunes", "Tropics", "Dawn", "NeonNight", "Synthwave", "Toxic", "Electric",
    "Candy", "Laser", "Ultraviolet", "Linen", "DuskMist"];

// paletteArr[] in palettes.cpp order
export const PALETTES = [HeatColors_p, Fire_gp, WoodFireColors_p, NormalFire_p, LithiumFireColors_p, SodiumFireColors_p, CopperFireColors_p,
    AlcoholFireColors_p, LavaColors_p, PartyColors_p, RainbowColors_p, RainbowStripeColors_p, CloudColors_p, OceanColors_p, ForestColors_p,
    Sunset_Real_gp, dkbluered_gp, Optimus_Prime_gp, warmGrad_gp, coldGrad_gp, hotGrad_gp, pinkGrad_gp, comfy_gp, cyperpunk_gp, girl_gp,
    xmas_gp, acid_gp, blueSmoke_gp, gummy_gp, leo_gp, aurora_gp,
    Amber_gp, Candle_gp, Terracotta_gp, PeachFizz_gp, Coral_gp, Honey_gp, Embers_gp, Pacifica_gp, PacificaDeep_gp, IceTwinkle_gp, Glacier_gp,
    Lagoon_gp, Twilight_gp, Moonlight_gp, Meadow_gp, Moss_gp, Autumn_gp, Sakura_gp, Dunes_gp, Tropics_gp, Dawn_gp, NeonNight_gp, Synthwave_gp,
    Toxic_gp, Electric_gp, Candy_gp, Laser_gp, Ultraviolet_gp, Linen_gp, DuskMist_gp].map((p, i) => (i === 1 || i >= 15 ? gradientTo16(p) : p));  // the _gp ones

// the picker's Russian names and groups (KAIA-172), by back_pal
export const PAL_RU = ["Жар", "Огонь", "Дрова", "Пламя", "Литий", "Натрий", "Медь", "Спирт", "Лава", "Вечеринка", "Радуга", "Радуга-полосы",
    "Облака", "Океан", "Лес", "Закат", "Сине-красная", "Оптимус", "Тёплая", "Холодная", "Горячая", "Розовая", "Уют", "Киберпанк", "Девчачья",
    "Новый год", "Кислота", "Синий дым", "Мармелад", "Лев", "Аврора",
    "Янтарь", "Свеча", "Терракота", "Персик", "Коралл", "Мёд", "Угли", "Пасифика", "Тихий океан", "Лёд", "Ледник", "Лагуна", "Сумерки",
    "Лунный свет", "Луг", "Мох", "Осень", "Сакура", "Дюны", "Тропики", "Заря", "Неон", "Синтвейв", "Токсик", "Электрик", "Леденец", "Лазер",
    "Ультрафиолет", "Лён", "Дымка"];
export const PAL_GROUPS = ["Огонь", "Тёплые", "Холодные", "Природа", "Неон", "Спокойные", "Разное"];
export const PAL_GROUP = [0, 0, 0, 0, 1, 0, 3, 2, 0, 4, 4, 4, 2, 2, 3, 1, 6, 6, 1, 2, 0, 1, 6, 4, 1, 6, 4, 5, 4, 6, 3,
    1, 1, 1, 1, 1, 1, 0, 2, 2, 2, 2, 2, 5, 5, 3, 3, 3, 3, 3, 3, 1, 4, 4, 4, 4, 4, 4, 4, 5, 5];
// the picker's order: group by group, by index within each
export const PAL_ORDER = PAL_GROUPS.flatMap((g, k) => PAL_GROUP.map((x, i) => (x === k ? i : -1)).filter((i) => i >= 0));

// palettes.cpp ColorFromPalette16 (LINEARBLEND); index uint16, brightness uint8
export function colorFromPalette16(pal, index, brightness) {
    index &= 0xffff;
    const index_4bit = index >> 12, offset = (index >> 4) & 255;
    const e1 = pal[index_4bit];
    let r = (e1 >> 16) & 255, g = (e1 >> 8) & 255, b = e1 & 255;
    if (offset) {
        const e2 = pal[index_4bit === 15 ? 0 : index_4bit + 1], f1 = 255 - offset;
        r = qadd8(scale8(r, f1), scale8((e2 >> 16) & 255, offset));
        g = qadd8(scale8(g, f1), scale8((e2 >> 8) & 255, offset));
        b = qadd8(scale8(b, f1), scale8(e2 & 255, offset));
    }
    if (brightness !== 255) {
        r = scale8Video(r, brightness);
        g = scale8Video(g, brightness);
        b = scale8Video(b, brightness);
    }
    return (r << 16) | (g << 8) | b;
}

export function getPaletteColor(pal, idx, bright) {
    return colorFromPalette16(PALETTES[pal] || PALETTES[0], idx, bright & 255);
}
