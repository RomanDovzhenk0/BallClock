#include "kaia.h"

#include <FastLED.h>
#include <GyverNTP.h>
#include <RunningGFX.h>
#include <StringUtils.h>

#include "config.h"
#include "crash.h"
#include "log.h"
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
    uint8_t style = 1;         // kaia_anim at the call, or the call's own style
    bool own_style = false;    // the call gave one: it plays even when the saved style is off
    uint8_t look = 0;          // the event's look: its saved one at the call (kaia_wake, kaia_listen …) or the call's
    uint8_t lk = 0;            // the look of the listening after a wake (kaia_listen at the call)
    uint8_t wake = 0;          // kaia_wake at the call (or the call's): 0 = the style's own
    uint8_t speed = 100;       // kaia_wake_speed at the call (or the call's), %
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
    int lt;      // after a wake: the listening's time (t - the wake's real length)
    uint8_t ls;  // after a wake: the listening's style
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

// ================= the helpers of v1.6 (KAIA-173): positions, distances, hashes =================
// p = 4·(x − 19), q = 7·(row − 3) (b_x, b_row below): a ball from the middle in 1/8 balls, p to the right, q down

// the ball at x half-balls across (0..38) in a row, or -1
static int ballRX(int x, int row) {
    if (row < 0 || row > 6) return -1;
    return matrix.ledDiag((x - 2 + row) >> 1, row);
}

// the ball nearest to (p, q), 1/8 ball from the middle (p to the right, q down), or -1
static int ballAt(int p, int q) {
    if (p < -80 || p > 80 || q < -24 || q > 24) return -1;
    return ballRX(((p + 76) * 2 + 4) / 8, ((q + 21) * 2 + 7) / 14);
}

// the length of (dx, dy) as max + 3/8 min: within 7 % of the true one, no square root
static int oct(int dx, int dy) {
    dx = abs(dx);
    dy = abs(dy);
    return dx > dy ? dx + (dy * 3 >> 3) : dy + (dx * 3 >> 3);
}

// the distance from (p, q) to the segment s = {x0, y0, x1, y1} (in PROGMEM), drawn up to v / 256 of its length (v > 0)
static int segDist(int p, int q, const int8_t* s, int v) {
    int x0 = (int8_t)pgm_read_byte(s), y0 = (int8_t)pgm_read_byte(s + 1);
    int dx = (int8_t)pgm_read_byte(s + 2) - x0, dy = (int8_t)pgm_read_byte(s + 3) - y0;
    int u = ((p - x0) * dx + (q - y0) * dy) * 256 / (dx * dx + dy * dy);
    u = u < 0 ? 0 : u > v ? v : u;
    return oct(p - x0 - dx * u / 256, q - y0 - dy * u / 256);
}

// a hash of n, 0..255: h1 of the ball tables for any number
static inline int hash8(int n) {
    return (uint32_t)(n + 1) * 2654435761u >> 24;
}

// put() for a ball that may be missing (-1)
static inline void putb(int i, uint32_t color, int a) {
    if (i >= 0) put(i, color, a);
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

// the wake draws only its rings: the listening that fades in is wakeDraw's
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

// pictograms (in PROGMEM): one row per entry, the leftmost pixel is the highest bit
static const uint16_t pict_check[5] PROGMEM = {0x003, 0x006, 0x10c, 0x198, 0x0f0};  // 9 wide
static const uint16_t pict_cross[5] PROGMEM = {0x63, 0x36, 0x1c, 0x36, 0x63};       // 7 wide
static const uint16_t pict_bell[5] PROGMEM = {0x1c, 0x3e, 0x3e, 0x7f, 0x08};        // 7 wide

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
        uint16_t row = pgm_read_word(&rows[gy]);
        for (int gx = 0; gx < w; gx++) {
            if (!((row >> (w - 1 - gx)) & 1)) continue;
            int led = matrix.ledDiag(x0 + gx + (gy >> 1), 1 + gy);
            if (led >= 0) put(led, col, a);
        }
    }
}

// k: how far it shows (255 = all; less while it fades in after another wake)
static void sparksState(Anim n, int t, uint32_t col, int k) {
    fr.dg = 128;
    switch (n) {
        case A_LISTENING:  // the mark breathes
            mark(col, (77 + 128 * sin8((uint8_t)(t * 256 / 3000)) / 255) * k / 255, 0);
            break;

        case A_THINKING: {  // three sparks orbit it
            uint32_t c = mix(col, C_VIOLET, 128), sc = mix(c, C_WHITE, 102);
            mark(c, (77 + 64 * sin8((uint8_t)(t * 256 / 900)) / 255) * k / 255, 0);
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
                put(track[m], sc, a * 242 / 255 * k / 255);
            }
        } break;

        default: {  // speaking: the mark opens ring by ring with the voice
            static const int16_t th[4] = {0, 140, 64, -3};  // halo, body, core
            int e = voice(t);
            for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
                uint8_t l = lensOf(i);
                if (l) put(i, col, lens_w[l] * ((l == 3 ? 77 : 0) + 179 * smooth(th[l], th[l] + 102, e) / 255) / 255 * k / 255);
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
        // the mark settles into the breath of the sparks listening, or out when another style listens after it
        int end = fr.ls == 3 ? 77 + 128 * sin8((uint8_t)(fr.lt * 256 / 3000)) / 255 : 0;
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

static void stateDraw(uint8_t style, Anim n, int t, uint32_t col, int k) {
    switch (style) {
        case 1: rippleState(n, t, col, k); break;
        case 2: orbitState(n, t, col, k); break;
        default: sparksState(n, t, col, k); break;
    }
}

static void shotDraw(uint8_t style, Anim n, int t, int du, uint32_t col) {
    switch (style) {
        case 1: rippleShot(n, t, du, col); break;
        case 2: orbitShot(n, t, du, col); break;
        default: sparksShot(n, t, du, col); break;
    }
}

// ================= the wakes of v1.5 (web/src/wakes.js, line by line) =================
// kaia_wake picks one apart from the style: 0 the style's own (1 ripple, 2 orbit, 3 sparks), 1–3 those three with
// any style, 4 and up the new ones below. kaia_wake_speed (50–200 %): the wake runs on u = t·speed/100 and lasts
// du·100/speed; the listening of the style that fades in under it, and that takes over after it, keeps real time.

// ids in the site's order (the names: kaia_wake_names); base lengths at 100 %, ms (1–3 = shot_ms[style - 1][0])
static const uint16_t wake_ms[WAKE_COUNT] PROGMEM = {0, 1900, 2000, 2000, 2000, 1800, 2000, 1900, 2200, 2000, 2200, 2000, 1800, 2000, 2200};
// when the listening starts to fade in under wakes 1–3 (the new ones: du - 800)
static const uint16_t wake_from[4] = {0, 1100, 1500, 1600};

const char kaia_wake_names[] PROGMEM = "Как у стиля;Рябь;Орбита;Искры;Рассвет;Радар;Спираль;Сердцебиение;Глаз;Звёзды;Салют;Дождь;Включение;Зайчик;«КАЯ»";

// the looks per event of v1.6 (web/src/looks.js LOOK_NAMES), 0..LOOK_COUNT - 1
const char kaia_listen_names[] PROGMEM = "Как у стиля;Рябь;Орбита;Искры;Эхо;Прилив;Сияние;Взгляд;Пузырьки";
const char kaia_think_names[] PROGMEM = "Как у стиля;Рябь;Орбита;Искры;Змейка;Нейроны;Песочные часы;Три точки;Атом";
const char kaia_speak_names[] PROGMEM = "Как у стиля;Рябь;Орбита;Искры;Эквалайзер;Осциллограф;Лучи;Динамики;Губы";
const char kaia_done_names[] PROGMEM = "Как у стиля;Рябь;Орбита;Искры;Галочка;Шкала;Конфетти;Кольцо;«ОК»";
const char kaia_error_names[] PROGMEM = "Как у стиля;Рябь;Орбита;Искры;Нет-нет;Крест;Сбой;Сирена;Отключение";
const char kaia_notify_names[] PROGMEM = "Как у стиля;Рябь;Орбита;Искры;«!»;Тук-тук;Маяк;Конверт;Значок";

// the ball in the diagonal grid, one byte: the column (bits 0-4, 0..19) and the row (bits 5-7, 0 at the top .. 6)
static uint8_t b_cr[MX_LED_AMOUNT];

static inline int b_col(uint8_t i) {
    return b_cr[i] & 31;
}
static inline int b_row(uint8_t i) {
    return b_cr[i] >> 5;
}
// x across in half-balls: 2·col + 3 − row, 0..38 (19 = the middle)
static inline int b_x(uint8_t i) {
    return 2 * b_col(i) + 3 - b_row(i);
}
// a hash of the ball, 0..255 (wakes.js keeps them as the tables h1–h3)
static inline int h1(uint8_t i) {
    return (uint32_t)(i + 1) * 2654435761u >> 24;
}
static inline int h2(uint8_t i) {
    return (uint32_t)(i + 1) * 2246822519u >> 24;
}
static inline int h3(uint8_t i) {
    return (uint32_t)(i + 1) * 3266489917u >> 24;
}

static void buildWakeTables() {
    for (int y = 0; y < MX_DIAG_H; y++) {
        for (int x = 0; x < MX_DIAG_W; x++) {
            int i = matrix.ledDiag(x, y);
            if (i < 0) continue;
            b_cr[i] = x | (y << 5);
        }
    }
}

static const uint16_t pict_heart[5] PROGMEM = {0x36, 0x7f, 0x7f, 0x3e, 0x08};  // 7 wide

// the new wakes: (n, t, du, col), t = the wake's own time, 0 .. du.
// Each fades itself out over its last 400 ms (fo); wakeDraw fades the style's listening in over the last 800.

// 4 · Рассвет: the dawn rises from the bottom row to the top, whiter at its edge, brighter in the middle
static void dawnShot(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t);
    int F = smooth(0, 1500, t) * 140 / 255;  // the edge, 1/16 row up from the bottom
    fr.dg = 115;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int dp = F - (6 - b_row(i)) * 16;
        if (dp < -24) continue;
        int a = 0;
        uint32_t c = col;
        if (dp < 0) {
            a = 90 * (24 + dp) / 24;  // the glow above the edge
        } else {
            a = 70 + 185 * imax(0, 96 - dp) / 96;
            int side = 255 - abs(b_x(i) - 19) * 4;
            a = a * (190 + 65 * side / 255) / 255;
            c = mix(col, C_WHITE, 140 * imax(0, 48 - dp) / 48);
        }
        put(i, c, a * fo / 255);
    }
}

