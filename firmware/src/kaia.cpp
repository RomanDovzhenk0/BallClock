#include "kaia.h"

#include <FastLED.h>
#include <GyverNTP.h>
#include <RunningGFX.h>

#include "config.h"
#include "matrix.h"
#include "redraw.h"
#include "settings.h"

// K.A.I.A.'s display (the API block of the BallClock design, the animations of the KAIA-148 mockups):
// a state underneath (listening, thinking, speaking) or a one-shot on top (wake, done, error, notify)
// or a running text, drawn after the clock every 50 ms. Only RAM: gone after its time or a reboot.

#define KAIA_TEXT_CHARS 120
#define KAIA_TEXT_BYTES 360  // 120 characters of up to 3 bytes in UTF-8
#define KAIA_STATE_MS 30000  // a state's safety net when Kaya is gone

#define C_WHITE 0xffffff
#define C_VIOLET 0x965aff
#define C_GREEN 0x35e07a
#define C_RED 0xff3b30
#define C_AMBER 0xffb020

enum Anim : uint8_t {
    A_WAKE,
    A_LISTENING,
    A_THINKING,
    A_SPEAKING,
    A_DONE,
    A_ERROR,
    A_NOTIFY,
    A_OFF,
    A_COUNT,
};

static const char anim_names[A_COUNT][10] PROGMEM = {"wake", "listening", "thinking", "speaking", "done", "error", "notify", "off"};

// one-shot lengths, ms: wake, done, error, notify; per style (kaia_anim 1 ripple, 2 orbit, 3 sparks)
static const uint16_t shot_ms[3][4] = {
    {1900, 1200, 1400, 1600},
    {2000, 1400, 1400, 1500},
    {2000, 1300, 1400, 1600},
};

enum Mode : uint8_t {
    M_NONE,
    M_SHOT,
    M_STATE,
    M_TEXT,
};

static struct {
    Mode mode = M_NONE;
    Anim anim = A_OFF;
    uint8_t style = 1;         // kaia_anim at the call
    uint32_t start = 0;        // millis() at the start
    uint32_t ms = 0;           // a state's length (and the listening after wake)
    uint32_t color = 0;        // the call's colour
    bool own_color = false;    // the call gave one
    bool text_waits = false;   // a text waits for the one-shot to end
    uint8_t duck = 0;          // 0..255: how far the background stepped back
} ov;

static struct {
    char str[KAIA_TEXT_BYTES + 1];
    uint32_t color;
    bool own_color;
    uint8_t speed;
    uint8_t repeat;
    uint8_t passes;
    uint32_t steps;
} txt;

// per frame
static struct {
    uint8_t sc;  // the overlay's strength: kaia_bright, dimmer at night
    uint8_t dg;  // what of it the digit balls keep
} fr;

// ================= ball tables, from the real layout at boot =================

#define SPARKS 18
#define SPARK_LEN 12

static uint8_t b_dist[MX_LED_AMOUNT];  // distance from the centre in quarter-balls, 0..38
static uint8_t b_ang[MX_LED_AMOUNT];   // angle 0..255 clockwise from 12 o'clock
static uint8_t b_pos[MX_LED_AMOUNT];   // place in its ring, clockwise from 12 o'clock
static uint8_t b_meta[MX_LED_AMOUNT];  // bits 0-1 ring (0 = the rim, 3 = the middle row), 2-3 lens of the mark, 4-6 voice arc
static uint8_t ring_len[4];
static uint8_t track[32], track_len;      // the halo of the mark, clockwise
static uint8_t spark[SPARKS][SPARK_LEN];  // rim → centre, 255 = end

static inline uint8_t ringOf(uint8_t i) {
    return b_meta[i] & 3;
}
static inline uint8_t lensOf(uint8_t i) {
    return (b_meta[i] >> 2) & 3;
}
static inline uint8_t arcOf(uint8_t i) {
    return b_meta[i] >> 4;
}

