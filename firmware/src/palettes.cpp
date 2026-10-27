#include "palettes.h"

#include <FastLED.h>

// Every palette stays in flash: on the ESP8266 FastLED leaves its PROGMEM data in RAM (FASTLED_USE_PROGMEM 0), so
// the gradients below go to flash here, 4-byte aligned as CRGBPalette16 reads them a dword at a time. Only the chosen
// one becomes a CRGBPalette16 in RAM (getPaletteColor).
#undef DEFINE_GRADIENT_PALETTE
#define DEFINE_GRADIENT_PALETTE(X) static const TProgmemRGBGradientPalette_byte X[] PROGMEM __attribute__((aligned(4))) =

DEFINE_GRADIENT_PALETTE(Fire_gp){
    0, 0, 0, 0,
    128, 255, 0, 0,
    224, 255, 255, 0,
    255, 255, 255, 255};

DEFINE_GRADIENT_PALETTE(Sunset_Real_gp){
    0, 120, 0, 0,
    22, 179, 22, 0,
    51, 255, 104, 0,
    85, 167, 22, 18,
    135, 100, 0, 103,
    198, 16, 0, 130,
    255, 0, 0, 160};

DEFINE_GRADIENT_PALETTE(dkbluered_gp){
    0, 1, 0, 4,
    8, 1, 0, 13,
    17, 1, 0, 29,
    25, 1, 0, 52,
    33, 1, 0, 83,
    42, 1, 0, 123,
    51, 1, 0, 174,
    59, 1, 0, 235,
    68, 1, 2, 255,
    76, 4, 17, 255,
    84, 16, 45, 255,
    93, 37, 82, 255,
    102, 69, 127, 255,
    110, 120, 168, 255,
    119, 182, 217, 255,
    127, 255, 255, 255,
    135, 255, 217, 184,
    144, 255, 168, 123,
    153, 255, 127, 73,
    161, 255, 82, 40,
    170, 255, 45, 18,
    178, 255, 17, 5,
    186, 255, 2, 1,
    195, 234, 0, 1,
    204, 171, 0, 1,
    212, 120, 0, 1,
    221, 79, 0, 1,
    229, 48, 0, 1,
    237, 26, 0, 1,
    246, 12, 0, 1,
    255, 4, 0, 1};
DEFINE_GRADIENT_PALETTE(Optimus_Prime_gp){
    0, 5, 16, 18,
    25, 5, 16, 18,
    51, 7, 25, 39,
    76, 8, 38, 71,
    102, 64, 99, 106,
    127, 194, 189, 151,
    153, 182, 63, 42,
    178, 167, 6, 2,
    204, 100, 3, 1,
    229, 53, 1, 1,
    255, 53, 1, 1};

DEFINE_GRADIENT_PALETTE(warmGrad_gp){
    0, 252, 252, 172,
    25, 239, 255, 61,
    53, 247, 45, 17,
    76, 197, 82, 19,
    96, 239, 255, 61,
    124, 83, 4, 1,
    153, 247, 45, 17,
    214, 23, 15, 17,
    255, 1, 1, 1};

DEFINE_GRADIENT_PALETTE(coldGrad_gp){
    0, 66, 186, 192,
    43, 1, 22, 71,
    79, 2, 104, 142,
    117, 66, 186, 192,
    147, 2, 104, 142,
    186, 1, 22, 71,
    224, 2, 104, 142,
    255, 4, 27, 28};

DEFINE_GRADIENT_PALETTE(hotGrad_gp){
    0, 157, 21, 2,
    35, 229, 244, 16,
    73, 255, 44, 7,
    107, 142, 7, 1,
    153, 229, 244, 16,
    206, 142, 7, 1,
    255, 135, 36, 0};

DEFINE_GRADIENT_PALETTE(pinkGrad_gp){
    0, 249, 32, 145,
    28, 208, 1, 7,
    43, 249, 1, 19,
    56, 126, 152, 10,
    73, 234, 23, 84,
    89, 224, 45, 119,
    107, 232, 127, 158,
    127, 244, 13, 89,
    150, 188, 6, 52,
    175, 177, 70, 14,
    221, 194, 1, 8,
    255, 112, 0, 1};

DEFINE_GRADIENT_PALETTE(comfy_gp){
    0, 255, 255, 45,
    43, 208, 93, 1,
    137, 224, 1, 242,
    181, 159, 1, 29,
    255, 63, 4, 68};