// 5 · Радар: one beam turn clockwise from 12 o'clock with a trail; some balls light up as blips
static void radarShot(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t);
    int th = t * 256 / 1400;  // the beam's angle, 0..256 a turn
    int hub = t < 400 ? tent(t - 100, 300) : 0;
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int dl = th - b_ang[i], d = b_dist[i];
        int a = 0;
        uint32_t c = col;
        if (dl >= 0) {
            if (dl < 96) {
                int x = (96 - dl) * 255 / 96;
                a = x * x / 255;
            }
            if (h1(i) < 34 && dl < 150) {
                a = imax(a, 215 * (150 - dl) / 150);
                c = mix(col, C_WHITE, 160);
            }
            a = a * (150 + 105 * d / 38) / 255;
            if (dl < 12) c = mix(col, C_WHITE, (12 - dl) * 200 / 12);
        }
        if (hub && d < 10) a = imax(a, hub * (10 - d) / 10);
        put(i, c, a * fo / 255);
    }
}

// 6 · Спираль: two arms unwind from the centre to the rim and turn
static void spiralShot(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t);
    int R = smooth(0, 1250, t) * 46 / 255;  // the front, quarter-balls
    int rho = t * 256 / 1700;
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int d = b_dist[i];
        if (d > R) continue;
        int v = (b_ang[i] * 2 + d * 7 - rho) & 255, dd = imin(v, 256 - v);
        int a = tent(dd, 56);
        if (d < 9 && t < 500) a = imax(a, tent(t - 150, 350) * (9 - d) / 9);
        if (!a) continue;
        a = a * (255 - d * 3) / 255;
        int hd = R - d;
        put(i, hd < 7 ? mix(col, C_WHITE, (7 - hd) * 30) : col, a * fo / 255);
    }
}

// 7 · Сердцебиение: a 7×5 heart beats twice (lub-dub) with the rest dimmed, the time hidden on purpose
static void heartShot(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t);
    int env = 0;
    for (int k = 0; k < 2; k++) {  // the beats at 150 and 540 ms
        int q = t - (k ? 540 : 150), pk = k ? 190 : 255;
        int b = q < 0 ? 0 : q < 90 ? pk * q / 90 : imax(0, pk - pk * (q - 90) / 380);
        env = imax(env, b);
    }
    int hide = smooth(0, 140, t) * fo / 255;
    dimAll(255 - 200 * hide / 255);
    fr.dg = 255;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        if (lensOf(i) == 1) put(i, col, 70 * env / 255 * hide / 255);
    }
    pict(pict_heart, 7, mix(col, C_WHITE, 110 * env / 255), (60 + 195 * env / 255) * hide / 255, 0);
}

// 8 · Глаз: a slit along the middle row opens into an eye; the pupil looks left, right and back; a blink
static void eyeShot(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t);
    int o = smooth(250, 950, t) * (255 - 215 * smooth(1750, 1980, t) / 255) / 255;  // how open
    int w = smooth(0, 250, t) * 17 / 255;  // the slit's half-length, half-balls
    int hd = smooth(0, 300, t) * fo / 255;
    dimAll(255 - 170 * hd / 255);
    fr.dg = 89;
    // the pupil's offset in quarter half-balls: 0 → -5 → +5 → 0
    int off = (-20 * smooth(1000, 1200, t) + 40 * smooth(1250, 1450, t) - 20 * smooth(1500, 1700, t)) / 255;
    int pk = smooth(550, 850, t);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int ax = abs(b_x(i) - 19), dr = b_row(i) - 3;
        int a = 0;
        uint32_t c = col;
        if (ax <= w) {
            int dxn = ax * 255 / 17;
            int H = o * (255 - dxn * dxn / 255) / 255, mg = H - abs(dr) * 85;
            if (mg >= 0) a = 45;  // the white
            a = imax(a, 230 * tent(mg, 64) / 255);  // the lid
        }
        if (o > 110 && pk) {
            int px = 4 * (b_x(i) - 19) - off, d2 = px * px + 49 * dr * dr;
            if (d2 < 340) {
                int pa = d2 <= 169 ? 255 : (340 - d2) * 255 / 171, core = imax(0, (110 - d2) * 255 / 110);
                if (pa > a || core) {
                    a = imax(a, pa * pk / 255);
                    c = mix(col, C_WHITE, 60 + 150 * core / 255);
                }
            }
        }
        put(i, c, a * fo / 255);
    }
}

// 9 · Звёзды: stars twinkle denser and denser, then one flash from the centre
static void starsShot(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t);
    int dth = smooth(0, 1250, t) * 240 / 255 + 10;
    int fl = t > 1300 ? tent(t - 1500, 200) : 0;
    fr.dg = 140;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int a = 0;
        uint32_t c = mix(col, C_WHITE, (h1(i) & 1) ? 150 : 60);
        if (h1(i) < dth) {
            int ph = (h2(i) + t * (220 + (h3(i) & 63)) / 1000) & 255, s = 255 - abs(ph - 128) * 2;
            a = s * s / 255;
        }
        if (fl) {
            int fl2 = fl * (255 - b_dist[i] * 3) / 255;
            if (fl2 > a) {
                a = fl2;
                c = mix(col, C_WHITE, 210);
            }
        }
        put(i, c, a * fo / 255);
    }
}

// 10 · Салют: a rocket up the middle column to the centre, a burst along the 18 spark paths, then glitter
static void fireworkShot(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t);
    static const uint8_t trail[4] = {255, 153, 77, 31};
    fr.dg = 115;
    if (t < 780) {
        int hr = 96 - smooth(0, 720, t) * 48 / 255;  // the head, 1/16 row
        for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
            if (abs(b_x(i) - 19) > 1) continue;
            int df = b_row(i) * 16 - hr;
            if (df < -8 || df > 48) continue;
            int a = df < 8 ? 255 : (48 - df) * 255 / 48;
            put(i, df < 8 ? mix(col, C_WHITE, 170) : col, a * a / 255 * fo / 255);
        }
    }
    int q = t - 780;
    if (q < 0) return;
    if (q < 260) {
        int fl = 255 * tent(q - 70, 160) / 255;
        for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) put(i, mix(col, C_WHITE, 200), fl * tent(b_dist[i], 16) / 255 * fo / 255);
    }
    int xf = imin(q, 650) * 256 / 650, j256 = xf * (512 - xf) / 256;  // ease out, 0..256
    for (int k = 0; k < SPARKS; k++) {
        int len = 0;
        while (len < SPARK_LEN && spark[k][len] != 255) len++;
        int head = (len - 1) * j256 / 256;  // the path read from its end: centre → rim
        for (int q2 = 0; q2 < 4 && head - q2 >= 0; q2++) put(spark[k][len - 1 - (head - q2)], (k & 1) ? mix(col, C_WHITE, 170) : col, trail[q2] * fo / 255);
    }
    if (q > 400) {
        for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
            int t2 = q - 400 - h2(i) * 5 / 3;
            if (t2 >= 0 && t2 < 500 && h3(i) < 120 && b_dist[i] > 10) put(i, mix(col, C_WHITE, 120), 220 * (500 - t2) / 500 * fo / 255);
        }
    }
}