static void buildTables() {
    struct Ball {
        float x, y, a;
        int8_t ring;
    };
    Ball* b = new Ball[MX_LED_AMOUNT];
    const float S3 = 0.8660254f, CX = 9.5f, CY = 3 * S3;  // in balls; the centre of the hexagon

    for (int y = 0; y < MX_DIAG_H; y++) {
        for (int x = 0; x < MX_DIAG_W; x++) {
            int i = matrix.ledDiag(x, y);
            if (i < 0) continue;
            b[i].x = (2 * x + 3 - y) / 2.0f;
            b[i].y = y * S3;
        }
    }

    for (int i = 0; i < MX_LED_AMOUNT; i++) {
        float ex = b[i].x - CX, ey = b[i].y - CY;
        b_dist[i] = lroundf(sqrtf(ex * ex + ey * ey) * 4);
        float a = atan2f(ex, -ey) / (2 * PI);
        if (a < 0) a += 1;
        b[i].a = a;
        b_ang[i] = lroundf(a * 256) & 255;

        uint8_t nbr = 0;
        for (int j = 0; j < MX_LED_AMOUNT; j++) {
            float dx = b[i].x - b[j].x, dy = b[i].y - b[j].y;
            if (i != j && dx * dx + dy * dy < 1.1025f) nbr++;
        }
        b[i].ring = nbr < 6 ? 0 : -1;
    }

    // rings from the rim inwards
    for (int r = 0; r < 3; r++) {
        for (int i = 0; i < MX_LED_AMOUNT; i++) {
            if (b[i].ring != r) continue;
            for (int j = 0; j < MX_LED_AMOUNT; j++) {
                float dx = b[i].x - b[j].x, dy = b[i].y - b[j].y;
                if (b[j].ring < 0 && dx * dx + dy * dy < 1.1025f) b[j].ring = r + 1;
            }
        }
    }

    memset(ring_len, 0, sizeof(ring_len));
    track_len = 0;
    for (int i = 0; i < MX_LED_AMOUNT; i++) {
        uint8_t r = b[i].ring < 0 ? 3 : b[i].ring;
        uint8_t pos = 0;
        for (int j = 0; j < MX_LED_AMOUNT; j++) {
            uint8_t rj = b[j].ring < 0 ? 3 : b[j].ring;
            if (rj == r && (b[j].a < b[i].a || (b[j].a == b[i].a && j < i))) pos++;
        }
        b_pos[i] = pos;
        ring_len[r]++;

        float m = b[i].a < 0.5f ? b[i].a * 2 : (1 - b[i].a) * 2;
        uint8_t arc = m < 5 / 6.0f ? (uint8_t)(m * 6) : 5;

        float lx = (b[i].x - CX) / 2.6f, ly = (b[i].y - CY) / 3.6f, e = lx * lx + ly * ly;
        uint8_t lens = e < 0.2f ? 3 : e < 0.55f ? 2 : e < 1 ? 1 : 0;

        b_meta[i] = r | (lens << 2) | (arc << 4);
    }

    for (int i = 0; i < MX_LED_AMOUNT; i++) {
        if (lensOf(i) != 1) continue;
        uint8_t pos = 0;
        for (int j = 0; j < MX_LED_AMOUNT; j++) {
            if (lensOf(j) == 1 && (b[j].a < b[i].a || (b[j].a == b[i].a && j < i))) pos++;
        }
        if (pos < sizeof(track)) track[pos] = i;
        track_len++;
    }
    if (track_len > sizeof(track)) track_len = sizeof(track);

    // sparks: 18 rim balls, each with the balls on the straight line to the centre
    memset(spark, 255, sizeof(spark));
    for (int k = 0; k < SPARKS; k++) {
        float ta = (float)k / SPARKS, best = 9;
        int s = 0;
        for (int i = 0; i < MX_LED_AMOUNT; i++) {
            if (ringOf(i)) continue;
            float d = b[i].a - ta + 0.5f;
            d = fabsf(d - floorf(d) - 0.5f);
            if (d < best) best = d, s = i;
        }

        uint8_t len = 0;
        spark[k][len++] = s;
        float sx = b[s].x, sy = b[s].y;
        int steps = ceilf(sqrtf((sx - CX) * (sx - CX) + (sy - CY) * (sy - CY)) / 0.5f);
        for (int q = 1; q <= steps && len < SPARK_LEN; q++) {
            float px = sx + (CX - sx) * q / steps, py = sy + (CY - sy) * q / steps, bd = 1e9f;
            int bi = 0;
            for (int i = 0; i < MX_LED_AMOUNT; i++) {
                float dx = b[i].x - px, dy = b[i].y - py, d = dx * dx + dy * dy;
                if (d < bd) bd = d, bi = i;
            }
            if (bd < 0.36f && bi != spark[k][len - 1]) spark[k][len++] = bi;
        }
    }

    delete[] b;
}

// ================= maths, integers only inside a frame =================

static inline int imax(int a, int b) {
    return a > b ? a : b;
}
static inline int imin(int a, int b) {
    return a < b ? a : b;
}
static inline int posMod(int a, int p) {
    a %= p;
    return a < 0 ? a + p : a;
}