DEFINE_GRADIENT_PALETTE(cyperpunk_gp){
    0, 3, 6, 72,
    38, 12, 50, 188,
    109, 217, 35, 1,
    135, 242, 175, 12,
    178, 161, 32, 87,
    255, 24, 6, 108};

DEFINE_GRADIENT_PALETTE(girl_gp){
    0, 103, 1, 10,
    33, 109, 1, 12,
    76, 159, 5, 48,
    119, 175, 55, 103,
    127, 175, 55, 103,
    178, 159, 5, 48,
    221, 109, 1, 12,
    255, 103, 1, 10};

DEFINE_GRADIENT_PALETTE(xmas_gp){
    0, 0, 12, 0,
    40, 0, 55, 0,
    66, 1, 117, 2,
    77, 1, 84, 1,
    81, 0, 55, 0,
    119, 0, 12, 0,
    153, 42, 0, 0,
    181, 121, 0, 0,
    204, 255, 12, 8,
    224, 121, 0, 0,
    244, 42, 0, 0,
    255, 42, 0, 0};

DEFINE_GRADIENT_PALETTE(acid_gp){
    0, 0, 12, 0,
    61, 153, 239, 112,
    127, 0, 12, 0,
    165, 106, 239, 2,
    196, 167, 229, 71,
    229, 106, 239, 2,
    255, 0, 12, 0};

DEFINE_GRADIENT_PALETTE(blueSmoke_gp){
    0, 0, 0, 0,
    12, 1, 1, 3,
    53, 8, 1, 22,
    80, 4, 6, 89,
    119, 2, 25, 216,
    145, 7, 10, 99,
    186, 15, 2, 31,
    233, 2, 1, 5,
    255, 0, 0, 0};

DEFINE_GRADIENT_PALETTE(gummy_gp){
    0,
    8,
    47,
    5,
    31,
    77,
    122,
    6,
    63,
    249,
    237,
    7,
    95,
    232,
    51,
    1,
    127,
    215,
    0,
    1,
    159,
    47,
    1,
    3,
    191,
    1,
    7,
    16,
    223,
    52,
    22,
    6,
    255,
    239,
    45,
    1,
};

DEFINE_GRADIENT_PALETTE(leo_gp){
    0,
    0,
    0,
    0,
    16,
    0,
    0,
    0,
    32,
    0,
    0,
    0,
    18,
    0,
    0,
    0,
    64,
    16,
    8,
    0,
    80,
    80,
    40,
    0,
    96,
    16,
    8,
    0,
    112,
    0,
    0,
    0,
    128,
    0,
    0,
    0,
    144,
    0,
    0,
    0,
    160,
    0,
    0,
    0,
    176,
    0,
    0,
    0,
    192,
    0,
    0,
    0,
    208,
    0,
    0,
    0,
    224,
    0,
    0,
    0,
    240,
    0,
    0,
    0,
    255,
    0,
    0,
    0,
};

DEFINE_GRADIENT_PALETTE(aurora_gp){
    0, 17, 177, 13,     // Greenish
    64, 121, 242, 5,    // Greenish
    128, 25, 173, 121,  // Turquoise
    192, 250, 77, 127,  // Pink
    255, 171, 101, 221  // Purple
};

// 31 Янтарь (Тёплые)
DEFINE_GRADIENT_PALETTE(Amber_gp){
    0, 255, 140, 0,
    64, 255, 190, 40,
    128, 200, 80, 0,
    192, 255, 170, 30,
    255, 255, 140, 0
};

// 32 Свеча (Тёплые)
DEFINE_GRADIENT_PALETTE(Candle_gp){
    0, 120, 40, 0,
    70, 255, 150, 30,
    130, 255, 210, 110,
    190, 255, 150, 30,
    255, 120, 40, 0
};

// 33 Терракота (Тёплые)
DEFINE_GRADIENT_PALETTE(Terracotta_gp){
    0, 168, 72, 40,
    85, 222, 128, 70,
    170, 140, 50, 40,
    255, 168, 72, 40
};

// 34 Персик (Тёплые)
DEFINE_GRADIENT_PALETTE(PeachFizz_gp){
    0, 255, 140, 110,
    85, 255, 190, 140,
    170, 240, 100, 100,
    255, 255, 140, 110
};