// 11 · Дождь: drops run down both diagonals of the grid, leaving a faint trail
static void rainShot(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int kA = b_col(i), kB = b_col(i) - b_row(i) + 6;  // the two diagonals through the ball
        int a = 0;
        uint32_t c = col;
        int dfA = (t - ((kA * 37 + 11) & 31) * 26) * 128 / 1000 - 16 - b_row(i) * 16;
        if (dfA >= 0) {
            if (dfA < 96) {
                int x = (96 - dfA) * 255 / 96;
                a = x * x / 255;
                if (dfA < 20) c = mix(col, C_WHITE, (20 - dfA) * 9);
            } else {
                a = 26;
            }
        }
        int dfB = (t - ((kB * 29 + 5) & 31) * 26 - 110) * 128 / 1000 - 16 - b_row(i) * 16;
        if (dfB >= 0) {
            int a2 = 26;
            if (dfB < 96) {
                int x = (96 - dfB) * 255 / 96;
                a2 = x * x / 255;
            }
            if (a2 > a) {
                a = a2;
                c = mix(col, C_WHITE, dfB < 20 ? (20 - dfB) * 6 + 110 : 110);
            }
        }
        put(i, c, a * fo / 255);
    }
}

// ================= the wakes of v1.6 (KAIA-173): (n, t, du, col), as the ones above =================

// 12 · Включение: like an old TV switched on: a dot in the middle, a line along the middle row, the picture opens
static void powerOnWake(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t);
    int hw = smooth(200, 550, t) * 20 / 255;  // the line's half-length, half-balls
    int hv = smooth(600, 950, t) * 56 / 255;  // the picture's half-height, 1/16 row
    int glow = 255 - 190 * smooth(950, 1400, t) / 255;
    uint32_t wc = mix(col, C_WHITE, 200), lc = mix(col, C_WHITE, 40);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int dv = abs(b_row(i) - 3) * 16, dh = abs(b_x(i) - 19);
        int a = 0;
        uint32_t c = wc;
        if (b_dist[i] < 3 && t < 950) a = smooth(0, 150, t);
        if (t >= 200 && !dv && dh <= hw + 1) a = 255;
        if (t >= 600 && dv <= hv) {
            a = imax(a, glow);
            c = hv - dv < 16 ? wc : lc;
        }
        put(i, c, a * fo / 255);
    }
}

// 13 · Зайчик: a spot of light bounces off the edges like a sunbeam from a mirror, with a short trail
static void bunnyWake(Anim, int t, int du, uint32_t col) {
    int g = smooth(0, 150, t) * (255 - smooth(1300, 1700, t)) / 255 * smooth(du, du - 400, t) / 255;
    uint32_t wc = mix(col, C_WHITE, 170);
    int bp[4], bq[4];
    for (int j = 0; j < 4; j++) {  // the spot and its trail, 45 ms apart
        int u = imax(0, t - j * 45);
        int a1 = posMod(u * 150 / 1000 + 60, 240), a2 = posMod(u * 56 / 1000 + 14, 56);
        bp[j] = a1 < 120 ? a1 - 60 : 180 - a1;  // a triangle wave: it bounces off ±60 and ±14
        bq[j] = a2 < 28 ? a2 - 14 : 42 - a2;
    }
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = 0;
        uint32_t c = col;
        for (int j = 0; j < 4; j++) {
            int r = j ? 10 : 14, d = oct(p - bp[j], q - bq[j]);
            if (d >= r) continue;
            int v = (r - d) * (j ? 210 - j * 40 : 255) / r;
            if (v > a) {
                a = v;
                c = j ? col : wc;
            }
        }
        put(i, c, a * g / 255);
    }
}

// 14 · «КАЯ»: Kaya writes her name column by column with a white pen (0.1–0.9 s), holds it, and it scatters
static const uint16_t pict_kaya[5] PROGMEM = {0x523, 0x655, 0x473, 0x655, 0x555};  // 11 wide: К А Я
static void nameWake(Anim, int t, int, uint32_t col) {
    dimAll(255 - 200 * smooth(0, 200, t) / 255 * smooth(1900, 1500, t) / 255);
    fr.dg = 255;
    int x0 = (194 - 10 * 11) / 20;
    for (int gy = 0; gy < 5; gy++) {
        uint16_t row = pgm_read_word(&pict_kaya[gy]);
        for (int gx = 0; gx < 11; gx++) {
            if (!((row >> (10 - gx)) & 1)) continue;
            int u = t - 100 - gx * 70 - gy * 10;  // since the pen reached it
            if (u < 0) continue;
            int out = 1450 + (gx * 7 + gy * 3) % 11 * 40;  // when it scatters
            putb(matrix.ledDiag(x0 + gx + (gy >> 1), 1 + gy), mix(col, C_WHITE, 220 * tent(u, 200) / 255), 255 - smooth(out, out + 150, t));
        }
    }
}

// ================= Kaya's look per event (v1.6: web/src/looks.js, line by line) =================
// Each event has its own setting, as kaia_wake has for the wake: kaia_listen, kaia_think, kaia_speak, kaia_done,
// kaia_error, kaia_notify. 0 «Как у стиля»: the style's version (kaia_anim); 1–3: the Рябь, Орбита or Искры version
// with any style; 4 and up: the new ones below. The listening after a wake (and under its end) is the listening's look.
// The small tables are in PROGMEM.

// the base length of the new one-shots (4–8), ms: done, error, notify
static const uint16_t look_ms[3][5] PROGMEM = {
    {1600, 1500, 1800, 1700, 1600},
    {1400, 1600, 1300, 1600, 1500},
    {1500, 1500, 1600, 1700, 1600},
};

// a one-shot's length, ms: look 0 = the style's version, 1–3 that style's version, 4 and up the new ones
static int shotLength(Anim n, uint8_t look, uint8_t style) {
    if (look >= 4) return pgm_read_word(&look_ms[n - A_DONE][look - 4]);
    return shot_ms[(look ? look : style) - 1][n - A_DONE + 1];
}

// ----- Слушает: (n, t, col, k), k = how far it shows; p = 4·(x − 19), q = 7·(row − 3): the ball from the middle in 1/8 balls

// 4 · Эхо: arcs come in from both sides to the middle; the outer columns keep a faint glow
static void echoListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int ph = t * 76 / 1600;  // the fronts, 1/8 ball from a point 100 to the side: 24 (the edge) .. 100 (the middle)
    int f1 = 24 + posMod(ph, 76), f2 = 24 + posMod(ph + 38, 76);
    int e1 = (f1 - 24) * (100 - f1) * 210 / 1444, e2 = (f2 - 24) * (100 - f2) * 210 / 1444;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int q = 7 * (b_row(i) - 3), dx = 100 - abs(4 * (b_x(i) - 19));
        int dd = dx + q * q / (2 * dx);
        int a = imax(tent(dd - f1, 12) * e1 / 255, tent(dd - f2, 12) * e2 / 255);
        if (dx <= 40) a += 28;
        put(i, col, a * k / 255);
    }
}

// 5 · Прилив: water in the bottom rows rises and falls in 4 s, its surface rolls; the crest is whiter
static void tideListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int L = 38 + wave(t, 64) * 14 / 128;  // the level, 1/16 row up from the bottom row's foot
    int sp = t * 60 / 1000;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int s = L + ((int)sin8((b_x(i) * 14 + sp) & 255) - 128) * 9 / 128;
        int dp = s - ((6 - b_row(i)) * 16 + 8);  // how deep the ball's centre is under the surface
        if (dp < -10) continue;
        int a = 0;
        uint32_t c = col;
        if (dp < 0) {
            a = 40 * (10 + dp) / 10;
        } else {
            a = 70 + 150 * tent(dp, 28) / 255;
            c = mix(col, C_WHITE, 100 * tent(dp, 12) / 255);
        }
        put(i, c, a * k / 255);
    }
}

// 6 · Сияние: slow curtains of light hang from the top rows and drift
static const uint8_t aur_fall[4] PROGMEM = {255, 215, 150, 70};  // rows 0..3
static void auroraListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int s1 = t * 40 / 1000, s2 = t * 27 / 1000;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int r = b_row(i);
        if (r > 3) continue;
        int u = sin8((b_x(i) * 9 + r * 6 + s1) & 255), v = sin8((b_x(i) * 5 - s2 + 64) & 255);
        int a = 40 + 215 * (u * v / 255) / 255;
        put(i, mix(col, C_WHITE, 90 * v / 255), a * pgm_read_byte(&aur_fall[r]) / 255 * k / 255);
    }
}

// 7 · Взгляд: a soft spot drifts round the display, as if Kaya's attention follows the owner
static void gazeListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int pc = wave(t, 37) * 46 / 128, qc = wave(t + 900, 61) * 9 / 128;  // the spot's centre
    uint32_t wc = mix(col, C_WHITE, 120);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int d = oct(4 * (b_x(i) - 19) - pc, 7 * (b_row(i) - 3) - qc);
        if (d >= 26) continue;
        int u = (26 - d) * 255 / 26;
        put(i, d < 8 ? wc : col, 255 * (u * u / 255) / 255 * k / 255);
    }
}