// 255 at x = 0, falling to 0 at |x| = w
static int tent(int x, int w) {
    if (x < 0) x = -x;
    return x >= w ? 0 : (w - x) * 255 / w;
}

// smoothstep from a to b (either way round), 0..255
static int smooth(int a, int b, int x) {
    int u = (x - a) * 255 / (b - a);
    if (u < 0) u = 0;
    if (u > 255) u = 255;
    return u * u * (765 - 2 * u) / 65025;
}

// sine of t ms at w (256 = a turn) per second, -128..127
static inline int wave(int t, int w) {
    return (int)sin8((uint8_t)(t * w / 1000)) - 128;
}

// pseudo-voice 0..255 (the API carries no level)
static int voice(int t) {
    int g = wave(t, 110) * 408 / 128 + 128;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    uint8_t ph = t * 469 / 1000 + wave(t, 86) * 41 / 128;
    int v = abs((int)sin8(ph) - 128) * 2;
    return imin(255, v * (77 + 178 * g / 255) / 255 * 115 / 100);
}

// a comet on a ring of n balls, head at h (1/256 ball), clockwise (or back): 255 at the head, (1 - d/tail)² behind
static int comet(uint8_t pos, int h, uint8_t n, int tail, bool back = false) {
    int d = back ? posMod(pos * 256 - h, n * 256) : posMod(h - pos * 256, n * 256);
    if (d >= tail) return 0;
    int u = (tail - d) * 255 / tail;
    return u * u / 255;
}

static uint32_t mix(uint32_t a, uint32_t b, int k) {
    uint32_t out = 0;
    for (uint8_t s = 0; s <= 16; s += 8) {
        int ca = (a >> s) & 0xff, cb = (b >> s) & 0xff;
        out |= (uint32_t)(ca + (cb - ca) * k / 255) << s;
    }
    return out;
}

static inline uint32_t dim(uint32_t c, int k) {
    return mix(0, c, k);
}

// blend one ball towards the colour by a (0..255)
static void put(uint8_t i, uint32_t color, int a) {
    if (a <= 0) return;
    if (a > 255) a = 255;
    a = a * fr.sc / 255;
    if (matrix.marked(i)) a = a * fr.dg / 255;
    if (a) matrix.setLED(i, mix(matrix.getLED(i), color, a));
}

// the clock and the background step back to k / 255
static void dimAll(int k) {
    if (k >= 255) return;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) matrix.setLED(i, dim(matrix.getLED(i), k));
}

// ================= 1: ripple from the centre =================

static void rippleState(Anim n, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t c = n == A_THINKING ? mix(col, C_VIOLET, 128) : col;
    int r = 640 - posMod(t * 2464 / 1000, 640);  // listening: a ring moving in, 1/16 quarter-ball
    int edge = 36 + wave(t, 98) * 20 / 128;

    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int d = b_dist[i], a;
        switch (n) {
            case A_LISTENING:
                a = 166 * tent(d * 16 - r, 96) / 255 * (115 + 140 * r / 640) / 255;
                if (d >= 33) a += edge;
                break;

            case A_THINKING: {  // a slow three-armed swirl
                int w = sin8((uint8_t)(d * 163 / 8 - t * 171 / 1000));
                int s = 140 + 115 * sin8((uint8_t)(b_ang[i] * 3 + t * 94 / 1000)) / 255;
                a = 166 * (w * w / 255) / 255 * s / 255;
            } break;

            default:  // speaking: rings going out with the voice
                a = 158 * voice(t - d * 385 / 10) / 255 * (832 - d * 16) / 832 + (d >= 33 ? 18 : 0);
                break;
        }
        put(i, c, a * k / 255);
    }
}