// 35 Коралл (Тёплые)
DEFINE_GRADIENT_PALETTE(Coral_gp){
    0, 255, 80, 70,
    90, 255, 140, 90,
    170, 230, 50, 100,
    255, 255, 80, 70
};

// 36 Мёд (Тёплые)
DEFINE_GRADIENT_PALETTE(Honey_gp){
    0, 255, 180, 20,
    100, 255, 215, 90,
    180, 200, 120, 10,
    255, 255, 180, 20
};

// 37 Угли (Огонь)
DEFINE_GRADIENT_PALETTE(Embers_gp){
    0, 40, 6, 0,
    60, 180, 30, 0,
    120, 255, 100, 10,
    180, 180, 30, 0,
    255, 40, 6, 0
};

// 38 Пасифика (Холодные, FastLED Pacifica.ino pacifica_palette_1)
DEFINE_GRADIENT_PALETTE(Pacifica_gp){
    0, 0, 5, 7,
    96, 0, 1, 20,
    160, 0, 0, 38,
    208, 0, 0, 70,
    232, 20, 85, 75,
    244, 40, 170, 80,
    255, 0, 5, 7
};

// 39 Тихий океан (Холодные, FastLED Pacifica.ino pacifica_palette_3)
DEFINE_GRADIENT_PALETTE(PacificaDeep_gp){
    0, 0, 2, 8,
    68, 0, 8, 32,
    136, 0, 14, 57,
    204, 0, 28, 112,
    238, 16, 64, 191,
    248, 32, 96, 255,
    255, 0, 2, 8
};

// 40 Лёд (Холодные, FastLED TwinkleFox.ino Ice_p)
DEFINE_GRADIENT_PALETTE(IceTwinkle_gp){
    0, 12, 16, 64,
    110, 24, 40, 110,
    190, 24, 32, 128,
    225, 80, 128, 192,
    255, 12, 16, 64
};

// 41 Ледник (Холодные)
DEFINE_GRADIENT_PALETTE(Glacier_gp){
    0, 200, 240, 255,
    85, 90, 180, 240,
    170, 30, 90, 200,
    255, 200, 240, 255
};

// 42 Лагуна (Холодные)
DEFINE_GRADIENT_PALETTE(Lagoon_gp){
    0, 0, 180, 170,
    85, 0, 120, 200,
    170, 10, 60, 150,
    255, 0, 180, 170
};

// 43 Сумерки (Спокойные)
DEFINE_GRADIENT_PALETTE(Twilight_gp){
    0, 40, 30, 110,
    85, 90, 60, 170,
    170, 30, 70, 160,
    255, 40, 30, 110
};

// 44 Лунный свет (Спокойные)
DEFINE_GRADIENT_PALETTE(Moonlight_gp){
    0, 200, 210, 235,
    100, 110, 130, 200,
    190, 40, 50, 120,
    255, 200, 210, 235
};

// 45 Луг (Природа)
DEFINE_GRADIENT_PALETTE(Meadow_gp){
    0, 60, 160, 40,
    85, 170, 210, 60,
    170, 30, 130, 60,
    255, 60, 160, 40
};

// 46 Мох (Природа)
DEFINE_GRADIENT_PALETTE(Moss_gp){
    0, 20, 70, 20,
    100, 90, 140, 30,
    180, 40, 110, 50,
    255, 20, 70, 20
};

// 47 Осень (Природа)
DEFINE_GRADIENT_PALETTE(Autumn_gp){
    0, 200, 60, 10,
    70, 240, 150, 20,
    140, 150, 40, 20,
    200, 100, 50, 10,
    255, 200, 60, 10
};

// 48 Сакура (Природа)
DEFINE_GRADIENT_PALETTE(Sakura_gp){
    0, 255, 190, 205,
    100, 245, 130, 170,
    180, 255, 225, 230,
    255, 255, 190, 205
};

// 49 Дюны (Природа)
DEFINE_GRADIENT_PALETTE(Dunes_gp){
    0, 230, 190, 120,
    90, 200, 130, 70,
    170, 150, 90, 60,
    255, 230, 190, 120
};

// 50 Тропики (Природа)
DEFINE_GRADIENT_PALETTE(Tropics_gp){
    0, 0, 120, 60,
    80, 60, 200, 90,
    160, 240, 200, 40,
    210, 255, 90, 60,
    255, 0, 120, 60
};