// 8 · Пузырьки: ten bubbles rise from the bottom and wobble, as if the owner's words go up to Kaya
static const uint8_t bub_x[10] PROGMEM = {7, 31, 15, 25, 11, 21, 35, 3, 29, 17};  // half-balls across
static void bubblesListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t c = mix(col, C_WHITE, 70);
    for (int j = 0; j < 10; j++) {
        int per = 2200 + (j * 3 % 5) * 260;
        int y = 112 - posMod(t + j * 470, per) * 128 / per;  // 1/16 row from row 0: 112 (under the plate) .. -16
        int x = pgm_read_byte(&bub_x[j]) + wave(t + j * 300, 170) * 2 / 128;
        int env = (112 - y) * (y + 16) * 255 / 4096 * k / 255;  // 0 at both ends
        int r0 = y >> 4, fy = y & 15, a0 = env * (16 - fy) >> 4;
        putb(ballRX(x, r0), c, a0);
        putb(ballRX(x, r0 + 1), c, env * fy >> 4);
        putb(ballRX(x - 2, r0), col, a0 >> 2);  // a faint rim either side
        putb(ballRX(x + 2, r0), col, a0 >> 2);
    }
}

// ----- Думает: Kaya's colour half violet, as in the 3 styles

// 4 · Змейка: a snake runs the rows back and forth (row 0 to the right, row 1 back …), 3.5 s a pass
static void snakeThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t c = mix(col, C_VIOLET, 128), hc = mix(c, C_WHITE, 150);
    int h = posMod(t * 8 / 100, 280);  // the head on the path, half-balls: 40 a row
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int r = b_row(i), s = r * 40 + ((r & 1) ? 38 - b_x(i) : b_x(i));
        int d = posMod(h - s, 280);
        int a = 18;
        if (d < 30) {
            int u = (30 - d) * 255 / 30;
            a = imax(a, u * u / 255);
        }
        put(i, d < 3 ? hc : c, a * k / 255);
    }
}

// 5 · Нейроны: every 250 ms a ball fires somewhere and a ring spreads three balls out from it
static void neuronThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t c = mix(col, C_VIOLET, 128), wc = mix(c, C_WHITE, 170);
    int j0 = t / 250, cp[3] = {0, 0, 0}, cq[3] = {0, 0, 0}, age[3] = {-1, -1, -1};
    for (int m = 0; m < 3; m++) {
        int j = j0 - m;
        if (j < 0) continue;
        int b = hash8(j) >> 1;
        cp[m] = 4 * (b_x(b) - 19);
        cq[m] = 7 * (b_row(b) - 3);
        age[m] = t - j * 250;
    }
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = 14;
        uint32_t cc = c;
        for (int m = 0; m < 3; m++) {
            if (age[m] < 0) continue;
            int d = oct(p - cp[m], q - cq[m]);
            if (age[m] < 120 && d < 5) {
                a = 255;
                cc = wc;
                continue;
            }
            a = imax(a, tent(d - age[m] * 26 / 750, 7) * (255 - age[m] * 255 / 750) / 255);
        }
        put(i, cc, a * k / 255);
    }
}

// 6 · Песочные часы: sand runs from the top bulb to the bottom one in 2.7 s, then the glass turns over (0.3 s)
static void hourglassThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t c = mix(col, C_VIOLET, 128);
    int ph = posMod(t, 3000), P = smooth(0, 2700, ph), F = smooth(2700, 3000, ph);
    int lv = P * 48 / 255;  // 1/16 row: how far the top has sunk, how high the heap stands
    bool flow = P > 0 && P < 255;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int r = b_row(i), ax = abs(b_x(i) - 19), w = abs(r - 3) * 6 + 1;  // the glass, half-balls each side
        if (ax > w) continue;
        int a = ax >= w - 1 ? 30 : 0;
        if (r < 3) {
            int s = r * 16 + 8 >= lv ? 255 : 0;
            a = imax(a, (s + (255 - s) * F / 255) * 200 / 255);
        } else if (r > 3) {
            int s = (6 - r) * 16 + 8 <= lv ? 255 : 0;
            a = imax(a, s * (255 - F) / 255 * 200 / 255);
        }
        if (flow && ax <= 1 && r >= 3 && r <= 5 && ((h1(i) + t / 60) & 1)) a = imax(a, 170);
        put(i, c, a * k / 255);
    }
}

// 7 · Три точки: the «typing» dots in the bottom rows jump one after another, 1.2 s a round
static void dotsThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t c = mix(mix(col, C_VIOLET, 128), C_WHITE, 60), wc = mix(c, C_WHITE, 140);
    int ph = posMod(t, 1200);
    for (int j = 0; j < 3; j++) {
        int x = 11 + 8 * j, b = tent(ph - 200 * j - 180, 180);  // the jump, 0..255
        int up = (150 + 105 * b / 255) * k / 255;
        uint32_t cc = b > 128 ? wc : c;
        putb(ballRX(x, 6), c, 150 * (255 - b) / 255 * k / 255);
        putb(ballRX(x - 1, 5), cc, up);
        putb(ballRX(x + 1, 5), cc, up);
        putb(ballRX(x, 4), wc, b * k / 255);
    }
}

// 8 · Атом: three electrons run round three tilted ellipses with short tails; the nucleus throbs
static const int8_t atom_sh[3] PROGMEM = {-40, 0, 40};  // the tilt: q += sh·p/256
static void atomThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t c = mix(col, C_VIOLET, 128), wc = mix(c, C_WHITE, 150);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        if (b_dist[i] < 5) put(i, wc, (110 + wave(t, 300) * 50 / 128) * k / 255);
    }
    for (int j = 0; j < 3; j++) {
        int th0 = t * 256 / (1300 + 200 * j) + j * 85;
        int sh = (int8_t)pgm_read_byte(&atom_sh[j]);
        for (int q2 = 3; q2 >= 0; q2--) {  // the tail first, the head last
            int th = th0 - q2 * 9;
            int p = 56 * ((int)sin8((th + 64) & 255) - 128) / 128;
            int q = 12 * ((int)sin8(th & 255) - 128) / 128 + sh * p / 256;
            putb(ballAt(p, q), q2 ? c : wc, (255 - q2 * 60) * k / 255);
        }
    }
}

// ----- Говорит: voice(t), the pseudo-voice above

// 4 · Эквалайзер: 13 bars across the display grow up and down from the middle row with the voice
static void eqSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t wc = mix(col, C_WHITE, 150);
    int lvb[13];
    for (int b = 0; b < 13; b++) lvb[b] = voice(t - ((b * 5 + 3) % 13) * 23) * (255 - abs(b - 6) * 20) / 255;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int dr = abs(b_row(i) - 3), e = lvb[b_x(i) / 3] - dr * 64;  // > 0: inside the bar
        if (e <= -16) continue;
        put(i, dr && e < 40 ? wc : col, imin(230, (e + 16) * 4) * k / 255);
    }
}

// 5 · Осциллограф: a wave line along the middle; its height follows the voice, spreading from the centre out
static void scopeSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int ph = t * 300 / 1000;
    uint32_t wc = mix(col, C_WHITE, 110);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int amp = voice(t - abs(b_x(i) - 19) * 14) * 19 / 255;  // 1/8 ball
        int y = amp * ((int)sin8((b_x(i) * 18 - ph) & 255) - 128) / 128;
        int d = abs(7 * (b_row(i) - 3) - y);
        if (d >= 9) continue;
        put(i, d < 3 ? wc : col, tent(d, 9) * 240 / 255 * k / 255);
    }
}

// 6 · Лучи: 18 rays from the centre along the spark paths; each one's length follows the voice a little later
static void raysSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t wc = mix(col, C_WHITE, 160);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        if (b_dist[i] < 4) put(i, wc, 150 * k / 255);
    }
    for (int s = 0; s < SPARKS; s++) {
        int len = 0;
        while (len < SPARK_LEN && spark[s][len] != 255) len++;
        int L = voice(t - ((s * 7) % SPARKS) * 17) * len * 16 / 255;  // the ray, 1/16 ball from the centre
        for (int j = 0; j < len; j++) {  // the path read from its end: centre → rim
            int e = L - j * 16;
            if (e <= 0) break;
            put(spark[s][len - 1 - j], e < 16 ? wc : col, imin(220, e * 14) * k / 255);
        }
    }
}

// 7 · Динамики: two speakers left and right; their cones push out with the voice (the right one 60 ms later)
static void speakersSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int vl = voice(t), vr = voice(t - 60);
    uint32_t wc = mix(col, C_WHITE, 140);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int v = b_x(i) < 19 ? vl : vr;
        int d = oct(abs(4 * (b_x(i) - 19)) - 52, 7 * (b_row(i) - 3));  // both speakers at ±52 (6½ balls)
        int r = 10 + v * 12 / 255;  // the cone's edge
        int a = d < 22 ? 24 : d < 27 ? 40 : 0;
        uint32_t c = col;
        a = imax(a, tent(d - r, 7) * (130 + v * 125 / 255) / 255);
        if (d < 5) {
            a = 120 + v * 135 / 255;
            c = wc;
        }
        put(i, c, a * k / 255);
    }
}