static void rippleShot(Anim n, int t, int du, uint32_t col) {
    int fade = smooth(du, du - 300, t);
    fr.dg = 153;

    switch (n) {
        case A_WAKE: {  // 3 rings out and a white-ish flash, then listening fades in
            int fl = t < 350 ? 255 - t * 255 / 350 : 0;
            uint32_t c = mix(col, C_WHITE, fl * 179 / 255);
            int r[3], f[3];
            for (int k = 0; k < 3; k++) {
                int rt = t - 220 * k;
                r[k] = rt * 544 / 1000;
                f[k] = rt > 0 ? imax(0, 832 - r[k]) * 255 / 832 : 0;
            }
            for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
                int d = b_dist[i] * 16, a = fl * tent(d, 176) / 255;
                for (int k = 0; k < 3; k++) {
                    if (f[k]) a = imax(a, tent(d - r[k], 88) * f[k] / 255);
                }
                put(i, c, a * 242 / 255);
            }
            rippleState(A_LISTENING, t - du, col, smooth(1100, du, t));
        } break;

        case A_DONE: {  // one ring out
            int r = t * 704 / 1000, fr_ = imax(0, 960 - r) * 255 / 960, base = imax(0, 1200 - t) * 77 / 1200;
            for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
                put(i, col, imin(255, tent(b_dist[i] * 16 - r, 104) * fr_ / 255 + base) * fade / 255);
            }
        } break;

        case A_ERROR: {  // two thumps
            fr.dg = 128;
            int q = t < 450 ? t : t - 450, r = q * 480 / 1000;
            int p = 255 * expf(-6 * q / 1000.0f);
            for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
                put(i, col, imin(255, 140 * p / 255 + 230 * tent(b_dist[i] * 16 - r, 80) / 255 * p / 255) * fade / 255);
            }
        } break;

        default: {  // notify: two rings and an edge flash
            fr.dg = 128;
            int r1 = t * 480 / 1000, r2 = (t - 550) * 480 / 1000;
            int f1 = imax(0, 960 - r1) * 255 / 960, f2 = t > 550 ? imax(0, 960 - r2) * 255 / 960 : 0;
            int fl = (t > 950 && t < 1500) ? 217 * imax(0, wave(t - 950, 733)) / 128 : 0;
            for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
                int d = b_dist[i] * 16;
                int a = imax(tent(d - r1, 96) * f1 / 255, tent(d - r2, 96) * f2 / 255) * 230 / 255;
                if (b_dist[i] >= 33) a = imax(a, fl);
                put(i, col, a * fade / 255);
            }
        } break;
    }
}

// ================= 2: orbit round the edge =================

static void orbitState(Anim n, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t c = n == A_THINKING ? mix(col, C_VIOLET, 128) : col;
    uint8_t n0 = ring_len[0], n1 = ring_len[1];

    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        uint8_t r = ringOf(i);
        if (r > 1) continue;
        int a = 0;
        switch (n) {
            case A_LISTENING:  // one calm comet
                if (!r) a = 41 + wave(t, 90) * 15 / 128 + 217 * comet(b_pos[i], t * 1664 / 1000, n0, 14 * 256) / 255;
                break;

            case A_THINKING:  // three comets and a counter-rotating one inside
                if (!r) {
                    int h = t * 5632 / 1000, m = 0;
                    for (int q = 0; q < 3; q++) m = imax(m, comet(b_pos[i], h + q * n0 * 256 / 3, n0, 9 * 256));
                    a = 26 + 230 * m / 255;
                } else {
                    a = 20 + 153 * comet(b_pos[i], -t * 4096 / 1000, n1, 7 * 256, true) / 255;
                }
                break;

            default: {  // speaking: the voice runs down the rim from the top
                int e = voice(t - arcOf(i) * 190);
                e = e * e / 255;
                a = r ? 8 + 77 * e / 255 : 20 + 217 * e / 255;
            } break;
        }
        put(i, c, a * k / 255);
    }
}

static void orbitShot(Anim n, int t, int du, uint32_t col) {
    int fade = smooth(du, du - 300, t);
    uint8_t n0 = ring_len[0];
    fr.dg = 153;

    switch (n) {
        case A_WAKE: {  // a comet speeds up round the rim, then the rings close like an iris
            float tc = imin(t, 1100) / 1000.0f;
            int h = (6 * tc + 152.07f * tc * tc * tc / 3) * 256;
            int tail = (6 + 40 * tc / 1.1f) * 256;
            int u = smooth(1100, 1250, t), settle = 255 - 204 * smooth(1200, 1800, t) / 255;
            uint32_t c = mix(col, C_WHITE, 102 * tent(t - 1100, 250) / 255);
            for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
                uint8_t r = ringOf(i);
                int a = 0;
                if (!r) {
                    a = 26 + 230 * comet(b_pos[i], h, n0, tail) / 255;
                    if (t >= 1100) a = a * (255 - u) / 255 + u * settle / 255;
                } else if (t > 1100) {
                    a = 217 * tent(t - (1100 + 150 * r), 220) / 255;
                }
                put(i, c, a);
            }
            orbitState(A_LISTENING, t - du, col, smooth(1500, du, t));
        } break;

        case A_DONE: {  // the rim fills clockwise from 12
            int prog = smooth(0, 700, t) * n0 * 256 / 255, flash = 102 * tent(t - 850, 220) / 255;
            for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
                uint8_t r = ringOf(i);
                int a = 0, p = b_pos[i] * 256;
                if (!r) a = p < prog ? (p > prog - 768 ? 255 : 153) : 20;
                else if (r == 1) a = flash;
                put(i, col, a * fade / 255);
            }
        } break;

        case A_ERROR: {  // three blinks
            bool on = t < 1200 && t % 400 < 220;
            static const uint8_t lit[4] = {242, 102, 51, 0};
            for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
                uint8_t r = ringOf(i);
                put(i, col, (on ? lit[r] : r ? 0 : 13) * fade / 255);
            }
        } break;

        default: {  // notify: two comets meet at 6 o'clock, then the rim flashes
            int h = t * 8704 / 1000;
            int fl = 242 * tent(t - 650, 300) / 255 + 46, f1 = t > 600 ? 153 * tent(t - 700, 300) / 255 : 0;
            for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
                uint8_t r = ringOf(i);
                int a = 0;
                if (!r) {
                    a = imax(comet(b_pos[i], h, n0, 12 * 256), comet(b_pos[i], -h, n0, 12 * 256, true));
                    a = imax(a, t > 650 ? fl : 20);
                } else if (r == 1) {
                    a = f1;
                }
                put(i, col, a * fade / 255);
            }
        } break;
    }
}