// 51 Заря (Тёплые)
DEFINE_GRADIENT_PALETTE(Dawn_gp){
    0, 80, 40, 140,
    80, 230, 90, 120,
    150, 255, 170, 60,
    210, 255, 220, 140,
    255, 80, 40, 140
};

// 52 Неон (Неон)
DEFINE_GRADIENT_PALETTE(NeonNight_gp){
    0, 255, 0, 140,
    85, 120, 0, 255,
    170, 0, 220, 255,
    255, 255, 0, 140
};

// 53 Синтвейв (Неон)
DEFINE_GRADIENT_PALETTE(Synthwave_gp){
    0, 255, 40, 160,
    70, 160, 30, 255,
    140, 30, 60, 255,
    200, 0, 230, 230,
    255, 255, 40, 160
};

// 54 Токсик (Неон)
DEFINE_GRADIENT_PALETTE(Toxic_gp){
    0, 150, 255, 0,
    90, 0, 200, 60,
    170, 0, 60, 20,
    220, 60, 230, 20,
    255, 150, 255, 0
};

// 55 Электрик (Неон)
DEFINE_GRADIENT_PALETTE(Electric_gp){
    0, 0, 60, 255,
    80, 0, 220, 255,
    140, 255, 255, 255,
    200, 0, 150, 255,
    255, 0, 60, 255
};

// 56 Леденец (Неон)
DEFINE_GRADIENT_PALETTE(Candy_gp){
    0, 255, 60, 160,
    64, 255, 200, 40,
    128, 60, 230, 200,
    192, 170, 90, 255,
    255, 255, 60, 160
};

// 57 Лазер (Неон)
DEFINE_GRADIENT_PALETTE(Laser_gp){
    0, 255, 20, 20,
    64, 255, 20, 200,
    128, 20, 60, 255,
    192, 20, 255, 120,
    255, 255, 20, 20
};

// 58 Ультрафиолет (Неон)
DEFINE_GRADIENT_PALETTE(Ultraviolet_gp){
    0, 90, 0, 200,
    100, 200, 30, 255,
    170, 255, 120, 255,
    255, 90, 0, 200
};

// 59 Лён (Спокойные)
DEFINE_GRADIENT_PALETTE(Linen_gp){
    0, 235, 215, 185,
    100, 215, 175, 140,
    190, 190, 200, 200,
    255, 235, 215, 185
};

// 60 Дымка (Спокойные)
DEFINE_GRADIENT_PALETTE(DuskMist_gp){
    0, 120, 110, 150,
    100, 160, 140, 170,
    190, 110, 130, 160,
    255, 120, 110, 150
};

static const TProgmemRGBPalette16 WoodFireColors_p PROGMEM = {CRGB::Black, 0x330e00, 0x661c00, 0x992900, 0xcc3700, CRGB::OrangeRed, 0xff5800, 0xff6b00, 0xff7f00, 0xff9200, CRGB::Orange, 0xffaf00, 0xffb900, 0xffc300, 0xffcd00, CRGB::Gold};             //* рыжий
static const TProgmemRGBPalette16 NormalFire_p PROGMEM = {CRGB::Black, 0x330000, 0x660000, 0x990000, 0xcc0000, CRGB::Red, 0xff0c00, 0xff1800, 0xff2400, 0xff3000, 0xff3c00, 0xff4800, 0xff5400, 0xff6000, 0xff6c00, 0xff7800};                             // красный
static const TProgmemRGBPalette16 LithiumFireColors_p PROGMEM = {CRGB::Black, 0x240707, 0x470e0e, 0x6b1414, 0x8e1b1b, CRGB::FireBrick, 0xc14244, 0xd16166, 0xe08187, 0xf0a0a9, CRGB::Pink, 0xff9ec0, 0xff7bb5, 0xff59a9, 0xff369e, CRGB::DeepPink};        //* пастель
static const TProgmemRGBPalette16 SodiumFireColors_p PROGMEM = {CRGB::Black, 0x332100, 0x664200, 0x996300, 0xcc8400, CRGB::Orange, 0xffaf00, 0xffb900, 0xffc300, 0xffcd00, CRGB::Gold, 0xf8cd06, 0xf0c30d, 0xe9b913, 0xe1af1a, CRGB::Goldenrod};           //* Yellow
static const TProgmemRGBPalette16 CopperFireColors_p PROGMEM = {CRGB::Black, 0x001a00, 0x003300, 0x004d00, 0x006600, CRGB::Green, 0x239909, 0x45b313, 0x68cc1c, 0x8ae626, CRGB::GreenYellow, 0x94f530, 0x7ceb30, 0x63e131, 0x4bd731, CRGB::LimeGreen};     //* Green
static const TProgmemRGBPalette16 AlcoholFireColors_p PROGMEM = {CRGB::Black, 0x000033, 0x000066, 0x000099, 0x0000cc, CRGB::Blue, 0x0026ff, 0x004cff, 0x0073ff, 0x0099ff, CRGB::DeepSkyBlue, 0x1bc2fe, 0x36c5fd, 0x51c8fc, 0x6ccbfb, CRGB::LightSkyBlue};  //* Blue