// 8 · Губы: lips across the middle part as Kaya talks: a line in a pause, open with the voice
static void lipsSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int h = 2 + voice(t) * 17 / 255;  // how far they part at the middle, 1/8 ball
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19);
        if (abs(p) > 60) continue;
        int dxn = abs(p) * 255 / 60, H = h * (255 - dxn * dxn / 255) / 255;
        int e = abs(7 * (b_row(i) - 3)) - H;  // 0 on a lip
        int a = tent(e, 7) * 235 / 255;
        if (e < 0) a = imax(a, 30);
        put(i, col, a * k / 255);
    }
}

// ----- Готово: (n, t, du, col), green unless the call gives a colour

// 4 · Галочка: a big check is drawn stroke by stroke with a white pen (0.1–0.7 s), flashes and holds; the time steps back
static const int8_t chk_s1[4] PROGMEM = {-44, -2, -14, 18}, chk_s2[4] PROGMEM = {-14, 18, 46, -20};  // 1/8 ball: 36 and 71 long
static void checkDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t);
    int L = smooth(100, 700, t) * 107 / 255;  // the pen along both strokes
    int v1 = imin(256, L * 256 / 36), v2 = L > 36 ? (L - 36) * 256 / 71 : -1;
    int tx = v2 < 0 ? -44 + 30 * v1 / 256 : -14 + 60 * v2 / 256;  // the pen's tip
    int ty = v2 < 0 ? -2 + 20 * v1 / 256 : 18 - 38 * v2 / 256;
    bool pen = t > 100 && t < 720;
    int fl = tent(t - 780, 160);
    dimAll(255 - 190 * smooth(0, 200, t) / 255 * fo / 255);
    fr.dg = 255;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int d = v1 > 0 ? segDist(p, q, chk_s1, v1) : 99;
        if (v2 >= 0) d = imin(d, segDist(p, q, chk_s2, v2));
        if (d >= 10) continue;
        int w = pen && oct(p - tx, q - ty) < 9 ? 230 : 200 * fl / 255;
        put(i, mix(col, C_WHITE, w), imin(255, tent(d, 10) * 3 / 2) * fo / 255);
    }
}

// 5 · Шкала: a bar fills the display left to right with a rolling front (0–0.8 s), flashes at 100 % and holds
static void barDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t);
    int F = smooth(0, 800, t) * 44 / 255 - 2;  // the front, half-balls
    int fl = tent(t - 900, 180), sp = t * 500 / 1000;
    uint32_t fc = mix(col, C_WHITE, 120), flc = mix(col, C_WHITE, 160 * fl / 255);
    fr.dg = 153;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int e = F + ((int)sin8((b_row(i) * 40 + sp) & 255) - 128) * 2 / 128 - b_x(i);  // > 0: filled
        if (e < 0) continue;
        int a = 120;
        uint32_t c = col;
        if (e < 4 && t < 820) {
            a = 255;
            c = fc;
        }
        if (fl) {
            a = imax(a, fl);
            c = flc;
        }
        put(i, c, a * fo / 255);
    }
}

// 6 · Конфетти: 16 bits of confetti burst from the middle, fly up and out, turn and fall; green, light green, white
static const int8_t conf_v[16][2] PROGMEM = {{-60, -40}, {-45, -52}, {-30, -30}, {-18, -48}, {-8, -36}, {6, -54}, {16, -42}, {28, -50}, {40, -34}, {55, -46}, {-50, -24}, {48, -22}, {-24, -58}, {22, -60}, {-36, -44}, {34, -40}};  // 1/8 ball a second
static void confettiDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t);
    int pop = tent(t - 60, 160);
    uint32_t pc = mix(col, C_WHITE, 200);
    fr.dg = 153;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        if (pop && b_dist[i] < 10) put(i, pc, pop * (10 - b_dist[i]) / 10);
    }
    for (int j = 0; j < 16; j++) {
        uint32_t c = j % 3 == 0 ? mix(col, C_WHITE, 190) : j % 3 == 1 ? mix(col, C_WHITE, 80) : col;
        int vp = (int8_t)pgm_read_byte(&conf_v[j][0]), vq = (int8_t)pgm_read_byte(&conf_v[j][1]);
        for (int q2 = 1; q2 >= 0; q2--) {  // a trail 60 ms behind, then the bit
            int u = t - (j * 3 % 5) * 30 - q2 * 60;
            if (u <= 0) continue;
            int p = vp * u / 1000, q = vq * u / 1000 + 32 * (u * u / 1000) / 1000;
            putb(ballAt(p, q), c, (q2 ? 70 : 255) * fo / 255);
            if (!q2 && ((h1(j) + u / 90) & 1)) putb(ballAt(p + 8, q), c, 200 * fo / 255);  // it turns: two balls, then one
        }
    }
}

// 7 · Кольцо: a ring round the middle closes from 12 o'clock both ways (0–0.6 s), its inside flashes, a wave goes out
static void ringDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t);
    int nt = track_len, pr = smooth(0, 600, t) * nt * 128 / 255;  // how far each arc has run, 1/256 ball
    int fl = tent(t - 700, 220), age = t - 650;
    int r = 160 + age * 640 / 1000, fw = age > 0 ? imax(0, 255 - age * 255 / 700) : 0;
    uint32_t wc = mix(col, C_WHITE, 160);
    fr.dg = 153;
    for (int m = 0; m < nt; m++) {
        int d = imin(m, nt - m) * 256;  // from 12 o'clock either way
        if (d <= pr) put(track[m], t < 650 && d > pr - 512 ? wc : col, 240 * fo / 255);
    }
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int l = lensOf(i);
        int a = l >= 2 ? 230 * fl / 255 : 0;
        if (fw) a = imax(a, 150 * tent(b_dist[i] * 16 - r, 90) / 255 * fw / 255);
        if (a) put(i, l >= 2 ? wc : col, a * fo / 255);
    }
}

// 8 · «ОК»: «OK» is stamped in white with a shock ring, then turns green; the time steps back while it shows
static const uint16_t pict_ok[5] PROGMEM = {0x0c9, 0x12a, 0x12c, 0x12a, 0x0c9};  // 9 wide
static void okDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t);
    dimAll(255 - 200 * smooth(0, 120, t) / 255 * fo / 255);
    fr.dg = 255;
    int r = (t - 80) * 700 / 1000, fw = t > 80 ? imax(0, 608 - r) * 255 / 608 : 0;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        if (fw) put(i, col, 140 * tent(b_dist[i] * 16 - r, 80) / 255 * fw / 255);
    }
    pict(pict_ok, 9, mix(col, C_WHITE, 255 - smooth(60, 500, t)), smooth(40, 90, t) * fo / 255, 0);
}

// ----- Ошибка: red unless the call gives a colour

// 4 · Нет-нет: a red ring round the middle shakes its head left and right, three times, smaller each time
static void shakeError(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t);
    int dx = wave(t, 700) * (26 * imax(0, 1100 - t) / 1100) / 128;  // the shift, 1/8 ball
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19) - dx, q = 7 * (b_row(i) - 3);
        int e = p * p * 256 / 1600 + q * q * 256 / 400;  // 256 on the ellipse 5 × 2½ balls
        int a = imax(tent(e - 256, 110), e < 256 ? 50 : 0);
        put(i, col, a * 240 / 255 * fo / 255);
    }
}

// 5 · Крест: a big cross is drawn stroke by stroke (0.1–0.4 s, 0.45–0.75 s), then blinks twice; the time steps back
static const int8_t crs_s1[4] PROGMEM = {-30, -20, 30, 20}, crs_s2[4] PROGMEM = {30, -20, -30, 20};  // 1/8 ball
static void crossError(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t);
    int v1 = smooth(100, 400, t) * 256 / 255, v2 = t > 450 ? smooth(450, 750, t) * 256 / 255 : -1;
    bool on = t < 850 || (t >= 1000 && t < 1150) || t >= 1300;  // two blinks
    dimAll(255 - 200 * smooth(0, 150, t) / 255 * fo / 255);
    fr.dg = 255;
    if (!on) return;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int d = v1 > 0 ? segDist(p, q, crs_s1, v1) : 99;
        if (v2 > 0) d = imin(d, segDist(p, q, crs_s2, v2));
        if (d >= 10) continue;
        put(i, col, imin(255, tent(d, 10) * 3 / 2) * fo / 255);
    }
}