// ================= 3: sparks gather into a mark =================

static const uint8_t lens_w[4] = {0, 128, 204, 255};

// pictograms: one row per entry, the leftmost pixel is the highest bit
static const uint16_t pict_check[5] = {0x003, 0x006, 0x10c, 0x198, 0x0f0};  // 9 wide
static const uint16_t pict_cross[5] = {0x63, 0x36, 0x1c, 0x36, 0x63};       // 7 wide
static const uint16_t pict_bell[5] = {0x1c, 0x3e, 0x3e, 0x7f, 0x08};        // 7 wide

static void mark(uint32_t col, int g, int white) {
    uint32_t c = white ? mix(col, C_WHITE, white) : col;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        uint8_t l = lensOf(i);
        if (l) put(i, c, lens_w[l] * g / 255);
    }
}

// drawn like a clock glyph: pixel (gx, gy) → (x0 + gx + gy / 2, 1 + gy) in the diagonal grid
static void pict(const uint16_t* rows, uint8_t w, uint32_t col, int a, int dx) {
    int x0 = (194 - 10 * w) / 20 + dx;
    for (int gy = 0; gy < 5; gy++) {
        for (int gx = 0; gx < w; gx++) {
            if (!((rows[gy] >> (w - 1 - gx)) & 1)) continue;
            int led = matrix.ledDiag(x0 + gx + (gy >> 1), 1 + gy);
            if (led >= 0) put(led, col, a);
        }
    }
}

static void sparksState(Anim n, int t, uint32_t col) {
    fr.dg = 128;
    switch (n) {
        case A_LISTENING:  // the mark breathes
            mark(col, 77 + 128 * sin8((uint8_t)(t * 256 / 3000)) / 255, 0);
            break;

        case A_THINKING: {  // three sparks orbit it
            uint32_t c = mix(col, C_VIOLET, 128), sc = mix(c, C_WHITE, 102);
            mark(c, 77 + 64 * sin8((uint8_t)(t * 256 / 900)) / 255, 0);
            int nt = track_len;
            for (int m = 0; m < nt; m++) {
                int a = 0;
                for (int q = 0; q < 3; q++) {
                    int d = posMod(t * 9 * 256 / 1000 + q * nt * 256 / 3 - m * 256, nt * 256);
                    if (d < 1024) {
                        int u = (1024 - d) * 255 / 1024;
                        a = imax(a, u * u / 255);
                    }
                }
                put(track[m], sc, a * 242 / 255);
            }
        } break;

        default: {  // speaking: the mark opens ring by ring with the voice
            static const int16_t th[4] = {0, 140, 64, -3};  // halo, body, core
            int e = voice(t);
            for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
                uint8_t l = lensOf(i);
                if (l) put(i, col, lens_w[l] * ((l == 3 ? 77 : 0) + 179 * smooth(th[l], th[l] + 102, e) / 255) / 255);
            }
        } break;
    }
}