// a palette in flash: 16 colours or a gradient
struct PalRef {
    const void* p;
    bool grad;
    constexpr PalRef() : p(nullptr), grad(false) {}
    constexpr PalRef(const TProgmemRGBPalette16& c) : p(c), grad(false) {}
    constexpr PalRef(TProgmemRGBGradientPalette_bytes g) : p(g), grad(true) {}
};

// FastLED's own palettes (colorpalettes.cpp, the same colours), copied into flash: its copies would sit in RAM.
// In a namespace of their own, so paletteArr below takes these and not FastLED's
namespace pal {
static const TProgmemRGBPalette16 CloudColors_p PROGMEM = {CRGB::Blue, CRGB::DarkBlue, CRGB::DarkBlue, CRGB::DarkBlue, CRGB::DarkBlue, CRGB::DarkBlue, CRGB::DarkBlue, CRGB::DarkBlue, CRGB::Blue, CRGB::DarkBlue, CRGB::SkyBlue, CRGB::SkyBlue, CRGB::LightBlue, CRGB::White, CRGB::LightBlue, CRGB::SkyBlue};
static const TProgmemRGBPalette16 LavaColors_p PROGMEM = {CRGB::Black, CRGB::Maroon, CRGB::Black, CRGB::Maroon, CRGB::DarkRed, CRGB::DarkRed, CRGB::Maroon, CRGB::DarkRed, CRGB::DarkRed, CRGB::DarkRed, CRGB::Red, CRGB::Orange, CRGB::White, CRGB::Orange, CRGB::Red, CRGB::DarkRed};
static const TProgmemRGBPalette16 OceanColors_p PROGMEM = {CRGB::MidnightBlue, CRGB::DarkBlue, CRGB::MidnightBlue, CRGB::Navy, CRGB::DarkBlue, CRGB::MediumBlue, CRGB::SeaGreen, CRGB::Teal, CRGB::CadetBlue, CRGB::Blue, CRGB::DarkCyan, CRGB::CornflowerBlue, CRGB::Aquamarine, CRGB::SeaGreen, CRGB::Aqua, CRGB::LightSkyBlue};
static const TProgmemRGBPalette16 ForestColors_p PROGMEM = {CRGB::DarkGreen, CRGB::DarkGreen, CRGB::DarkOliveGreen, CRGB::DarkGreen, CRGB::Green, CRGB::ForestGreen, CRGB::OliveDrab, CRGB::Green, CRGB::SeaGreen, CRGB::MediumAquamarine, CRGB::LimeGreen, CRGB::YellowGreen, CRGB::LightGreen, CRGB::LawnGreen, CRGB::MediumAquamarine, CRGB::ForestGreen};
static const TProgmemRGBPalette16 RainbowColors_p PROGMEM = {0xFF0000, 0xD52A00, 0xAB5500, 0xAB7F00, 0xABAB00, 0x56D500, 0x00FF00, 0x00D52A, 0x00AB55, 0x0056AA, 0x0000FF, 0x2A00D5, 0x5500AB, 0x7F0081, 0xAB0055, 0xD5002B};
static const TProgmemRGBPalette16 RainbowStripeColors_p PROGMEM = {0xFF0000, 0x000000, 0xAB5500, 0x000000, 0xABAB00, 0x000000, 0x00FF00, 0x000000, 0x00AB55, 0x000000, 0x0000FF, 0x000000, 0x5500AB, 0x000000, 0xAB0055, 0x000000};
static const TProgmemRGBPalette16 PartyColors_p PROGMEM = {0x5500AB, 0x84007C, 0xB5004B, 0xE5001B, 0xE81700, 0xB84700, 0xAB7700, 0xABAB00, 0xAB5500, 0xDD2200, 0xF2000E, 0xC2003E, 0x8F0071, 0x5F00A1, 0x2F00D0, 0x0007F9};
static const TProgmemRGBPalette16 HeatColors_p PROGMEM = {0x000000, 0x330000, 0x660000, 0x990000, 0xCC0000, 0xFF0000, 0xFF3300, 0xFF6600, 0xFF9900, 0xFFCC00, 0xFFFF00, 0xFFFF33, 0xFFFF66, 0xFFFF99, 0xFFFFCC, 0xFFFFFF};

static const PalRef PROGMEM paletteArr[] = {
    HeatColors_p,
    Fire_gp,
    WoodFireColors_p,
    NormalFire_p,
    LithiumFireColors_p,
    SodiumFireColors_p,
    CopperFireColors_p,
    AlcoholFireColors_p,
    LavaColors_p,
    PartyColors_p,
    RainbowColors_p,
    RainbowStripeColors_p,
    CloudColors_p,
    OceanColors_p,
    ForestColors_p,
    Sunset_Real_gp,
    dkbluered_gp,
    Optimus_Prime_gp,
    warmGrad_gp,
    coldGrad_gp,
    hotGrad_gp,
    pinkGrad_gp,
    comfy_gp,
    cyperpunk_gp,
    girl_gp,
    xmas_gp,
    acid_gp,
    blueSmoke_gp,
    gummy_gp,
    leo_gp,
    aurora_gp,
    Amber_gp,
    Candle_gp,
    Terracotta_gp,
    PeachFizz_gp,
    Coral_gp,
    Honey_gp,
    Embers_gp,
    Pacifica_gp,
    PacificaDeep_gp,
    IceTwinkle_gp,
    Glacier_gp,
    Lagoon_gp,
    Twilight_gp,
    Moonlight_gp,
    Meadow_gp,
    Moss_gp,
    Autumn_gp,
    Sakura_gp,
    Dunes_gp,
    Tropics_gp,
    Dawn_gp,
    NeonNight_gp,
    Synthwave_gp,
    Toxic_gp,
    Electric_gp,
    Candy_gp,
    Laser_gp,
    Ultraviolet_gp,
    Linen_gp,
    DuskMist_gp,
};
}  // namespace pal