// 6 · Сбой: the display glitches for 1 s: rows tear in bursts of 70 ms, some frames flash, the time flickers out
static void glitchError(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t);
    bool busy = t < 1000;
    int sl = t / 70, hs = hash8(sl * 7 + 3);
    if (busy && !(hs & 3)) dimAll(60);
    fr.dg = 200;
    uint32_t wc = mix(col, C_WHITE, 170);
    int hr[7];
    for (int r = 0; r < 7; r++) hr[r] = hash8(sl * 13 + r * 7 + 1);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int h = hr[b_row(i)], x0 = h * 5 % 38, x = b_x(i);
        int a = busy ? 0 : 90;
        uint32_t c = col;
        if (busy && h < 120 && x >= x0 && x < x0 + 6 + (h & 15)) {
            a = 230;
            if (h & 1) c = wc;
        }
        if (busy && hs < 30) a = imax(a, 140);
        put(i, c, a * fo / 255);
    }
}

// 7 · Сирена: two beams 180° apart turn round the middle, 2½ turns in 1.6 s; one red, one whitish; a lamp in the middle
static void sirenError(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t);
    int th = t * 400 / 1000;  // the beams' angle, 256 a turn
    uint32_t wc = mix(col, C_WHITE, 150);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int d = b_dist[i], da = abs(((b_ang[i] - th + 128) & 255) - 128);  // 0..128 from beam A
        int a1 = tent(da, 30), a2 = tent(128 - da, 30);
        int a = imax(a1, a2) * (150 + 105 * d / 38) / 255;
        uint32_t c = a2 > a1 ? wc : col;
        if (d < 5) {
            a = 200 + wave(t, 800) * 55 / 128;
            c = col;
        }
        put(i, c, a * fo / 255);
    }
}

// 8 · Отключение: like an old TV switched off: a red flash, the picture squeezes into a line, the line into a dot, out
static void powerOffError(Anim, int t, int du, uint32_t col) {
    dimAll(255 - 225 * smooth(0, 120, t) / 255 * smooth(du, du - 300, t) / 255);
    fr.dg = 255;
    int hv = 56 - smooth(150, 550, t) * 56 / 255;  // half the picture's height, 1/16 row
    int hw = 20 - smooth(550, 900, t) * 20 / 255;  // half the line's length, half-balls
    uint32_t wc = mix(col, C_WHITE, 180);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int dv = abs(b_row(i) - 3) * 16, dh = abs(b_x(i) - 19);
        int a = 0;
        uint32_t c = col;
        if (t < 150) {
            a = 230 * smooth(0, 60, t) / 255;
        } else if (t < 550) {
            a = dv <= hv ? 230 : dv < hv + 16 ? 230 * (hv + 16 - dv) / 16 : 0;
            c = mix(col, C_WHITE, 150 * smooth(150, 550, t) / 255);
        } else if (t < 900) {
            if (!dv && dh <= hw + 1) a = 240;
            c = wc;
        } else if (b_dist[i] < 3) {
            a = 255 - smooth(950, 1300, t);
            c = mix(col, C_WHITE, 200 * a / 255);
        }
        put(i, c, a);
    }
}

// ----- Уведомление: amber unless the call gives a colour

// 4 · «!»: a big «!» in the middle columns blinks three times, each blink starting white; the side columns flash with it
static void bangNotify(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t);
    int ph = t % 350;
    bool on = t >= 1050 || ph < 240;  // three blinks, then it stays
    int wh = t < 1050 ? tent(ph - 40, 80) : 0;
    uint32_t c = mix(col, C_WHITE, 200 * wh / 255);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int r = b_row(i), ax = abs(b_x(i) - 19);
        int a = 0;
        if (on && (r < 3 ? ax <= 2 : r == 3 ? ax <= 1 : r == 5 ? ax == 1 : r == 6 && !ax)) a = 255;
        if (ax >= 16) a = imax(a, 200 * wh / 255);
        put(i, c, a * fo / 255);
    }
}

// 5 · Тук-тук: two knocks, a pause, two knocks: each one flashes the bottom row and sends an arc up from under it
static const uint16_t knock_t[4] PROGMEM = {0, 180, 620, 800};
static void knockNotify(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int q = 7 * (b_row(i) - 3), d = oct(4 * (b_x(i) - 19), 28 - q);  // from a point under the bottom edge
        int a = 0;
        for (int j = 0; j < 4; j++) {
            int age = t - (int)pgm_read_word(&knock_t[j]);
            if (age < 0 || age >= 600) continue;
            int pk = j & 1 ? 255 : 210;
            a = imax(a, tent(d - age * 80 / 600, 10) * (600 - age) / 600 * pk / 255);
            if (b_row(i) == 6) a = imax(a, tent(age - 30, 90));
        }
        put(i, col, a * fo / 255);
    }
}

// 6 · Маяк: a lighthouse beam from under the bottom edge sweeps left to right; it flashes the display as it faces you
static void beaconNotify(Anim, int t, int du, uint32_t col) {
    int g = smooth(0, 150, t) * smooth(du, du - 300, t) / 255;
    int phi = -43 + smooth(100, 1400, t) * 86 / 255;  // from straight up, 256 a turn: −60° .. +60°
    int sx = (int)sin8(phi & 255) - 128, cy = (int)sin8((phi + 64) & 255) - 128;
    int fl = tent(phi, 8) * 150 / 255;
    uint32_t wc = mix(col, C_WHITE, 120);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int dx = 4 * (b_x(i) - 19), dy = 40 - 7 * (b_row(i) - 3);  // from the lamp, 5 balls under the middle
        int al = dx * sx + dy * cy, cr = abs(dx * cy - dy * sx);
        int a = imax(al > 0 ? tent(cr * 256 / al, 80) : 0, fl);
        put(i, a > 200 ? wc : col, a * g / 255);
    }
}

// 7 · Конверт: an envelope slides in from the left (0–0.5 s), settles, its flap flashes white; the time steps back
static const uint16_t pict_mail[5] PROGMEM = {0x1ff, 0x183, 0x145, 0x129, 0x1ff}, pict_flap[5] PROGMEM = {0, 0x082, 0x044, 0x028, 0};  // 9 wide
static void mailNotify(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t);
    dimAll(255 - 190 * smooth(0, 200, t) / 255 * fo / 255);
    fr.dg = 255;
    int dx = -15 + smooth(0, 500, t) * 16 / 255 - (smooth(520, 680, t) > 127 ? 1 : 0);
    if (t < 500) pict(pict_mail, 9, col, 90 * fo / 255, dx - 1);  // the blur behind it
    pict(pict_mail, 9, col, fo, dx);
    pict(pict_flap, 9, C_WHITE, tent(t - 850, 150) * fo / 255, dx);
}

// 8 · Значок: a badge drops into the top right corner, bounces, pings twice and stays lit, as on a phone's icon
static void badgeNotify(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t);
    int y = -18;  // the badge's centre, 1/8 ball
    if (t < 300) y = -50 + 32 * (t * t / 300) / 300;
    else if (t < 500) y = -18 - 8 * (10000 - (t - 400) * (t - 400)) / 10000;
    uint32_t wc = mix(col, C_WHITE, 140);
    fr.dg = 153;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int d = oct(4 * (b_x(i) - 19) - 56, 7 * (b_row(i) - 3) - y);
        int a = d < 11 ? 255 : d < 15 ? 255 * (15 - d) / 4 : 0;
        for (int j = 0; j < 2; j++) {  // the pings at 550 and 950 ms
            int age = t - 550 - 400 * j;
            if (age > 0 && age < 600) a = imax(a, tent(d - 12 - age * 40 / 600, 6) * (600 - age) / 600 * 200 / 255);
        }
        put(i, d < 6 ? wc : col, a * fo / 255);
    }
}

// ----- the event in its look

// a state in its look; style: kaia_anim (1–3), look: the event's setting, k: how far it shows (255 = all)
static void stateLook(uint8_t style, uint8_t look, Anim n, int t, uint32_t col, int k) {
    if (look < 4) {
        stateDraw(look ? look : style, n, t, col, k);
        return;
    }
    if (n == A_LISTENING) {
        switch (look) {
            case 4: echoListen(n, t, col, k); break;
            case 5: tideListen(n, t, col, k); break;
            case 6: auroraListen(n, t, col, k); break;
            case 7: gazeListen(n, t, col, k); break;
            default: bubblesListen(n, t, col, k); break;
        }
    } else if (n == A_THINKING) {
        switch (look) {
            case 4: snakeThink(n, t, col, k); break;
            case 5: neuronThink(n, t, col, k); break;
            case 6: hourglassThink(n, t, col, k); break;
            case 7: dotsThink(n, t, col, k); break;
            default: atomThink(n, t, col, k); break;
        }
    } else {
        switch (look) {
            case 4: eqSpeak(n, t, col, k); break;
            case 5: scopeSpeak(n, t, col, k); break;
            case 6: raysSpeak(n, t, col, k); break;
            case 7: speakersSpeak(n, t, col, k); break;
            default: lipsSpeak(n, t, col, k); break;
        }
    }
}