static void sparksShot(Anim n, int t, int du, uint32_t col) {
    int fade = smooth(du, du - 300, t);

    if (n == A_WAKE) {  // 18 sparks fly in from the rim, the mark pops and settles to listening
        static const uint8_t trail[4] = {255, 153, 77, 31};
        uint32_t sc = mix(col, C_WHITE, 128);
        int arrived = 0;
        fr.dg = 153;
        for (int k = 0; k < SPARKS; k++) {
            int u = t - 45 * ((k * 7) % SPARKS);
            if (u < 0) continue;
            if (u >= 750) {
                arrived++;
                continue;
            }
            int len = 0;
            while (len < SPARK_LEN && spark[k][len] != 255) len++;
            int j = powf(u / 750.0f, 1.6f) * len;
            for (int q = 0; q < 4 && j - q >= 0; q++) put(spark[k][j - q], sc, trail[q]);
        }
        if (t > 1500) {
            int r = (t - 1500) * 640 / 1000, f = imax(0, 800 - r) * 255 / 800;
            for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) put(i, col, 102 * tent(b_dist[i] * 16 - r, 80) / 255 * f / 255);
        }
        int end = 77 + 128 * sin8((uint8_t)((t - du) * 256 / 3000)) / 255;
        int g = t < 1500 ? 217 * arrived / SPARKS : 255 - (255 - end) * smooth(1600, du, t) / 255;
        mark(col, g, 204 * tent(t - 1550, 150) / 255);
        return;
    }

    // done, error, notify: a pictogram with the display to itself
    dimAll(255 - 224 * smooth(0, 150, t) / 255 * fade / 255);
    fr.dg = 255;
    switch (n) {
        case A_DONE:
            pict(pict_check, 9, col, smooth(0, 100, t) * fade / 255, 0);
            break;

        case A_ERROR:
            pict(pict_cross, 7, col, (t < 1200 && t % 400 < 240) ? fade : 0, 0);
            break;

        default: {  // the bell rings
            int s = t < 1300 ? wave(t, 815) : 0;
            pict(pict_bell, 7, col, smooth(0, 100, t) * fade / 255, s >= 107 ? 1 : s <= -107 ? -1 : 0);
        } break;
    }
}

// ================= running text =================

static RunningGFX& runner() {
    matrix.setModeDiag();  // the text runs in the diagonal grid, as the clock
    static RunningGFX run(matrix);
    return run;
}

static void startText(uint32_t now) {
    RunningGFX& run = runner();
    run.setFont(gfx_font_3x5);
    run.setWindow(0, MX_DIAG_W - 1, 1);
    run.useBackground(false);
    run.setText(txt.str);
    run.start();
    txt.passes = 0;
    txt.steps = 0;
    ov.mode = M_TEXT;
    ov.start = now;
    ov.text_waits = false;
}

static void drawText(uint32_t now, uint32_t color) {
    dimAll(46);
    RunningGFX& run = runner();
    run.setColor24(dim(color, fr.sc));

    // speed: steps a second, at most one a frame unless the frames are late
    uint32_t due = (now - ov.start) * txt.speed / 1000;
    uint8_t step = due > txt.steps ? imin(due - txt.steps, 3) : 0;
    txt.steps += step;
    run.setStep(step);
    if (run.tickManual(false) == RG_FINISH && ++txt.passes >= txt.repeat) ov.mode = M_NONE;
}

// ================= the frame =================

uint8_t kaiaBackScale() {
    return 255 - 140 * ov.duck / 255;
}

void kaiaDraw(bool night) {
    uint32_t now = millis();
    uint8_t rule = db[kk::kaia_night].toInt();
    uint8_t style = db[kk::kaia_anim].toInt();

    if (night && rule == 2) {  // at night: none
        ov.mode = M_NONE;
        ov.text_waits = false;
    }
    if (!style && (ov.mode == M_SHOT || ov.mode == M_STATE)) ov.mode = M_NONE;  // switched off in the settings

    if (ov.mode == M_SHOT) {
        uint32_t du = shot_ms[ov.style - 1][ov.anim == A_WAKE ? 0 : ov.anim - A_DONE + 1];
        if (now - ov.start >= du) {
            if (ov.text_waits) {
                startText(now);
            } else if (ov.anim == A_WAKE) {
                ov.mode = M_STATE;
                ov.anim = A_LISTENING;
                ov.start += du;
            } else {
                ov.mode = M_NONE;
            }
        }
    } else if (!style && ov.text_waits) {
        startText(now);
    }
    if (ov.mode == M_STATE && now - ov.start >= ov.ms) ov.mode = M_NONE;

    // the background eases back in about 0.25 s
    int target = ov.mode == M_NONE ? 0 : 255, step = (target - ov.duck) * 72 / 256;
    if (!step && target != ov.duck) step = target > ov.duck ? 1 : -1;
    ov.duck += step;

    if (ov.mode == M_NONE) return;

    fr.sc = (int)db[kk::kaia_bright].toInt() * (night && rule == 1 ? 77 : 255) / 255;
    fr.dg = 89;
    uint32_t kaya = db[kk::kaia_color].toInt32();

    if (ov.mode == M_TEXT) {
        drawText(now, txt.own_color ? txt.color : kaya);
        return;
    }

    int t = now - ov.start;
    uint32_t col = kaya;
    if (ov.own_color) col = ov.color;
    else if (ov.anim == A_DONE) col = C_GREEN;
    else if (ov.anim == A_ERROR) col = C_RED;
    else if (ov.anim == A_NOTIFY) col = C_AMBER;

    if (ov.mode == M_STATE) {
        switch (ov.style) {
            case 1: rippleState(ov.anim, t, col, 255); break;
            case 2: orbitState(ov.anim, t, col, 255); break;
            default: sparksState(ov.anim, t, col); break;
        }
    } else {
        int du = shot_ms[ov.style - 1][ov.anim == A_WAKE ? 0 : ov.anim - A_DONE + 1];
        switch (ov.style) {
            case 1: rippleShot(ov.anim, t, du, col); break;
            case 2: orbitShot(ov.anim, t, du, col); break;
            default: sparksShot(ov.anim, t, du, col); break;
        }
    }
}