#define PAL_COUNT (sizeof(pal::paletteArr) / sizeof(pal::paletteArr[0]))

static const char PROGMEM paletteList[] =
    "HeatColors;"
    "Fire;"
    "WoodFireColors;"
    "NormalFire;"
    "LithiumFireColors;"
    "SodiumFireColors;"
    "CopperFireColors;"
    "AlcoholFireColors;"
    "LavaColors;"
    "PartyColors;"
    "RainbowColors;"
    "RainbowStripeColors;"
    "CloudColors;"
    "OceanColors;"
    "ForestColors;"
    "Sunset_Real;"
    "Dkbluered;"
    "OptimusPrime;"
    "WarmGrad;"
    "ColdGrad;"
    "HotGrad;"
    "PinkGrad;"
    "Comfy;"
    "Cyperpunk;"
    "Girl;"
    "Xmas;"
    "Acid;"
    "BlueSmoke;"
    "Gummy;"
    "Leo;"
    "Aurora;"
    "Amber;"
    "Candle;"
    "Terracotta;"
    "PeachFizz;"
    "Coral;"
    "Honey;"
    "Embers;"
    "Pacifica;"
    "PacificaDeep;"
    "IceTwinkle;"
    "Glacier;"
    "Lagoon;"
    "Twilight;"
    "Moonlight;"
    "Meadow;"
    "Moss;"
    "Autumn;"
    "Sakura;"
    "Dunes;"
    "Tropics;"
    "Dawn;"
    "NeonNight;"
    "Synthwave;"
    "Toxic;"
    "Electric;"
    "Candy;"
    "Laser;"
    "Ultraviolet;"
    "Linen;"
    "DuskMist";

const __FlashStringHelper* getPaletteList() {
    return FPSTR(paletteList);
}