// a one-shot (done, error, notify) in its look, t = 0 .. shotLength
static void shotLook(uint8_t style, uint8_t look, Anim n, int t, uint32_t col) {
    int du = shotLength(n, look, style);
    if (look < 4) {
        shotDraw(look ? look : style, n, t, du, col);
        return;
    }
    if (n == A_DONE) {
        switch (look) {
            case 4: checkDone(n, t, du, col); break;
            case 5: barDone(n, t, du, col); break;
            case 6: confettiDone(n, t, du, col); break;
            case 7: ringDone(n, t, du, col); break;
            default: okDone(n, t, du, col); break;
        }
    } else if (n == A_ERROR) {
        switch (look) {
            case 4: shakeError(n, t, du, col); break;
            case 5: crossError(n, t, du, col); break;
            case 6: glitchError(n, t, du, col); break;
            case 7: sirenError(n, t, du, col); break;
            default: powerOffError(n, t, du, col); break;
        }
    } else {
        switch (look) {
            case 4: bangNotify(n, t, du, col); break;
            case 5: knockNotify(n, t, du, col); break;
            case 6: beaconNotify(n, t, du, col); break;
            case 7: mailNotify(n, t, du, col); break;
            default: badgeNotify(n, t, du, col); break;
        }
    }
}

// ================= the wake with its speed =================

// the wake's real length at the speed, ms
static int wakeLength(int id, int speed) {
    return (int)pgm_read_word(&wake_ms[id]) * 100 / speed;
}

// t: ms since the wake started (real time); style: kaia_anim (1–3); wake: kaia_wake (0 = the style's);
// lk: kaia_listen, the look of the listening that fades in under the wake and goes on after it
static void wakeDraw(uint8_t style, uint8_t wake, uint8_t lk, int speed, int t, uint32_t col) {
    int id = wake ? wake : style;
    int du = pgm_read_word(&wake_ms[id]);
    int u = t * speed / 100;  // the wake's own time
    if (u > du) u = du;
    fr.lt = t - wakeLength(id, speed);  // the listening's time: it goes on at its own pace after the wake
    fr.ls = lk >= 4 ? 0 : lk ? lk : style;  // the listening's style (0: a new look)

    switch (id) {
        case 1: rippleShot(A_WAKE, u, du, col); break;
        case 2: orbitShot(A_WAKE, u, du, col); break;
        case 3: sparksShot(A_WAKE, u, du, col); break;
        case 4: dawnShot(A_WAKE, u, du, col); break;
        case 5: radarShot(A_WAKE, u, du, col); break;
        case 6: spiralShot(A_WAKE, u, du, col); break;
        case 7: heartShot(A_WAKE, u, du, col); break;
        case 8: eyeShot(A_WAKE, u, du, col); break;
        case 9: starsShot(A_WAKE, u, du, col); break;
        case 10: fireworkShot(A_WAKE, u, du, col); break;
        case 11: rainShot(A_WAKE, u, du, col); break;
        case 12: powerOnWake(A_WAKE, u, du, col); break;
        case 13: bunnyWake(A_WAKE, u, du, col); break;
        default: nameWake(A_WAKE, u, du, col); break;
    }

    if (id <= 3) {
        // the sparks mark settles into its own breath; any other pair fades the listening in
        if (!(id == 3 && fr.ls == 3)) stateLook(style, lk, A_LISTENING, fr.lt, col, smooth(wake_from[id], du, u));
    } else {
        fr.dg = 89;
        stateLook(style, lk, A_LISTENING, fr.lt, col, smooth(du - 800, du, u));
    }
}

// the setting that holds each event's look, by anim (A_WAKE … A_NOTIFY)
static const uint32_t look_keys[A_OFF] PROGMEM = {kk::kaia_wake, kk::kaia_listen, kk::kaia_think, kk::kaia_speak, kk::kaia_done, kk::kaia_error, kk::kaia_notify};

// the event whose look the key holds, or A_OFF
static Anim lookEvent(size_t key) {
    for (uint8_t n = 0; n < A_OFF; n++) {
        if (pgm_read_dword(&look_keys[n]) == key) return (Anim)n;
    }
    return A_OFF;
}

// the saved look of an event, the saved speed of the wake; a value out of range reads as the default
static uint8_t savedLook(Anim n) {
    int v = db[(size_t)pgm_read_dword(&look_keys[n])].toInt();
    return v >= 0 && v < (n == A_WAKE ? WAKE_COUNT : LOOK_COUNT) ? v : 0;
}