// ================= HTTP: /kaia/state, /kaia/show, /kaia/anim =================

static KaiaServer* srv = nullptr;

// every setting but the Wi-Fi and the page password
static const char state_keys[] PROGMEM =
    "show_ip,ntp_gmt,ntp_host,bright,auto_bright,bright_min,bright_max,adc_min,adc_max,"
    "night_mode,night_mode_auto,night_mode_auto_since,night_mode_auto_to,night_color,night_trsh,"
    "clock_style,clock_style_zero,clock_color,back_mode,back_pal,back_speed,back_angle,back_scale,back_bright,"
    "kaia_anim,kaia_color,kaia_bright,kaia_night";

// as the settings page answers
static void reply(int code, const String& json) {
#ifndef SETS_NO_CORS
    srv->sendHeader(F("Access-Control-Allow-Origin"), F("*"));
    srv->sendHeader(F("Access-Control-Allow-Private-Network"), F("true"));
    srv->sendHeader(F("Access-Control-Allow-Methods"), F("*"));
#endif
    srv->send(code, "application/json", json);
}

static void replyError(int code, const __FlashStringHelper* error) {
    String s(F("{\"error\":\""));
    s += error;
    s += F("\"}");
    reply(code, s);
}

static void replyOk() {
    reply(200, F("{\"ok\":true}"));
}

// with a page password every call carries auth = the hex of its hash, as the settings page does
static bool authorized() {
    size_t passh = Text(db[kk::page_pass].toString()).hash();
    if (!passh || Text(srv->arg(F("auth"))).toInt32HEX() == passh) return true;
    replyError(401, F("unauthorized"));
    return false;
}

static void addString(String& s, const String& v) {
    s += '"';
    for (unsigned i = 0; i < v.length(); i++) {
        char c = v[i];
        if (c == '"' || c == '\\') s += '\\';
        s += (uint8_t)c < 0x20 ? ' ' : c;
    }
    s += '"';
}

// an absent argument keeps the default
static bool readNum(const __FlashStringHelper* name, long lo, long hi, long& out) {
    if (!srv->hasArg(name)) return true;
    String v = srv->arg(name);
    if (!v.length() || v.length() > 6) return false;
    for (unsigned i = 0; i < v.length(); i++) {
        if (!isDigit(v[i])) return false;
    }
    long n = v.toInt();
    if (n < lo || n > hi) return false;
    out = n;
    return true;
}

// RRGGBB (a leading # is allowed)
static bool readColor(uint32_t& out, bool& given) {
    given = false;
    if (!srv->hasArg(F("color"))) return true;
    String v = srv->arg(F("color"));
    if (v.length() && v[0] == '#') v.remove(0, 1);
    if (v.length() != 6) return false;
    for (unsigned i = 0; i < 6; i++) {
        if (!isHexadecimalDigit(v[i])) return false;
    }
    out = strtoul(v.c_str(), nullptr, 16);
    given = true;
    return true;
}

static uint16_t utf8Length(const String& s) {
    uint16_t n = 0;
    for (unsigned i = 0; i < s.length(); i++) {
        if (((uint8_t)s[i] & 0xc0) != 0x80) n++;
    }
    return n;
}