// https://github.com/FastLED/FastLED/issues/1014
// https://github.com/FastLED/FastLED/pull/202
static CRGB ColorFromPalette16(const CRGBPalette16 &pal, uint16_t index, uint8_t brightness, TBlendType blendType) {
    // This fucnction has the same intuitive behavior as the other ColorFromPalette
    // functions, except it provides 8-bit interpolation between palette entries.

    // Extract the four most significant bits of the index as a palette index.
    uint8_t index_4bit = (index >> 12);

    // Calculate the 8-bit offset from the palette index.
    // Throws away the 4 least significant bits and uses the middle 8.
    uint8_t offset = (uint8_t)(index >> 4);

    // Get the palette entry from the 4-bit index
    //  CRGB rgb1 = pal[ hi4];
    const CRGB *entry = &(pal[0]) + index_4bit;
    uint8_t red1 = entry->red;
    uint8_t green1 = entry->green;
    uint8_t blue1 = entry->blue;

    uint8_t blend = offset && (blendType != NOBLEND);

    if (blend) {
        // If palette blending is enabled, use the offset to interpolate between
        // the selected palette entry and the next.

        if (index_4bit == 15) entry = &(pal[0]);
        else entry++;

        // Calculate the scaling factor and scaled values for the lower palette value.

        uint8_t f1 = 255 - offset;

        red1 = scale8_LEAVING_R1_DIRTY(red1, f1);
        green1 = scale8_LEAVING_R1_DIRTY(green1, f1);
        blue1 = scale8_LEAVING_R1_DIRTY(blue1, f1);

        // Calculate the scaled values for the neighboring palette value.
        uint8_t red2 = entry->red;
        uint8_t green2 = entry->green;
        uint8_t blue2 = entry->blue;
        red2 = scale8_LEAVING_R1_DIRTY(red2, offset);
        green2 = scale8_LEAVING_R1_DIRTY(green2, offset);
        blue2 = scale8_LEAVING_R1_DIRTY(blue2, offset);

        cleanup_R1();

        // This was overflowing so I've updated it using qadd8
        red1 = qadd8(red1, red2);
        green1 = qadd8(green1, green2);
        blue1 = qadd8(blue1, blue2);
    }

    if (brightness != 255) nscale8x3_video(red1, green1, blue1, brightness);
    return CRGB(red1, green1, blue1);
}

// the chosen palette in RAM: made when back_pal changes, and at the first frame after boot
static CRGBPalette16 pal_ram;
static uint8_t pal_cur = 255;

// the longest gradient has 31 entries; a longer one is cut here, its last entry made the end
#define GRAD_MAX 32

// FastLED reads a palette with plain pointer loads (FASTLED_USE_PROGMEM 0), and GCC may turn them into byte loads:
// a gradient's entry count became l8ui from flash, a LoadStoreError (KAIA-186). So the palette is copied out of
// flash with memcpy_P and pgm_read_byte first, and FastLED reads the copy on the stack
static void __attribute__((noinline)) loadPalette(const PalRef& r) {
    uint32_t buf[GRAD_MAX];
    if (r.grad) {
        const uint8_t* p = (const uint8_t*)r.p;
        uint8_t n = 1;
        while (n < GRAD_MAX && pgm_read_byte(p + (n - 1) * 4) != 255) n++;
        memcpy_P(buf, p, n * 4);
        ((uint8_t*)buf)[(n - 1) * 4] = 255;
        pal_ram.loadDynamicGradientPalette((TDynamicRGBGradientPalette_bytes)buf);
    } else {
        memcpy_P(buf, r.p, sizeof(TProgmemRGBPalette16));
        pal_ram = *(const TProgmemRGBPalette16*)buf;
    }
}

static const CRGBPalette16& usePalette(uint8_t pal) {
    if (pal >= PAL_COUNT) pal = 0;  // out of range reads as the first
    if (pal != pal_cur) {
        PalRef r;
        memcpy_P(&r, &pal::paletteArr[pal], sizeof(r));
        loadPalette(r);
        pal_cur = pal;
    }
    return pal_ram;
}

uint32_t getPaletteColor(uint8_t pal, uint16_t idx, uint8_t bright) {
    return uint32_t(ColorFromPalette16(usePalette(pal), idx, bright, LINEARBLEND));
}