static uint8_t savedWakeSpeed() {
    int s = db[kk::kaia_wake_speed].toInt();
    return s >= 50 && s <= 200 ? s : 100;
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

// a one-shot's real length: a wake's at its speed, the others' in their look
static uint32_t playLength() {
    if (ov.anim == A_WAKE) return wakeLength(ov.look ? ov.look : ov.style, ov.speed);
    return shotLength(ov.anim, ov.look, ov.style);
}

// the colour it draws with: the call's, or Kaya's (done green, error red, notify amber)
static uint32_t playColor(Anim n) {
    if (ov.own_color) return ov.color;
    if (n == A_DONE) return C_GREEN;
    if (n == A_ERROR) return C_RED;
    if (n == A_NOTIFY) return C_AMBER;
    return db[kk::kaia_color].toInt32();
}

// what plays at now, as the next frame will see it: a wake past its length is the listening after it (t from its
// end, in the listening's look); a one-shot past its length, a state past its ms, or what the settings or the night
// switch off is nothing
static bool playNow(uint32_t now, Anim& n, uint32_t& t, uint8_t& look) {
    if (ov.mode != M_SHOT && ov.mode != M_STATE) return false;
    if (!db[kk::kaia_anim].toInt() && !ov.own_style) return false;
    if (redrawNight() && db[kk::kaia_night].toInt() == 2) return false;

    n = ov.anim;
    t = now - ov.start;
    look = ov.look;
    if (ov.mode == M_SHOT) {
        uint32_t du = playLength();
        if (t < du) return true;
        if (n != A_WAKE || ov.text_waits) return false;
        n = A_LISTENING;
        t -= du;
        look = ov.lk;
    }
    return t < ov.ms;
}

void kaiaDraw(bool night) {
    uint32_t now = millis();
    uint8_t rule = db[kk::kaia_night].toInt();
    uint8_t style = db[kk::kaia_anim].toInt();

    if (night && rule == 2) {  // at night: none
        ov.mode = M_NONE;
        ov.text_waits = false;
    }
    // switched off in the settings (a try-out with its own style plays on)
    if (!style && !ov.own_style && (ov.mode == M_SHOT || ov.mode == M_STATE)) ov.mode = M_NONE;

    if (ov.mode == M_SHOT) {
        uint32_t du = playLength();
        if (now - ov.start >= du) {
            if (ov.text_waits) {
                startText(now);
            } else if (ov.anim == A_WAKE) {
                ov.mode = M_STATE;
                ov.anim = A_LISTENING;
                ov.look = ov.lk;
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

    if (ov.mode == M_TEXT) {
        drawText(now, txt.own_color ? txt.color : db[kk::kaia_color].toInt32());
        return;
    }

    int t = now - ov.start;
    uint32_t col = playColor(ov.anim);

    if (ov.mode == M_STATE) stateLook(ov.style, ov.look, ov.anim, t, col, 255);
    else if (ov.anim == A_WAKE) wakeDraw(ov.style, ov.look, ov.lk, ov.speed, t, col);
    else shotLook(ov.style, ov.look, ov.anim, t, col);
}

// ================= HTTP: /kaia/state, /kaia/show, /kaia/anim =================

static KaiaServer* srv = nullptr;

// every setting but the Wi-Fi and the page password
static const char state_keys[] PROGMEM =
    "show_ip,ntp_gmt,ntp_host,bright,auto_bright,bright_min,bright_max,adc_min,adc_max,"
    "night_mode,night_mode_auto,night_mode_auto_since,night_mode_auto_to,night_color,night_trsh,"
    "clock_style,clock_style_zero,clock_color,back_mode,back_pal,back_speed,back_angle,back_scale,back_bright,"
    "kaia_anim,kaia_wake,kaia_wake_speed,kaia_listen,kaia_think,kaia_speak,kaia_done,kaia_error,kaia_notify,"
    "kaia_color,kaia_bright,kaia_night,log_host";

// as the settings page answers
static void corsHeaders() {
#ifndef SETS_NO_CORS
    srv->sendHeader(F("Access-Control-Allow-Origin"), F("*"));
    srv->sendHeader(F("Access-Control-Allow-Private-Network"), F("true"));
    srv->sendHeader(F("Access-Control-Allow-Methods"), F("*"));
#endif
}

static void reply(int code, const String& json) {
    corsHeaders();
    logHttpCode(code);
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

    uint32_t now = millis();
    Anim pn = A_OFF;
    uint32_t pt = 0;
    uint8_t plook = 0;
    bool playing = ov.mode != M_TEXT && playNow(now, pn, pt, plook);

    String s;
    s.reserve(1400);
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
    s += F(",\"uptime\":");
    s += now / 1000;
    s += F(",\"ms\":");
    s += now;
    s += F(",\"update\":");
    s += ota.updateAvailable() ? F("true") : F("false");  // a poll must not use it up (hasUpdate() would)
    s += F(",\"update_last\":");
    {
        String last = db[kk::ota_last].toString();
        if (last.length()) addString(s, last);
        else s += F("null");
    }
    s += F(",\"reset\":\"");
    s += crashResetReason();
    s += F("\",\"heap\":");
    s += ESP.getFreeHeap();
    s += F(",\"block\":");
    s += ESP.getMaxFreeBlockSize();
    s += F(",\"crash\":");
    crashJson(s);
    s += F(",\"overlay\":\"");
    s += ov.mode == M_TEXT ? F("text") : playing ? F("anim") : F("none");
    s += F("\",\"anim\":");
    if (playing) {
        s += '"';
        s += FPSTR(anim_names[pn]);
        s += '"';
    } else {
        s += F("null");
    }

    // what plays now (a running text's words never appear)
    s += F(",\"play\":");
    if (playing) {
        char name[sizeof(anim_names[0])], p[128];
        strcpy_P(name, anim_names[pn]);
        snprintf_P(p, sizeof(p), PSTR("{\"name\":\"%s\",\"style\":%u,\"look\":%u,\"wake\":%u,\"speed\":%u,\"t\":%u,\"color\":\"%06x\"}"),
                   name, (unsigned)ov.style, (unsigned)plook, (unsigned)ov.wake, (unsigned)ov.speed, (unsigned)pt, (unsigned)playColor(pn));
        s += p;
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

        size_t h = su::hash(key) & DB_HASH_MASK;
        Anim ev = lookEvent(h);
        if (ev != A_OFF) {
            s += savedLook(ev);
        } else if (h == kk::kaia_wake_speed) {
            s += savedWakeSpeed();
        } else {
            gdb::Entry e = db.get(h);
            switch (e.type()) {
                case gdb::Type::String: addString(s, e.toString()); break;
                case gdb::Type::Int:
                case gdb::Type::Uint:
                case gdb::Type::Int64:
                case gdb::Type::Uint64:
                case gdb::Type::Float: s += e.toString(); break;
                default: s += F("null"); break;
            }
        }
        if (!c) break;
    }
    s += F("}}");
    reply(200, s);
}

// GET /kaia/log: the last lines of the clock's log; ?to=IP:port sets where it sends them (empty = nowhere)
static void handleLog() {
    if (!authorized()) return;

    if (srv->hasArg(F("to"))) {
        if (!logSetTarget(srv->arg(F("to")).c_str())) return replyError(400, F("to: IP:port, or empty to switch off"));
        db[kk::log_host] = logTarget();
        return replyOk();
    }

    corsHeaders();
    logDump(*srv);
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

    LOGF(LG_DEBUG, "kaia", "show");
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
    // a try-out from the site: this call's look only, nothing is saved; absent = the saved settings
    long style = 0, wake = -1, speed = 0, look = -1;
    if (!readColor(color, own)) return replyError(400, F("color: RRGGBB"));
    if (!readNum(F("ms"), 100, 60000, ms)) return replyError(400, F("ms: 100-60000"));
    if (!readNum(F("style"), 1, 3, style)) return replyError(400, F("style: 1-3"));
    if (!readNum(F("wake"), 0, WAKE_COUNT - 1, wake)) return replyError(400, F("wake: 0-14"));
    if (!readNum(F("speed"), 50, 200, speed)) return replyError(400, F("speed: 50-200"));
    // look= for every name but off: the event's animation for this call (wake= is its old name for the wake)
    if (n == A_WAKE) {
        if (!readNum(F("look"), 0, WAKE_COUNT - 1, look)) return replyError(400, F("look: 0-14 for wake"));
        if (look < 0) look = wake;
    } else if (n != A_OFF) {
        if (!readNum(F("look"), 0, LOOK_COUNT - 1, look)) return replyError(400, F("look: 0-8"));
    }

    ov.text_waits = false;
    if (n == A_OFF) {
        LOGF(LG_DEBUG, "kaia", "off");
        ov.mode = M_NONE;
        return replyOk();
    }

    // an explicit style plays even when the saved one is off
    bool own_style = style;
    if (!own_style) style = db[kk::kaia_anim].toInt();
    if (style < 1 || style > 3) return replyOk();  // animations are off in the settings

    // Kaya's own calls carry no look: every event plays its saved one (0 = as the style); speed matters only for a wake
    ov.look = look >= 0 ? look : savedLook((Anim)n);
    ov.lk = savedLook(A_LISTENING);
    ov.wake = n == A_WAKE ? ov.look : savedLook(A_WAKE);
    ov.speed = n == A_WAKE && speed ? speed : savedWakeSpeed();

    char shown[sizeof(anim_names[0])];
    strcpy_P(shown, anim_names[n]);
    if (n == A_WAKE) LOGF(LG_DEBUG, "kaia", "anim=%s style=%u look=%u speed=%u", shown, (unsigned)style, (unsigned)ov.look, (unsigned)ov.speed);
    else LOGF(LG_DEBUG, "kaia", "anim=%s style=%u look=%u", shown, (unsigned)style, (unsigned)ov.look);

    ov.anim = (Anim)n;
    ov.style = style;
    ov.own_style = own_style;
    ov.mode = (n == A_LISTENING || n == A_THINKING || n == A_SPEAKING) ? M_STATE : M_SHOT;
    ov.start = millis();
    ov.ms = ms;
    ov.color = color;
    ov.own_color = own;
    replyOk();
}

// GET /kaia/frame: {ms, bright, night, leds}, leds = LED 0…127 as RRGGBB, as drawn (before the brightness).
// Streamed in four pieces: no String, a small buffer on the stack
static void handleFrame() {
    if (!authorized()) return;

    char head[64];
    int n = snprintf_P(head, sizeof(head), PSTR("{\"ms\":%u,\"bright\":%u,\"night\":%s,\"leds\":\""),
                       (unsigned)millis(), (unsigned)redrawBright(), redrawNight() ? "true" : "false");
    corsHeaders();
    logHttpCode(200);
    srv->setContentLength(n + MX_LED_AMOUNT * 6 + 2);
    srv->send(200, "application/json", emptyString);
    srv->sendContent(head, n);

    char hex[32 * 6];
    for (int i = 0; i < MX_LED_AMOUNT; i += 32) {
        char* p = hex;
        for (int k = i; k < i + 32; k++) {
            uint32_t c = matrix.getLED((uint8_t)k);
            for (int s = 20; s >= 0; s -= 4) {
                uint8_t v = (c >> s) & 15;
                *p++ = v < 10 ? '0' + v : 'a' + v - 10;
            }
        }
        srv->sendContent(hex, p - hex);
    }
    srv->sendContent("\"}", 2);
}

// GET /kaia/wifi: {ssid, ip, rssi, ap}: the saved network, never a password
static void handleWifi() {
    if (!authorized()) return;

    bool up = WiFi.status() == WL_CONNECTED;
    bool ap = !up && (WiFi.getMode() & WIFI_AP);  // the clock runs its own access point
    IPAddress ip = up ? WiFi.localIP() : WiFi.softAPIP();

    String s;
    s.reserve(128);
    s += F("{\"ssid\":");
    addString(s, db[kk::wifi_ssid].toString());
    char rest[64];
    snprintf_P(rest, sizeof(rest), PSTR(",\"ip\":\"%u.%u.%u.%u\",\"rssi\":%d,\"ap\":%s}"),
               ip[0], ip[1], ip[2], ip[3], up ? (int)WiFi.RSSI() : 0, ap ? "true" : "false");
    s += rest;
    reply(200, s);
}

#ifdef ESP8266
// GET /settings with a page password: set and click need the right auth (the Settings library would write without
// it); then, and for every other action, the library's own handler answers. Added before the library's.
class SettingsGuard : public KaiaServer::RequestHandlerType {
   public:
    bool canHandle(HTTPMethod method, const String& uri) override {
        return method == HTTP_GET && !strcmp_P(uri.c_str(), PSTR("/settings"));
    }

    bool handle(KaiaServer& server, HTTPMethod method, const String& uri) override {
        String action = server.arg(F("action"));
        bool writes = !strcmp_P(action.c_str(), PSTR("set")) || !strcmp_P(action.c_str(), PSTR("click"));
        if (writes && !authorized()) return true;

        for (KaiaServer::RequestHandlerType* h = next(); h; h = h->next()) {
            if (h->canHandle(method, uri)) return h->handle(server, method, uri);
        }
        return false;
    }
};
#endif

void kaiaBegin(KaiaServer& server) {
    buildTables();
    buildWakeTables();

    srv = &server;
    server.on("/kaia/state", HTTP_GET, handleState);
    server.on("/kaia/show", HTTP_GET, handleShow);
    server.on("/kaia/anim", HTTP_GET, handleAnim);
    server.on("/kaia/log", HTTP_GET, handleLog);
    server.on("/kaia/frame", HTTP_GET, handleFrame);
    server.on("/kaia/wifi", HTTP_GET, handleWifi);
#ifdef ESP8266
    server.addHandler(new SettingsGuard());
#endif
}