static void handleState() {
    if (!authorized()) return;

    String s;
    s.reserve(900);
    s += F("{\"name\":\"" PROJECT_NAME "\",\"version\":\"" PROJECT_VER "\",\"time\":\"");
    s += NTP.timeToString();
    s += F("\",\"synced\":");
    s += NTP.synced() ? F("true") : F("false");
    s += F(",\"rssi\":");
    s += WiFi.RSSI();
    s += F(",\"light\":");
    s += photo.getFilt();
    s += F(",\"bright\":");
    s += redrawBright();
    s += F(",\"night\":");
    s += redrawNight() ? F("true") : F("false");
    s += F(",\"overlay\":\"");
    s += ov.mode == M_TEXT ? F("text") : ov.mode == M_NONE ? F("none") : F("anim");
    s += F("\",\"anim\":");
    if (ov.mode == M_SHOT || ov.mode == M_STATE) {
        s += '"';
        s += FPSTR(anim_names[ov.anim]);
        s += '"';
    } else {
        s += F("null");
    }

    s += F(",\"settings\":{");
    char key[32];
    PGM_P p = state_keys;
    bool first = true;
    while (true) {
        uint8_t len = 0;
        char c;
        while ((c = pgm_read_byte(p++)) && c != ',') {
            if (len < sizeof(key) - 1) key[len++] = c;
        }
        key[len] = 0;

        if (!first) s += ',';
        first = false;
        s += '"';
        s += key;
        s += F("\":");

        gdb::Entry e = db.get(su::hash(key) & DB_HASH_MASK);
        switch (e.type()) {
            case gdb::Type::String: addString(s, e.toString()); break;
            case gdb::Type::Int:
            case gdb::Type::Uint:
            case gdb::Type::Int64:
            case gdb::Type::Uint64:
            case gdb::Type::Float: s += e.toString(); break;
            default: s += F("null"); break;
        }
        if (!c) break;
    }
    s += F("}}");
    reply(200, s);
}

static void handleShow() {
    if (!authorized()) return;

    String text = srv->arg(F("text"));
    if (!text.length()) return replyError(400, F("text is required"));
    if (text.length() > KAIA_TEXT_BYTES || utf8Length(text) > KAIA_TEXT_CHARS) return replyError(400, F("text: up to 120 characters"));

    uint32_t color = 0;
    bool own;
    long speed = 10, repeat = 1;
    if (!readColor(color, own)) return replyError(400, F("color: RRGGBB"));
    if (!readNum(F("speed"), 1, 20, speed)) return replyError(400, F("speed: 1-20"));
    if (!readNum(F("repeat"), 1, 5, repeat)) return replyError(400, F("repeat: 1-5"));

    memcpy(txt.str, text.c_str(), text.length() + 1);
    txt.color = color;
    txt.own_color = own;
    txt.speed = speed;
    txt.repeat = repeat;

    // a newer call replaces the one before; a text waits for a one-shot to end
    if (ov.mode == M_SHOT) ov.text_waits = true;
    else startText(millis());
    replyOk();
}

static void handleAnim() {
    if (!authorized()) return;

    String name = srv->arg(F("name"));
    int n = -1;
    for (int k = 0; k < A_COUNT; k++) {
        if (!strcmp_P(name.c_str(), anim_names[k])) n = k;
    }
    if (n < 0) return replyError(400, F("name: wake | listening | thinking | speaking | done | error | notify | off"));

    uint32_t color = 0;
    bool own;
    long ms = KAIA_STATE_MS;
    if (!readColor(color, own)) return replyError(400, F("color: RRGGBB"));
    if (!readNum(F("ms"), 100, 60000, ms)) return replyError(400, F("ms: 100-60000"));

    ov.text_waits = false;
    if (n == A_OFF) {
        ov.mode = M_NONE;
        return replyOk();
    }

    uint8_t style = db[kk::kaia_anim].toInt();
    if (style < 1 || style > 3) return replyOk();  // animations are off in the settings

    ov.anim = (Anim)n;
    ov.style = style;
    ov.mode = (n == A_LISTENING || n == A_THINKING || n == A_SPEAKING) ? M_STATE : M_SHOT;
    ov.start = millis();
    ov.ms = ms;
    ov.color = color;
    ov.own_color = own;
    replyOk();
}

void kaiaBegin(KaiaServer& server) {
    buildTables();

    srv = &server;
    server.on("/kaia/state", HTTP_GET, handleState);
    server.on("/kaia/show", HTTP_GET, handleShow);
    server.on("/kaia/anim", HTTP_GET, handleAnim);
}
