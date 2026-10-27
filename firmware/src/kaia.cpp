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
    bool hideOn = false;       // the Digit fade (v1.7): an animation drew in the last frame
    uint16_t hide = 0;         // its level: 0 = the time shown, 65535 = gone
    uint32_t hideT = 0;        // millis() of its last step
    uint32_t hideEnd = 0;      // millis() of the first frame without an animation
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
    uint8_t hd;  // how much of the time the Digit fade has taken, 0..255: set by kaiaDraw while it draws
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

// mix(): matrix.h

static inline uint32_t dim(uint32_t c, int k) {
    return mix(0, c, k);
}

// blend one ball towards the colour by a (0..255)
static void put(uint8_t i, uint32_t color, int a) {
    if (a <= 0) return;
    if (a > 255) a = 255;
    a = a * fr.sc / 255;
    if (matrix.marked(i)) a = a * (fr.dg + (255 - fr.dg) * fr.hd / 255) / 255;  // the Digit fade lifts it to all
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

// segDist() for a segment in RAM, s = {x0, y0, x1, y1} (v1.8: Галактика · Комета's moves, past an int8_t)
static int segDist(int p, int q, const int* s, int v) {
    int x0 = s[0], y0 = s[1];
    int dx = s[2] - x0, dy = s[3] - y0;
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
// any style, 4–14 the new ones below, 15–20 (v1.8) those of styles 4–9 (Kaya's styles), 21–29 (v1.9) those of styles
// 10–18; which wake is which style's is the table wake_style (style_wake the other way). kaia_wake_speed (50–200 %):
// the wake runs on u = t·speed/100 and lasts du·100/speed; the listening of the style that fades in under it, and that
// takes over after it, keeps real time.

// ids in the site's order (the names: kaia_wake_names); base lengths at 100 %, ms (1–3 = shot_ms[style - 1][0])
// 15–20 (v1.8): the wakes of styles 4–9 (Kaya's styles); 21–23 (v1.9): styles 10–12; 24–29: styles 13–18
static const uint16_t wake_ms[WAKE_COUNT] PROGMEM = {0, 1900, 2000, 2000, 2000, 1800, 2000, 1900, 2200, 2000, 2200, 2000, 1800, 2000, 2200, 1800, 2000, 2000, 1900, 2000, 2000,
                                                     2000, 2000, 2000, 1800, 2000, 2000, 2000, 2000, 2000};
// which style each wake is the wake of (0: none; 1–3 are drawn by wakeDraw's own switch), by wake id
static const uint8_t wake_style[WAKE_COUNT] PROGMEM = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18};
// and the wake of each style, by style id (1–3 their own)
static const uint8_t style_wake[STYLE_COUNT + 1] PROGMEM = {0, 1, 2, 3, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29};
// when the listening starts to fade in under wakes 1–3 (the new ones: du - 800)
static const uint16_t wake_from[4] = {0, 1100, 1500, 1600};

const char kaia_wake_names[] PROGMEM = "Как у стиля;Рябь;Орбита;Искры;Рассвет;Радар;Спираль;Сердцебиение;Глаз;Звёзды;Салют;Дождь;Включение;Зайчик;«КАЯ»;"
                                       "Пинг-понг;Калейдоскоп;Лава-лампа;Мордашка;Галактика;Сканер;Снежинка;Светлячки;Пламя;Аркада;Тетрис;Механизм;Неон;"
                                       "Маятник;Гирлянда";

// kaia_anim (web/src/styles.js STYLE_NAMES), 0..STYLE_COUNT
const char kaia_style_names[] PROGMEM = "Выкл;Рябь;Орбита;Искры;Пинг-понг;Калейдоскоп;Лава-лампа;Мордашка;Галактика;Сканер;Снежинка;Светлячки;Пламя;"
                                        "Аркада;Тетрис;Механизм;Неон;Маятник;Гирлянда";

// the looks per event of v1.6 (web/src/looks.js LOOK_NAMES), 0..LOOK_COUNT - 1; 9–14 the versions of styles 4–9 (v1.8),
// 15–23 those of styles 10–18 (v1.9)
#define STYLE_LOOK_NAMES ";Пинг-понг;Калейдоскоп;Лава-лампа;Мордашка;Галактика;Сканер;Снежинка;Светлячки;Пламя;Аркада;Тетрис;Механизм;Неон;Маятник;Гирлянда"
const char kaia_listen_names[] PROGMEM = "Как у стиля;Рябь;Орбита;Искры;Эхо;Прилив;Сияние;Взгляд;Пузырьки" STYLE_LOOK_NAMES;
const char kaia_think_names[] PROGMEM = "Как у стиля;Рябь;Орбита;Искры;Змейка;Нейроны;Песочные часы;Три точки;Атом" STYLE_LOOK_NAMES;
const char kaia_speak_names[] PROGMEM = "Как у стиля;Рябь;Орбита;Искры;Эквалайзер;Осциллограф;Лучи;Динамики;Губы" STYLE_LOOK_NAMES;
const char kaia_done_names[] PROGMEM = "Как у стиля;Рябь;Орбита;Искры;Галочка;Шкала;Конфетти;Кольцо;«ОК»" STYLE_LOOK_NAMES;
const char kaia_error_names[] PROGMEM = "Как у стиля;Рябь;Орбита;Искры;Нет-нет;Крест;Сбой;Сирена;Отключение" STYLE_LOOK_NAMES;
const char kaia_notify_names[] PROGMEM = "Как у стиля;Рябь;Орбита;Искры;«!»;Тук-тук;Маяк;Конверт;Значок" STYLE_LOOK_NAMES;

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

// v1.8: 9–14 are the versions of styles 4–9 (Kaya's styles below); v1.9: 15–23 those of styles 10–18. Look 0 with style
// 4 or later plays its version. Which look is which style's version is the table look_style (style_look the other way),
// so later ids can be appended anywhere.

// which style each look is the version of (0: none; 1–3 go through stateDraw / shotDraw with the style), by look id
static const uint8_t look_style[LOOK_COUNT] PROGMEM = {0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18};
// and the look of each style's version, by style id (0 for 0–3)
static const uint8_t style_look[STYLE_COUNT + 1] PROGMEM = {0, 0, 0, 0, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23};

// the look an event plays: look 0 with style 4 or later is that style's version (style_look); with 1–3 it stays 0
// (stateDraw and shotDraw take the style)
static uint8_t lookOf(uint8_t style, uint8_t look) {
    return look || style <= 3 ? look : pgm_read_byte(&style_look[style]);
}

// the base length of the new one-shots (4–8), ms: done, error, notify
static const uint16_t look_ms[3][5] PROGMEM = {
    {1600, 1500, 1800, 1700, 1600},
    {1400, 1600, 1300, 1600, 1500},
    {1500, 1500, 1600, 1700, 1600},
};

// the one-shot lengths of styles 4–18 (styles.js fam_ms, row style − 4), ms: done, error, notify (their wakes:
// wake_ms[style_wake[style]])
static const uint16_t fam_ms[15][3] PROGMEM = {
    {1500, 1600, 1600},
    {1600, 1600, 1700},
    {1600, 1600, 1600},
    {1700, 1600, 1500},
    {1700, 1700, 1500},
    {1500, 1600, 1500},
    {1800, 1800, 1600},  // 10 Снежинка
    {1700, 1500, 1400},  // 11 Светлячки
    {1800, 2000, 1500},  // 12 Пламя
    {1700, 1700, 1500},  // 13 Аркада
    {1600, 1800, 1500},  // 14 Тетрис
    {1600, 1600, 1600},  // 15 Механизм
    {1600, 1700, 1500},  // 16 Неон
    {1600, 1700, 1400},  // 17 Маятник
    {1700, 1700, 1500},  // 18 Гирлянда
};

// a one-shot's length, ms: look 0 = the style's version, 1–3 that style's version, 4–8 the new ones, 9–23 styles 4–18
static int shotLength(Anim n, uint8_t look, uint8_t style) {
    look = lookOf(style, look);
    if (pgm_read_byte(&look_style[look])) return pgm_read_word(&fam_ms[pgm_read_byte(&look_style[look]) - 4][n - A_DONE]);
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

// ================= Kaya's styles of v1.8 (KAIA-195: web/src/styles.js, line by line) =================
// A style is a whole visual language: its own version of all 7 events. kaia_anim 4–9 picks one as the style, and every
// event with look 0 «Как у стиля» plays its version; the versions also join every event's list as looks 9–14 and wakes
// 15–20, so any event can take them with any style, as 1–3 do. Which look and wake is which style's version is a table
// (look_style / style_look, wake_style / style_wake), not arithmetic.
//   4 Пинг-понг, 5 Калейдоскоп, 6 Лава-лампа, 7 Мордашка, 8 Галактика, 9 Сканер
// The wakes fade out over their last 400 ms (wakeDraw fades the listening in under their last 800), the other
// one-shots over their last 300 ms; the states loop. The small tables are in PROGMEM.
// p = 4·(x − 19), q = 7·(row − 3): a ball from the middle in 1/8 balls (p to the right, q down), as in KAIA-173

// the six-fold fold of an angle (256 a turn): 0 on the six mirror lines (12 o'clock and every 60°), 127 halfway
static int kfold(int a) {
    int s = (a * 6) & 255;
    return s < 128 ? s : 255 - s;
}

// an ellipse's measure at (dx, dy), half-axes w and h (1/8 ball, at least 1): 256 on it, less inside
static int ell(int dx, int dy, int w, int h) {
    return dx * dx * 256 / (w * w) + dy * dy * 256 / (h * h);
}

// a metaball's share of the field at (dx, dy) from its centre, radius r: 256 on its rim, at most 1024
static int blob(int dx, int dy, int r) {
    return imin(1024, r * r * 256 / (dx * dx + dy * dy + 1));
}

// ----- 4 · Пинг-понг: the clock is made of ping-pong balls, so a rally

// the scenery: the paddles at both edges round y0 (hl, hr: how bright each flashes), the net in the middle of rows 5–6,
// the table along the bottom row
static int ppScene(int p, int q, int y0, int hl, int hr) {
    if (abs(p) >= 68 && abs(q - y0) <= 11) return 70 + (p < 0 ? hl : hr) * 185 / 255;
    if (q >= 14 && abs(p) <= 4) return 55;
    return q == 21 ? 14 : 0;
}

// one crossing, u = 0..255 from a paddle: the ball drops from 18 − h to the table (y = 18) at u = 170, then rises
// back to 18 − h at the other paddle; y in 1/8 ball
static int ppY(int u, int h) {
    if (u < 170) return 18 - h + h * u * u / 28900;
    return 18 - h * (u - 170) * (340 - u) / 7225;
}

// the rally: a crossing in P ms at height h; the ball and two ghosts gap ms behind it; a paddle flashes on its hit
static void ppRally(int t, uint32_t col, int k, int P, int h, int gap) {
    if (k <= 0) return;
    uint32_t wc = mix(col, C_WHITE, 170);
    int bx[3], by[3];
    for (int m = 0; m < 3; m++) {
        int s = posMod(t - m * gap, 2 * P), u = posMod(s, P) * 256 / P;
        bx[m] = s < P ? -64 + (u >> 1) : 64 - (u >> 1);
        by[m] = ppY(u, h);
    }
    int s0 = posMod(t, 2 * P), hl = imax(tent(s0, 160), tent(s0 - 2 * P, 160)), hr = tent(s0 - P, 160);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = ppScene(p, q, 18 - h, hl, hr);
        uint32_t c = col;
        for (int m = 0; m < 3; m++) {
            int v = tent(oct(p - bx[m], q - by[m]), m ? 9 : 12) * (m ? 130 - m * 40 : 255) / 255;
            if (v > a) {
                a = v;
                c = m ? col : wc;
            }
        }
        put(i, c, a * k / 255);
    }
}

// Слушает · Розыгрыш: a slow rally over the net, 1.4 s a crossing
static void ppListen(Anim, int t, uint32_t col, int k) {
    ppRally(t, col, k, 1400, 22, 60);
}

// Думает · Быстрый розыгрыш: the same rally almost three times faster and lower, half violet
static void ppThink(Anim, int t, uint32_t col, int k) {
    ppRally(t, mix(col, C_VIOLET, 128), k, 520, 16, 26);
}

// Говорит · Подскоки: the ball hops in the middle as high as the voice; when it lands, the table under it lights
static void ppSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t wc = mix(col, C_WHITE, 170);
    int bx = wave(t, 37) * 36 / 128, by[3];
    for (int m = 0; m < 3; m++) by[m] = 18 - voice(t - m * 50) * 32 / 255;
    int land = imax(0, 255 - (18 - by[0]) * 24);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = ppScene(p, q, -4, 0, 0);
        uint32_t c = col;
        if (q == 21) a = imax(a, land * tent(p - bx, 20) / 255);
        for (int m = 0; m < 3; m++) {
            int v = tent(oct(p - bx, q - by[m]), m ? 9 : 12) * (m ? 130 - m * 40 : 255) / 255;
            if (v > a) {
                a = v;
                c = m ? col : wc;
            }
        }
        put(i, c, a * k / 255);
    }
}

// Пробуждение · Подача: a serve flies in from the left, bounces lower and lower, comes to rest in the middle and glows
static const uint16_t pp_bt[4] PROGMEM = {420, 780, 1040, 1200};  // the landings, ms
static const uint8_t pp_bh[3] PROGMEM = {24, 12, 5};              // the hops between them, 1/8 ball

static int ppServeX(int t) {
    if (t >= 1400) return 0;
    return -88 + 88 * (t * (2800 - t) / 1400) / 1400;
}

static int ppServeY(int t) {
    if (t < 420) return -26 + 44 * t * t / 176400;
    for (int j = 0; j < 3; j++) {
        if (t < pgm_read_word(&pp_bt[j + 1])) {
            int v = t - pgm_read_word(&pp_bt[j]), L = pgm_read_word(&pp_bt[j + 1]) - pgm_read_word(&pp_bt[j]);
            return 18 - 4 * pgm_read_byte(&pp_bh[j]) * v * (L - v) / (L * L);
        }
    }
    return 18;
}

static void ppWake(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t);
    uint32_t wc = mix(col, C_WHITE, 170);
    int bx[3], by[3], lx[4];
    for (int m = 0; m < 3; m++) {
        int u = imax(0, t - m * 40);
        bx[m] = ppServeX(u);
        by[m] = ppServeY(u);
    }
    for (int j = 0; j < 4; j++) lx[j] = ppServeX(pgm_read_word(&pp_bt[j]));
    int ra = t - 1400, rr = ra * 50 / 1000, rf = ra > 0 ? 255 - smooth(0, 400, ra) : 0;  // a ring from the ball at rest
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = 0;
        uint32_t c = col;
        if (q == 21) {  // the table: a flash under every landing
            a = 14 * smooth(0, 300, t) / 255;
            for (int j = 0; j < 4; j++) {
                int age = t - pgm_read_word(&pp_bt[j]);
                if (age >= 0 && age < 300) a = imax(a, tent(p - lx[j], 20) * (300 - age) / 300 * (255 - j * 50) / 255);
            }
        }
        if (rf) a = imax(a, tent(oct(p, q - 18) - rr, 7) * rf / 255);
        for (int m = 0; m < 3; m++) {
            if (m && t < m * 40) break;
            int v = tent(oct(p - bx[m], q - by[m]), m ? 9 : 12) * (m ? 130 - m * 40 : 255) / 255;
            if (v > a) {
                a = v;
                c = m ? col : wc;
            }
        }
        put(i, c, a * fo / 255);
    }
}

// Готово · Смэш: a high lob on the left, a smash into the far corner with a streak, a flash where it lands; the point is won
static const int8_t pp_smash[4] PROGMEM = {-34, -18, 56, 18};
static void ppDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), e = smooth(0, 380, t);
    uint32_t wc = mix(col, C_WHITE, 190);
    int s = t < 380 ? 0 : imin(256, (t - 380) * 256 / 120);  // the smash along pp_smash, 0..256
    int bx = t < 380 ? -62 + 28 * e / 255 : -34 + 90 * s / 256;
    int by = t < 380 ? 14 - 32 * e / 255 : -18 + 36 * s / 256;
    int age = t - 500, rr = age * 140 / 1000, rf = age > 0 ? imax(0, 255 - age * 255 / 700) : 0;
    int fl = tent(t - 540, 220), pt = smooth(650, 850, t), sf = age < 0 ? 220 : imax(0, 220 - age * 220 / 300);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = ppScene(p, q, -4, 0, tent(age, 200)) >> 1;
        uint32_t c = col;
        if (p > 0) a = imax(a, 80 * pt / 255);  // the point: the winner's half lights
        if (s && sf) a = imax(a, tent(segDist(p, q, pp_smash, s), 7) * sf / 255);
        if (rf) a = imax(a, tent(oct(p - 56, q - 18) - rr, 8) * rf / 255);
        if (fl) {
            int v = fl * 120 / 255;
            if (v > a) {
                a = v;
                c = mix(col, C_WHITE, 120);
            }
        }
        if (age < 150) {
            int v = tent(oct(p - bx, q - by), 12);
            if (v > a) {
                a = v;
                c = wc;
            }
        }
        put(i, c, a * fo / 255);
    }
}

// Ошибка · В сетку: the ball flies into the net, the net shakes, the ball drops to the table and rolls off the edge
static void ppError(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), hit = tent(t - 540, 300);
    uint32_t wc = mix(col, C_WHITE, 110);
    int bx = 0, by = 18, g = 255;
    if (t < 520) {
        bx = -64 + 60 * t / 520;
        by = -6 + 20 * t * t / 270400;
    } else if (t < 760) {
        int v = t - 520;
        bx = -4 - 6 * v / 240;
        by = 14 + 4 * v * v / 57600;
    } else {
        int w = imin(t - 760, 700);
        bx = -10 - 76 * w * w / 490000;
        g = 255 - 150 * w / 700;
    }
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = q == 21 ? 18 : 0;
        uint32_t c = col;
        if (q >= 14 && abs(p) <= 4) {  // the net lights up and trembles
            a = 60 + hit * 195 / 255;
            if (hit && ((b_row(i) + t / 50) & 1)) a = a * 3 / 5;
            if (hit > 128) c = wc;
        }
        int v = tent(oct(p - bx, q - by), 12) * g / 255;
        if (v > a) {
            a = v;
            c = wc;
        }
        put(i, c, a * fo / 255);
    }
}

// Уведомление · Мячик: a ball bounces on the spot in the middle, three hops; each landing knocks a ring out of the table
static void ppNotify(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t);
    uint32_t wc = mix(col, C_WHITE, 170);
    int v = t < 1260 ? t % 420 : 0, by = 18 - 120 * v * (420 - v) / 176400;  // 30 high
    int la = t < 1260 ? v : t - 1260, rr = la * 90 / 1000, rf = imax(0, 255 - la * 255 / 500);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = q == 21 ? imax(16, tent(p, 24) * rf / 255) : 0;
        uint32_t c = col;
        a = imax(a, tent(oct(p, q - 18) - rr, 6) * rf / 400);
        int b = tent(oct(p, q - by), 12);
        if (b > a) {
            a = b;
            c = wc;
        }
        put(i, c, a * fo / 255);
    }
}

// ----- 5 · Калейдоскоп: the hexagon's own six-fold symmetry (b_ang folded into six mirrored sectors)

// Слушает · Вращение: six petals round a bright centre turn slowly (30 s a turn); six outer spots turn the other way; it breathes
static void kalListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int rot = t * 256 / 30000, br = 200 + wave(t, 50) * 55 / 128;
    uint32_t wc = mix(col, C_WHITE, 150);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int d = b_dist[i], L = 18 * (255 - 2 * kfold(b_ang[i] + rot)) / 255;
        int a = 0;
        uint32_t c = col;
        if (d < 4) {
            a = 230;
            c = wc;
        } else if (d <= L) {
            int e = tent(d - L, 5);
            a = 80 + 140 * e / 255;
            c = mix(col, C_WHITE, 110 * e / 255);
        } else if (d >= 21) {
            a = tent(kfold(b_ang[i] - 2 * rot + 21), 30) * tent(d - 28, 7) / 255;
        }
        put(i, c, a * br / 255 * k / 255);
    }
}

// Думает · Узоры: two six-pointed stars turn against each other and stretch in turn; rings run out; half violet
static void kalThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t c = mix(col, C_VIOLET, 128), c2 = mix(c, C_WHITE, 120);
    int rot = t * 256 / 5000, w = wave(t, 200), e1 = 18 + w * 10 / 128, e2 = 18 - w * 10 / 128;
    int rr = posMod(t * 500 / 1000, 640);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int d = b_dist[i];
        int L1 = e1 * (127 - kfold(b_ang[i] + rot)) / 127, L2 = e2 * (127 - kfold(b_ang[i] - rot + 21)) / 127;
        int a1 = d <= L1 ? 90 + 165 * tent(d - L1, 5) / 255 : 0, a2 = d <= L2 ? 70 + 150 * tent(d - L2, 5) / 255 : 0;
        int a = imax(a1, a2);
        uint32_t cc = a2 > a1 ? c2 : c;
        a = imax(a, tent(d * 16 - rr, 60) * 70 / 255);
        if (d < 3) {
            a = 255;
            cc = c2;
        }
        put(i, cc, a * k / 255);
    }
}

// Говорит · Дыхание лепестков: the petals stretch with the voice, the centre flashes; the outer spots answer a beat later
static void kalSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int v = voice(t), v2 = voice(t - 140), rot = t * 256 / 20000;
    uint32_t wc = mix(col, C_WHITE, 150);
    int e = 6 + v * 22 / 255, og = 40 + v2 * 215 / 255;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int d = b_dist[i], L = e * (255 - 2 * kfold(b_ang[i] + rot)) / 255;
        int a = 0;
        uint32_t c = col;
        if (d < 3) {
            a = 150 + v * 105 / 255;
            c = wc;
        } else if (d <= L) {
            a = 80 + 175 * tent(d - L, 5) / 255;
            if (d > L - 3) c = wc;
        } else if (d >= 21) {
            a = tent(kfold(b_ang[i] - rot + 21), 30) * tent(d - 28, 7) / 255 * og / 255;
        }
        put(i, c, a * k / 255);
    }
}

// Пробуждение · Мандала: a white seed; six petals unfold from it while the mandala turns a quarter turn and stops; the outer spots light
static void kalWake(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t);
    uint32_t wc = mix(col, C_WHITE, 170);
    int g = smooth(200, 1300, t), rot = 64 - 64 * g / 255, e = 4 + 20 * g / 255;
    int seed = imax(tent(t - 150, 250), 140 * smooth(0, 200, t) / 255), sp = smooth(900, 1400, t);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int d = b_dist[i], L = e * (255 - 2 * kfold(b_ang[i] + rot)) / 255;
        int a = 0;
        uint32_t c = col;
        if (d < 4) {
            a = seed;
            c = wc;
        } else if (t > 200 && d <= L) {
            int v = tent(d - L, 5);
            a = 80 + 175 * v / 255;
            if (g < 255 && v > 128) c = wc;
        } else if (sp && d >= 21) {
            a = tent(kfold(b_ang[i] + 21), 30) * tent(d - 28, 7) / 255 * sp / 255;
        }
        put(i, c, a * fo / 255);
    }
}

// Готово · Цветок: a green flower opens: six round petals with gaps between them (those to 3 and 9 o'clock the longest), a flash to white
static void kalDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), e = smooth(0, 700, t) * 30 / 255, fl = tent(t - 820, 220);
    uint32_t pc = mix(col, C_WHITE, 160 * fl / 255), cc = mix(col, C_WHITE, 120 + 135 * fl / 255);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int d = b_dist[i], m = kfold(b_ang[i] + 21), L = e * imax(0, 255 - m * m / 32) / 255;
        if (d < 4) put(i, cc, imax(110, smooth(0, 200, t)) * fo / 255);
        else if (d <= L) put(i, pc, (110 + 145 * tent(d - L, 6) / 255) * fo / 255);
    }
}

// Ошибка · Осколки: the mandala cracks and flies apart in twelve shards, each at its own speed; they flicker out
static const uint8_t kal_sp[12] PROGMEM = {30, 44, 24, 38, 28, 46, 26, 40, 34, 22, 42, 32};  // the shards' speeds, quarter-balls a second
static void kalError(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), cr = tent(t - 160, 120), g = 255 - smooth(220, 1300, t);
    uint32_t wc = mix(col, C_WHITE, 170);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int d = b_dist[i], w = b_ang[i] * 12 >> 8, s = (b_ang[i] * 12) & 255;  // the shard and the place in it
        int a = 0;
        uint32_t c = col;
        if (t < 220) {  // the whole plate, the petals brighter; the cracks flash white between the shards
            if (d <= 18) a = d <= 18 * (255 - 2 * kfold(b_ang[i])) / 255 ? 230 : 140;
            if (cr && d <= 20 && (s <= 20 || s >= 236)) {
                a = imax(a, cr);
                c = wc;
            }
        } else {
            int d0 = d - (t - 220) * pgm_read_byte(&kal_sp[w]) / 1000;  // where the ball was in its shard before it flew
            if (d0 >= 0 && d0 <= 18 && s > 20 && s < 236) {
                a = 210 * g / 255;
                if (!((w * 5 + t / 70) & 3)) a = a >> 1;
            }
        }
        put(i, c, a * fo / 255);
    }
}

// Уведомление · Лепестки по кругу: six petals light one after another clockwise, two rounds, then all six flash together
static void kalNotify(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), all = tent(t - 1450, 160);
    uint32_t wc = mix(col, C_WHITE, 170);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int d = b_dist[i], L = 20 * (255 - 2 * kfold(b_ang[i])) / 255;
        if (d > L && d >= 4) continue;
        int u = t - (((b_ang[i] + 21) & 255) * 6 >> 8) * 110;  // the petal's turns at u = 0 and 660 ms
        int a = 16;
        if (u >= 0 && t < 1350) a = imax(a, imax(tent(u - 50, 130), tent(u - 710, 130)));
        a = imax(a, all);
        put(i, a > 200 ? wc : col, a * fo / 255);
    }
}

// ----- 6 · Лава-лампа: soft blobs (metaballs); the surface where the field is 256

// a ball under the field S: nothing below 150, a soft rim up to 300, whiter where the lava is thick (over 360)
static void lavaPut(uint8_t i, int S, uint32_t col, uint32_t wc, int g) {
    if (S < 150) return;
    int a = S < 300 ? (S - 150) * 255 / 150 : 255;
    put(i, S > 600 ? wc : S > 360 ? mix(col, wc, (S - 360) * 255 / 240) : col, a * 235 / 255 * g / 255);
}

// Слушает · Дрейф: three soft blobs drift slowly round each other and flow together where they meet; the bottom row is warm
static void lavaListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int bp[3], bq[3];
    uint32_t wc = mix(col, C_WHITE, 110);
    for (int j = 0; j < 3; j++) {
        bp[j] = wave(t + j * 2100, 17 + j * 6) * 52 / 128;
        bq[j] = wave(t + j * 1300, 29 + j * 5) * 14 / 128;
    }
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int S = b_row(i) == 6 ? 170 : 0;
        for (int j = 0; j < 3; j++) S += blob(p - bp[j], q - bq[j], 11 + 2 * j);
        lavaPut(i, S, col, wc, k);
    }
}

// Думает · Слияния: four blobs rush about faster, merge and tear apart; half violet
static void lavaThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t c = mix(col, C_VIOLET, 128), wc = mix(c, C_WHITE, 120);
    int bp[4], bq[4];
    for (int j = 0; j < 4; j++) {
        bp[j] = wave(t + j * 1700, 61 + j * 13) * 56 / 128;
        bq[j] = wave(t + j * 900, 83 + j * 11) * 16 / 128;
    }
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int S = 0;
        for (int j = 0; j < 4; j++) S += blob(p - bp[j], q - bq[j], 9 + j);
        lavaPut(i, S, c, wc, k);
    }
}

// Говорит · Пульс: three blobs in their places swell with the voice, each a beat after the one before; loud, they touch
static void lavaSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t wc = mix(col, C_WHITE, 130);
    int bp[3], br[3];
    for (int j = 0; j < 3; j++) {
        bp[j] = -44 + 44 * j + wave(t + j * 700, 23) * 8 / 128;
        br[j] = 7 + voice(t - j * 70) * 9 / 255 + (j == 1 ? 2 : 0);
    }
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int S = 0;
        for (int j = 0; j < 3; j++) S += blob(p - bp[j], q, br[j]);
        lavaPut(i, S, col, wc, k);
    }
}

// Пробуждение · Всплытие: a blob rises from under the bottom edge to the middle and splits in three that drift apart
static void lavaWake(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t);
    uint32_t wc = mix(col, C_WHITE, 130);
    int by = 44 - smooth(0, 800, t) * 44 / 255, sp = smooth(800, 1500, t) * 46 / 255;
    int rc = 15 - 4 * smooth(800, 1400, t) / 255, rs = 6 + 5 * smooth(700, 1000, t) / 255;
    uint32_t c = mix(col, C_WHITE, tent(t - 950, 200) * 120 / 255);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int S = blob(p, q - by, rc);
        if (t > 700) S += blob(p + sp, q - by + (sp >> 3), rs) + blob(p - sp, q - by - (sp >> 3), rs);
        lavaPut(i, S, c, wc, fo);
    }
}

// Готово · Слияние: three blobs flow into the middle and merge into one; it glows and pulses white
static const int8_t lava_from[6] PROGMEM = {-56, -8, 52, 6, 6, 18};  // where the three start, (p, q)
static void lavaDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), g = 255 - smooth(0, 700, t), pl = tent(t - 850, 220);
    int r = 11 + 5 * pl / 255;
    uint32_t c = mix(col, C_WHITE, 150 * pl / 255), wc = mix(col, C_WHITE, 170);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int S = 0;
        for (int j = 0; j < 3; j++) S += blob(p - (int8_t)pgm_read_byte(&lava_from[2 * j]) * g / 255, q - (int8_t)pgm_read_byte(&lava_from[2 * j + 1]) * g / 255, r);
        lavaPut(i, S, c, wc, fo);
    }
}

// Ошибка · Стекает: the blobs at the top let go and drip down one after another with a stretching neck; a puddle, then dark
static const int8_t drip_x[3] PROGMEM = {-44, 4, 46};
static const uint16_t drip_t[3] PROGMEM = {0, 200, 380};
static void lavaError(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), g = (255 - smooth(500, 1300, t)) * fo / 255;
    uint32_t wc = mix(col, C_WHITE, 90);
    int pd = (150 + 150 * tent(t - 900, 500) / 255) * smooth(500, 700, t) / 255;
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int S = 0;
        for (int j = 0; j < 3; j++) {
            int v = imax(0, t - pgm_read_word(&drip_t[j])), y = -12 + 64 * v * v / 640000;
            S += blob(p - (int8_t)pgm_read_byte(&drip_x[j]), q - y, 11) + blob(p - (int8_t)pgm_read_byte(&drip_x[j]), q - ((y - 12) >> 1), 5);  // the drop and its neck
        }
        if (b_row(i) == 6) S = imax(S, pd);
        lavaPut(i, S, col, wc, g);
    }
}

// Уведомление · Пузырь: a blob rises from the bottom to the top row and pops: it flashes white and a ring goes out
static void lavaNotify(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t);
    uint32_t wc = mix(col, C_WHITE, 170);
    int y = 40 - smooth(0, 820, t) * 56 / 255, x = wave(imin(t, 820), 300) * 6 / 128;
    int r = t < 820 ? 11 : imax(0, 11 - (t - 820) * 11 / 90);
    uint32_t c = mix(col, C_WHITE, tent(t - 820, 120) * 200 / 255);
    int ra = t - 840, rr = ra * 110 / 1000, rf = ra > 0 ? imax(0, 255 - ra * 255 / 600) : 0;
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        if (r) lavaPut(i, blob(p - x, q - y, r), c, wc, fo);
        if (rf) put(i, wc, tent(oct(p - x, q - y) - rr, 6) * rf / 255 * fo / 255);
    }
}

// ----- 7 · Мордашка: Kaya as a tiny face, two eyes in row 2 and a mouth in rows 4–6, never text

// e: the eyes (0 ovals, 1 happy «^», 2 «×»); oL, oR: how open each oval is (0 a line, 255 open, up to 400 wide);
// gx, gy: where they look (1/8 ball); mc: the mouth's curve (corners up +, down −), mw: its half-width, mo: how open
// (0 a line); mx: the mouth's shift; g: how much shows. The face takes the display: the time steps back under it.
static void face(int e, int oL, int oR, int gx, int gy, int mc, int mw, int mo, int mx, uint32_t col, int g) {
    if (g <= 0) return;
    dimAll(255 - 170 * g / 255);
    fr.dg = 255;
    uint32_t wc = mix(col, C_WHITE, 110);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int o = imax(0, p < 0 ? oL : oR), kind = e == 1 && !o ? 0 : e;  // a winking «^» shuts into a line
        int ex = (p < 0 ? p + 32 : p - 32) - (kind ? 0 : gx), ey = q + 7 - (kind ? 0 : gy);  // from the eye's centre
        int a = 0;
        uint32_t c = col;
        if (abs(ex) < 20 && abs(ey) < 24) {
            if (!kind) {
                int wd = imax(0, o - 255), el = ell(ex, ey, 11 + wd * 5 / 145, 1 + imin(o, 255) * 10 / 255 + wd * 8 / 145);
                a = el <= 256 ? 255 : el < 420 ? (420 - el) * 255 / 164 : 0;
                if (el < 90) c = wc;
            } else if (kind == 1) {  // «^»: rows 1–2, 4 and 8 to each side
                int ax = abs(ex);
                if ((abs(ey + 7) < 3 && abs(ax - 4) < 3) || (abs(ey) < 3 && abs(ax - 8) < 3)) a = 255;
            } else if (abs(ey) <= 16 && abs(abs(ex) * 7 - abs(ey) * 4) < 10) {  // «×»: rows 0–4
                a = 255;
            }
        }
        int dx = p - mx;
        if (q >= 0 && abs(dx) <= mw + 8) {  // the mouth round (mx, 14)
            int m = 0;
            if (mo > 0) {
                int el = ell(dx, q - 14, mw, 1 + mo);
                m = el <= 256 ? (mo > 5 && el < 100 ? 110 : 255) : el < 400 ? (400 - el) * 255 / 144 : 0;
            } else if (abs(dx) <= mw) {
                m = tent(q - 14 + mc * dx * dx / (mw * mw), 6);
            }
            if (m > a) {
                a = m;
                c = col;
            }
        }
        put(i, c, a * g / 255);
    }
}

// Слушает · Смотрит: she looks at you with a gentle smile, blinks every 4.2 s (twice every other time), now and then glances aside
static void faceListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int ph = posMod(t, 8400), b = ph < 4200 ? ph : ph - 4200, g3 = posMod(t, 12600);
    int o = 255 - imax(tent(b - 4000, 110), ph >= 4200 ? tent(b - 3700, 110) : 0);
    int gx = -(8 * smooth(6000, 6300, g3) / 255) + 8 * smooth(8000, 8300, g3) / 255;
    face(0, o, o, gx, 0, 7, 16, 0, 0, col, k);
}

// Думает · Задумалась: half-shut eyes look up to the left, then up to the right; the mouth a short line to one side: «hmm»
static void faceThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int ph = posMod(t, 3200), gx = -10 + 20 * smooth(1400, 1700, ph) / 255 - 20 * smooth(2900, 3200, ph) / 255;
    face(0, 190, 190, gx, -6, 0, 8, 0, 12, mix(col, C_VIOLET, 128), k);
}

// Говорит · Говорит: the mouth opens with the voice; loud, the eyes narrow a little; a blink now and then
static void faceSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int v = voice(t), mo = v * 11 / 255, o = 255 - (v >> 3) - tent(posMod(t, 5300) - 5100, 110);
    face(0, o, o, 0, 0, 3, 14 + (mo >> 1), mo, 0, col, k);
}

// Пробуждение · Просыпается: closed eyes fade in, open, blink once, and a smile comes
static void faceWake(Anim, int t, int du, uint32_t col) {
    int g = smooth(0, 300, t) * smooth(du, du - 400, t) / 255;
    int o = smooth(500, 850, t) * (255 - tent(t - 1150, 110)) / 255;
    face(0, o, o, 0, 0, 7 * smooth(1300, 1650, t) / 255, 16, 0, 0, col, g);
}

// Готово · Подмигивает: happy «^ ^» eyes and a wide smile; at 0.65 s she winks with the right eye
static void faceDone(Anim, int t, int du, uint32_t col) {
    int g = smooth(0, 150, t) * smooth(du, du - 300, t) / 255;
    face(1, 255, t > 650 && t < 1000 ? 0 : 255, 0, 0, 10 * smooth(0, 250, t) / 255, 20, 0, 0, col, g);
}

// Ошибка · Огорчение: the eyes turn into «×», the mouth into a frown; the face blinks out twice
static void faceError(Anim, int t, int du, uint32_t col) {
    bool on = t < 700 || (t >= 820 && t < 1000) || t >= 1120;
    face(2, 255, 255, 0, 0, -7, 16, 0, 0, col, (on ? smooth(0, 120, t) : 60) * smooth(du, du - 300, t) / 255);
}

// Уведомление · Удивление: the eyes pop wide, ease and pop again (a double take); the mouth a small «o»
static void faceNotify(Anim, int t, int du, uint32_t col) {
    int o = 255 + 145 * smooth(150, 260, t) / 255 - 145 * smooth(560, 660, t) / 255 + 145 * smooth(760, 860, t) / 255;
    face(0, o, o, 0, 0, 0, 7, 5, 0, col, smooth(0, 120, t) * smooth(du, du - 300, t) / 255);
}

// ----- 8 · Галактика: a two-armed spiral, (2·b_ang + 9·d − rot) & 255, and stars on h1

// the arms at the ball (d: its distance as drawn): 255 on an arm, 0 between them
static int arm(uint8_t i, int d, int rot) {
    int v = (b_ang[i] * 2 + d * 9 - rot) & 255;
    return tent(imin(v, 256 - v), 40);
}

// a star twinkling on about one ball in six (h1 < 40), away from the core: 0..150
static int galStar(uint8_t i, int t) {
    if (h1(i) >= 40 || b_dist[i] <= 8) return 0;
    int s = sin8((h2(i) + t * (150 + (h3(i) & 63)) / 1000) & 255);
    return 150 * (s * s / 255) / 255;
}

// Слушает · Спираль: two arms turn slowly (they meet themselves every 10 s), the core glows evenly, the stars twinkle
static void galListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int rot = t * 256 / 10000;
    uint32_t wc = mix(col, C_WHITE, 170);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int d = b_dist[i];
        int a = arm(i, d, rot) * (170 - d * 3) / 255;
        uint32_t c = col;
        if (d < 6) {
            a = imax(a, 230 - d * 20);
            c = wc;
        }
        int s = galStar(i, t);
        if (s > a) {
            a = s;
            c = wc;
        }
        put(i, c, a * k / 255);
    }
}

// Думает · Вихрь ядра: the arms turn faster, and in the core a four-armed whirl turns the other way, fast; half violet
static void galThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t c = mix(col, C_VIOLET, 128), wc = mix(c, C_WHITE, 170);
    int rot = t * 256 / 2600, sw = t * 256 / 600;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int d = b_dist[i];
        int a = arm(i, d, rot) * (150 - d * 3) / 255;
        uint32_t cc = c;
        if (d < 14) {
            int v = (b_ang[i] * 4 - d * 18 + sw) & 255, s = tent(imin(v, 256 - v), 40) * (14 - d) / 14;
            if (s > a) {
                a = s;
                cc = wc;
            }
        }
        if (d < 3) {
            a = 255;
            cc = wc;
        }
        a = imax(a, galStar(i, t) >> 1);
        put(i, cc, a * k / 255);
    }
}

// Говорит · Пульс ядра: the core swells with the voice; the arms flare a beat later
static void galSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int v = voice(t), ag = 60 + voice(t - 160) * 140 / 255, rot = t * 256 / 12000;
    uint32_t wc = mix(col, C_WHITE, 180);
    int rc = 3 + v * 10 / 255;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int d = b_dist[i];
        int a = arm(i, d, rot) * ag / 255 * (255 - d * 4) / 255;
        uint32_t c = col;
        if (d <= rc) {
            a = 255 - d * 60 / (rc + 1);
            c = wc;
        } else if (d <= rc + 3) {
            a = imax(a, 120 * (rc + 4 - d) / 4);
        }
        a = imax(a, galStar(i, t) >> 1);
        put(i, c, a * k / 255);
    }
}

// Пробуждение · Большой взрыв: a white flash in the middle, a ring flying out; the arms grow from the core and wind; stars come out
static void galWake(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t);
    uint32_t wc = mix(col, C_WHITE, 200);
    int fl = tent(t - 120, 200), rr = t * 900 / 1000, rf = imax(0, 255 - t * 255 / 700);
    int R = smooth(250, 1500, t) * 40 / 255, rot = 200 - 200 * smooth(250, 1700, t) / 255, sd = smooth(700, 1500, t) * 40 / 255;
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int d = b_dist[i];
        int a = 0;
        uint32_t c = col;
        if (d <= R) a = arm(i, d, rot) * (200 - d * 3) / 255;
        if (d < 5 && t > 150) a = imax(a, 200);
        int fv = imax(fl * tent(d, 14) / 255, tent(d * 16 - rr, 100) * rf / 255);
        if (fv > a) {
            a = fv;
            c = wc;
        }
        if (h1(i) < sd) a = imax(a, galStar(i, t));
        put(i, c, a * fo / 255);
    }
}

// Готово · Сверхновая: the star swells and blows up: a flash, a ring out past the edge, an uneven glow of the remnant, then calm
static void galDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), core = t < 380 ? 2 + t / 90 : 0;
    uint32_t wc = mix(col, C_WHITE, 210);
    int age = t - 380, rr = age * 700 / 1000, rf = age > 0 ? imax(0, 255 - age * 255 / 900) : 0;
    int fl = tent(age - 40, 160) * 150 / 255, neb = age > 0 ? smooth(0, 300, age) * (255 - smooth(500, 1300, age)) / 255 : 0;
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int d = b_dist[i];
        int a = fl;
        uint32_t c = fl > 60 ? wc : col;
        if (d <= core) {
            a = 255;
            c = wc;
        }
        if (rf) {
            int v = tent(d * 16 - rr, 90) * rf / 255;
            if (v > a) {
                a = v;
                c = wc;
            }
        }
        if (neb && d < 24) a = imax(a, (80 + (h1(i) >> 1)) * (24 - d) / 24 * neb / 255);  // the remnant glows unevenly
        if (age > 300 && d < 3) a = imax(a, 170);
        put(i, c, a * fo / 255);
    }
}

// Ошибка · Чёрная дыра: the galaxy shrinks into the middle winding faster and faster, the display darkens; a dark hole with a ring stays
static void galError(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), z = smooth(0, 1000, t) * 3, rot = t * t / 2400;
    int hole = smooth(900, 1100, t), ring = tent(t - 1150, 300);
    dimAll(255 - 180 * smooth(300, 1000, t) / 255 * fo / 255);
    fr.dg = 200;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int d = b_dist[i], dz = d * (256 + z) >> 8;  // the galaxy drawn (256 + z)/256 times smaller
        int a = 0;
        if (dz < 38) a = arm(i, dz, rot) * (220 - dz * 5) / 255;
        if (dz < 5) a = imax(a, 230);
        a = a * (255 - hole) / 255;
        if (d >= 3 && d <= 6) a = imax(a, ring * (255 - abs(d - 4) * 50) / 255);
        put(i, col, a * fo / 255);
    }
}

// Уведомление · Комета: a comet with a long tail crosses the display on a slant over faint stars
static void galNotify(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t);
    uint32_t wc = mix(col, C_WHITE, 200);
    int hx = -96 + 192 * t / 1200, hy = -20 + 36 * t / 1200, tl[4] = {hx - 52, hy - 10, hx, hy};
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = galStar(i, t) >> 2;
        uint32_t c = col;
        int d = segDist(p, q, tl, 256);
        if (d < 8) {
            int u = ((p - tl[0]) * 52 + (q - tl[1]) * 10) * 255 / 2804;  // 0 at the tail's end, 255 at the head
            a = imax(a, tent(d, 8) * imax(0, imin(255, u)) / 255);
        }
        int hd = oct(p - hx, q - hy);
        if (hd < 10) {
            a = imax(a, tent(hd, 10));
            if (hd < 5) c = wc;
        }
        put(i, c, a * fo / 255);
    }
}

// ----- 9 · Сканер: the Knight Rider light, a band across all rows, brightest in the middle one

static const uint8_t scan_row[7] PROGMEM = {90, 150, 215, 255, 215, 150, 90};

// Слушает · Луч: one soft beam sweeps left and right (3.2 s there and back) with a fading trail over a faint bar
static void scanListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int bx[4];
    uint32_t wc = mix(col, C_WHITE, 140);
    for (int m = 0; m < 4; m++) bx[m] = wave(t - m * 70, 80) * 70 / 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), r = b_row(i);
        int a = 0;
        for (int m = 0; m < 4; m++) a = imax(a, tent(p - bx[m], 10) * (255 - m * 60) / 255);
        a = a * pgm_read_byte(&scan_row[r]) / 255;
        if (r == 3) a = imax(a, 10);
        put(i, abs(p - bx[0]) < 5 ? wc : col, a * k / 255);
    }
}

// Думает · Два луча: two beams run towards each other and cross in the middle with a flash; half violet
static void scanThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t c = mix(col, C_VIOLET, 128), wc = mix(c, C_WHITE, 170);
    int bx[3];
    for (int m = 0; m < 3; m++) bx[m] = wave(t - m * 30, 200) * 70 / 128;
    int x = tent(bx[0], 12);  // the crossing
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), r = b_row(i);
        int a = 0;
        for (int m = 0; m < 3; m++) a = imax(a, imax(tent(p - bx[m], 9), tent(p + bx[m], 9)) * (255 - m * 75) / 255);
        a = a * pgm_read_byte(&scan_row[r]) / 255;
        if (r == 3) a = imax(a, 10);
        put(i, x > 100 && abs(p) < 12 ? wc : c, a * k / 255);
    }
}

// Говорит · Ширина голосом: the beam stands near the middle; its width and brightness follow the voice
static void scanSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int v = voice(t), bx = wave(t, 40) * 24 / 128, w = 6 + v * 46 / 255;
    uint32_t wc = mix(col, C_WHITE, 150 * v / 255);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), r = b_row(i), e = w - abs(p - bx);
        int a = r == 3 ? 10 : 0;
        if (e > -8) a = imax(a, (e >= 0 ? 150 + 105 * imin(e, 16) / 16 : (8 + e) * 150 / 8) * pgm_read_byte(&scan_row[r]) / 255);
        put(i, abs(p - bx) < 6 ? wc : col, a * k / 255);
    }
}

// Пробуждение · Запуск: the middle row lights from the centre out a ball at a time, gathers into one beam; it sweeps right, then left
static void scanWake(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t), sq = smooth(650, 900, t);
    uint32_t wc = mix(col, C_WHITE, 160);
    int hw = (smooth(0, 500, t) * 80 / 255) & ~7, L = hw - hw * sq / 255;
    int bx = 0;
    if (t >= 1300) bx = 64 - 128 * smooth(1300, 1800, t) / 255;
    else if (t >= 900) bx = 64 * smooth(900, 1300, t) / 255;
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), r = b_row(i);
        int a = 0;
        uint32_t c = col;
        if (t < 900) {
            if (r == 3 && abs(p) <= L + 4) {
                a = 255;
                if (abs(p) > L - 8) c = wc;
            }
            if (sq) a = imax(a, tent(p, 10) * pgm_read_byte(&scan_row[r]) / 255 * sq / 255);
        } else {
            a = tent(p - bx, 10) * pgm_read_byte(&scan_row[r]) / 255;
            if (r == 3) a = imax(a, 10);
            if (abs(p - bx) < 5) c = wc;
        }
        put(i, c, a * fo / 255);
    }
}

// Готово · Проход: the beam runs right with a long trail, turns, and all it passes on the way back stays lit; a flash
static void scanDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), fl = tent(t - 1180, 180);
    uint32_t wc = mix(col, C_WHITE, 170);
    bool back = t >= 600;
    int bx = back ? 80 - 160 * smooth(600, 1100, t) / 255 : -80 + 160 * smooth(0, 600, t) / 255;
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), sr = pgm_read_byte(&scan_row[b_row(i)]);
        int a = tent(p - bx, 10) * sr / 255;
        if (!back && p < bx) a = imax(a, tent(bx - p, 70) * 3 / 4 * sr / 255);  // the trail
        if (back && p > bx) a = imax(a, 140);                                   // lit behind it
        a = imax(a, fl);
        put(i, fl > 100 || abs(p - bx) < 5 ? wc : col, a * fo / 255);
    }
}

// Ошибка · Сбой: the beam stutters, jumping and dropping out in 90 ms steps, then freezes, flickers and dies
static void scanError(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), sl = imin(t, 900) / 90, h = hash8(sl);
    int bx = wave(sl * 90, 160) * 60 / 128 + (h & 31) - 16;
    int g = 255;
    if (t < 900) g = hash8(sl + 101) < 70 ? 40 : 255;
    else if (t < 1250) g = (t / 60) & 1 ? 255 : 90;
    else g = 255 - smooth(1250, 1500, t);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), r = b_row(i);
        int a = tent(p - bx, 10) * pgm_read_byte(&scan_row[r]) / 255 * g / 255;
        if (r == 3) a = imax(a, 20);
        put(i, col, a * fo / 255);
    }
}

// Уведомление · Три прохода: three fast sweeps, there, back and there again, 0.38 s each, with a long trail
static void scanNotify(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), bx[4];
    uint32_t wc = mix(col, C_WHITE, 160);
    for (int m = 0; m < 4; m++) {
        int u = imax(0, t - m * 30), s = (u % 380) * 168 / 380;
        bx[m] = u >= 1140 ? 999 : ((u / 380) & 1) ? 84 - s : -84 + s;
    }
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), r = b_row(i);
        int a = 0;
        for (int m = 0; m < 4; m++) a = imax(a, tent(p - bx[m], 10) * (255 - m * 55) / 255);
        a = a * pgm_read_byte(&scan_row[r]) / 255;
        if (r == 3) a = imax(a, 14);
        put(i, abs(p - bx[0]) < 5 ? wc : col, a * fo / 255);
    }
}

// ================= Kaya's styles of v1.9, part 1 (KAIA-201's catalog A: web/src/nature.js, line by line) =================
// As the styles of v1.8: a style is a whole visual language, its own version of all 7 events; kaia_anim 10–12 picks one
// as the style, and its versions join every event's list (looks 15–17, wakes 21–23; look_style, wake_style).
//   10 Снежинка, 11 Светлячки, 12 Пламя (the catalog's default: the cold flame in Kaya's colour)
// The wakes fade out over their last 400 ms (wakeDraw fades the listening in under their last 800), the other
// one-shots over their last 300 ms; the states loop. The small tables are in PROGMEM; the arrays of a frame are on the
// stack, sized as the loop that fills them.
// p = 4·(x − 19), q = 7·(row − 3): a ball from the middle in 1/8 balls (p to the right, q down), as in KAIA-173 and KAIA-195

// a soft falloff: 255 at x = 0, easing down to 0 at |x| = w (a smoothstep of tent)
static int bell(int x, int w) {
    int u = tent(x, w);
    if (!u) return 0;
    return u * u * (765 - 2 * u) / 65025;
}

// a slow glitter of ball i, 0..255: sin² at its own pace (rate + 0..63, 256 = a turn a second) from its own phase
static int glint(uint8_t i, int t, int rate) {
    int s = sin8((h2(i) + (t * (rate + (h3(i) & 63)) / 1000)) & 255);
    return s * s / 255;
}

// ----- 10 · Снежинка: a flake on the balls' own lattice; frost that grows, glitters and thaws
// u, v: the ball's place in the diagonal grid from the flake's centre (col 10, row 3). The six arms run along the grid's
// own lines (v = 0, u = 0, u = v), so every arm is a straight line of three balls; round each tip, two balls of frost.

// the ball's place on the flake: D | s << 2 | k << 3, or −1 off it. D: the hex distance from the centre (0..3); s = 1 on
// the frost round a tip (D = 3, one off an arm), 0 on an arm; k: the arm (0 at 1 o'clock, clockwise) or, for the frost,
// the gap after arm k
static int flakeGeo(uint8_t i) {
    int u = b_col(i) - 10, v = b_row(i) - 3, w = u - v;
    int D = imax(abs(u), imax(abs(v), abs(w))), s = imin(abs(u), imin(abs(v), abs(w)));
    if (D > 3 || (s && D < 3)) return -1;
    int k;
    if (!s) k = !v ? (u > 0 ? 1 : 4) : !u ? (v < 0 ? 0 : 3) : u > 0 ? 2 : 5;
    else k = u > 0 ? (v < 0 ? 0 : v < u ? 1 : 2) : v > 0 ? 3 : v > u ? 4 : 5;
    return D | (s ? 4 : 0) | (k << 3);
}

// how lit a flake ball is, 0..255: the arms grown out to la (1/16 ball from the centre: 48 = three balls) and in from the
// tips to li (64 = all the way in); the frost of gap k grown to lb[k] (16 = all of it), fainter than the arms
static int flakeLit(int g, int la, int li, const int* lb) {
    int D = g & 3, s = (g >> 2) & 1, b = D - s;
    int a = imin(255, imax(0, (la - b * 16 + 8) * 16));
    a = imin(a, imin(255, imax(0, (li - (3 - b) * 16 + 8) * 16)));
    if (s) a = imin(a, imin(255, imax(0, lb[(g >> 3) & 7] * 16))) * 150 / 255;
    return a;
}

// frost on the rim: about one ball in five glittering slowly, the rest dark
static int rime(uint8_t i, int t) {
    if (ringOf(i) || h1(i) >= 50) return 0;
    return 10 + (110 * glint(i, t, 60) / 255);
}

// Пробуждение · Иней: frost creeps in from the rim towards the middle, then melts back out and leaves the flake, grown in
// from its tips; its centre flashes as the arms meet
static void snowWake(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t);
    uint32_t wc = mix(col, C_WHITE, 200);
    int f = smooth(0, 750, t) * 60 / 255, mb = smooth(650, 1350, t) * 60 / 255;  // the frost's front in, and how far it has melted back
    int li = smooth(700, 1350, t) * 64 / 255, fl = tent(t - 1400, 260), rm = smooth(900, 1600, t), lb[6] = {0, 0, 0, 0, 0, 0};
    for (int j = 0; j < 6; j++) lb[j] = 16 - (smooth(1300, 1700, t) * 16 / 255);  // the tips keep their frost a moment
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int r = ringOf(i), g = flakeGeo(i);
        int a = (imin(255, imax(0, (f - r * 16) * 16)) * (40 + (h1(i) >> 1)) / 255) * (255 - imin(255, imax(0, (mb - (3 - r) * 16) * 16))) / 255;
        uint32_t c = mix(col, wc, h2(i) >> 2);
        if (!r) a = imax(a, rime(i, t) * rm / 255);
        if (g >= 0) {
            int fa = flakeLit(g, 48, li, lb);
            if (fa > a) {
                a = fa;
                c = mix(col, wc, tent(li - (3 - (g & 3) + ((g >> 2) & 1)) * 16, 16));  // the growing tips white
            }
            if (fl) {
                a = imax(a, fl);
                c = mix(col, wc, fl);
            }
        }
        if (a) put(i, c, a * fo / 255);
    }
}

// Слушает · Блеск: the flake hangs still and glitters: a glint runs out along one arm after another, clockwise, 0.8 s each;
// a little snow falls at the sides, and frost glitters here and there on the rim
static const int8_t snow_fx[4] PROGMEM = {-60, -38, 42, 64};  // where the snow falls, 1/8 ball
static void snowListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int lb[6] = {0, 0, 0, 0, 0, 0};
    uint32_t wc = mix(col, C_WHITE, 210);
    int br = 200 + (wave(t, 45) * 40 / 128), fx[4], fy[4];
    int ph = posMod(t, 4800), ga = ph / 800, gp = ((ph - ga * 800) * 72 / 800) - 8;  // the glint: on arm ga, gp/16 ball out
    for (int j = 0; j < 4; j++) {  // the snow: four flakes falling slowly, each at its own pace
        int per = 5200 + j * 700;
        fx[j] = (int8_t)pgm_read_byte(&snow_fx[j]) + (wave(t + j * 600, 60) * 4 / 128);
        fy[j] = -26 + (posMod(t + j * 1900, per) * 54 / per);
    }
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3), g = flakeGeo(i);
        int a = rime(i, t);
        uint32_t c = col;
        for (int j = 0; j < 4; j++) {
            if (abs(p - fx[j]) >= 8 || abs(q - fy[j]) >= 8) continue;
            int v = bell(oct(p - fx[j], q - fy[j]), 8) * 120 / 255;
            if (v > a) {
                a = v;
                c = wc;
            }
        }
        if (g >= 0 && !((g >> 2) & 1)) {
            int D = g & 3;
            a = imax(a, flakeLit(g, 48, 64, lb) * br / 255);
            c = col;
            if (!D || ((g >> 3) & 7) == ga) {
                int v = tent(D * 16 - gp, 20);
                a = imax(a, v);
                c = mix(col, wc, v);
            }
        }
        if (a) put(i, c, a * k / 255);
    }
}

// Думает · Иней на кончиках: the frost round the tips grows and melts gap after gap round the flake, 1.2 s a round, and a
// soft light circles with it; half violet
static void snowThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t c0 = mix(col, C_VIOLET, 128), wc = mix(c0, C_WHITE, 180);
    int G = t * 256 / 1200, lb[6] = {0, 0, 0, 0, 0, 0};
    for (int j = 0; j < 6; j++) {
        int u = posMod(t - j * 200, 1200);
        lb[j] = (u < 600 ? smooth(0, 500, u) : 255 - smooth(600, 1100, u)) * 16 / 255;
    }
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int g = flakeGeo(i);
        int a = rime(i, t) >> 1;
        uint32_t c = c0;
        if (g >= 0) {
            int fa = flakeLit(g, 48, 64, lb);
            if (fa) {
                int d = (G - ((((g >> 3) & 7) * 2 + ((g >> 2) & 1)) * 256 / 12)) & 255, v = d < 90 ? (90 - d) * 255 / 90 : 0;
                a = imax(a, fa * (140 + (v * 115 / 255)) / 255);
                c = mix(c0, wc, v * v / 510);
            }
        }
        if (a) put(i, c, a * k / 255);
    }
}

// Говорит · Рост голосом: the arms reach out with the voice, the frost at the tips follows a beat later; loud, the tips go white
static void snowSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int v = voice(t), v2 = voice(t - 110), la = 18 + (v * 30 / 255);
    uint32_t wc = mix(col, C_WHITE, 200);
    int lb[6] = {0, 0, 0, 0, 0, 0};
    for (int j = 0; j < 6; j++) lb[j] = v2 * 16 / 255;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int g = flakeGeo(i);
        int a = rime(i, t) >> 1;
        uint32_t c = col;
        if (g >= 0) {
            int fa = flakeLit(g, la, 64, lb);
            if (fa > a) {
                a = fa;
                c = mix(col, wc, tent(la - ((g & 3) - ((g >> 2) & 1)) * 16 - 8, 14) * v / 255);  // the tips
            }
        }
        if (a) put(i, c, a * k / 255);
    }
}

// Готово · Идеальная снежинка: the flake grows whole with its frost in half a second, flashes white, and a ring of glitter
// runs out over the display
static void snowDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t);
    uint32_t wc = mix(col, C_WHITE, 210);
    int la = smooth(0, 450, t) * 48 / 255, lb[6] = {0, 0, 0, 0, 0, 0};
    for (int j = 0; j < 6; j++) lb[j] = smooth(250, 600, t) * 16 / 255;
    int fl = tent(t - 650, 260), age = t - 650, rr = age * 640 / 1000, rf = age > 0 ? imax(0, 255 - (age * 255 / 900)) : 0;
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int g = flakeGeo(i);
        int a = 0;
        uint32_t c = col;
        if (rf && h1(i) < 150) {  // the ring of glitter
            a = (tent(b_dist[i] * 16 - rr, 70) * rf / 255) * (60 + (h1(i) >> 1)) / 255;
            c = mix(col, wc, h2(i) >> 1);
        }
        if (g >= 0) {
            int fa = flakeLit(g, la, 64, lb);
            if (fa && fa >= a) {
                a = fa;
                c = mix(col, wc, fl);
            }
        }
        if (a) put(i, c, a * fo / 255);
    }
}

// Ошибка · Оттепель: the frost melts off the tips, the arms shrink back to the centre, and drops run off them and fall
static const int8_t snow_dx[4] PROGMEM = {28, -20, 12, -4}, snow_dq[4] PROGMEM = {0, 0, 14, 14};  // where the drops fall from (1/8 ball)
static const int16_t snow_dt[4] PROGMEM = {350, 500, 650, 800};                                     // and when (ms)
static void snowError(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), la = 48 - (smooth(300, 1300, t) * 48 / 255), g0 = 255 - (smooth(200, 1300, t) * 90 / 255);
    int lb[6] = {0, 0, 0, 0, 0, 0}, dy[4] = {0, 0, 0, 0}, da[4] = {0, 0, 0, 0};
    uint32_t wc = mix(col, C_WHITE, 110);
    for (int j = 0; j < 6; j++) lb[j] = 16 - (smooth(100, 550, t) * 16 / 255);
    for (int j = 0; j < 4; j++) {
        int u = imax(0, t - (int16_t)pgm_read_word(&snow_dt[j]));
        dy[j] = (int8_t)pgm_read_byte(&snow_dq[j]) + (u * u / 7000);
        da[j] = u > 0 ? imax(0, 255 - (u * 255 / 900)) : 0;
    }
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3), g = flakeGeo(i);
        int a = g >= 0 ? flakeLit(g, la, 64, lb) * g0 / 255 : 0;
        uint32_t c = col;
        for (int j = 0; j < 4; j++) {
            if (!da[j] || abs(p - (int8_t)pgm_read_byte(&snow_dx[j])) >= 6 || abs(q - dy[j]) >= 11) continue;
            int v = bell(oct((p - (int8_t)pgm_read_byte(&snow_dx[j])) * 2, q - dy[j]), 11) * da[j] / 255;  // a drop, taller than wide
            if (v > a) {
                a = v;
                c = wc;
            }
        }
        if (a) put(i, c, a * fo / 255);
    }
}

// Уведомление · Блик по кругу: a bright glint runs round the six arms twice with a short trail, then the whole flake flashes
static void snowNotify(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t);
    uint32_t wc = mix(col, C_WHITE, 200);
    int G = t * 512 / 1300, all = tent(t - 1420, 200), lb[6];
    for (int j = 0; j < 6; j++) lb[j] = 16;  // {16, …} as a loop: an initializer would be a copy in .rodata, which is RAM
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int g = flakeGeo(i);
        int a = rime(i, t) >> 1;
        uint32_t c = col;
        if (g >= 0) {
            int e = G - ((((g >> 3) & 7) * 2 + ((g >> 2) & 1)) * 256 / 12);
            int v = t < 1300 && e >= 0 && (e & 255) < 80 ? (80 - (e & 255)) * 255 / 80 : 0;
            a = imax(a, flakeLit(g, 48, 64, lb) * (70 + (imax(v, all) * 185 / 255)) / 255);
            c = mix(col, wc, imax(v * v / 255, all));
        }
        if (a) put(i, c, a * fo / 255);
    }
}

// ----- 11 · Светлячки: soft lights that drift, circle and gather; each glows up and down at its own pace

static const int8_t ff_bx[6] PROGMEM = {-54, -32, -10, 12, 34, 56};  // where each one drifts about, 1/8 ball
static const int8_t ff_wx[6] PROGMEM = {9, 13, 7, 11, 15, 8}, ff_wy[6] PROGMEM = {17, 12, 21, 15, 10, 19};  // each one's slow drift, 256 = a turn a second

// where firefly j drifts at t (while Kaya listens), 1/8 ball: round its own place, a slow wave and a small quicker one each way
static int flyX(int j, int t) {
    return (int8_t)pgm_read_byte(&ff_bx[j]) + (wave(t + j * 1700, (int8_t)pgm_read_byte(&ff_wx[j])) * 24 / 128) + (wave(t + j * 900, 41 + j * 7) * 8 / 128);
}

static int flyY(int j, int t) {
    return (wave(t + j * 1100, (int8_t)pgm_read_byte(&ff_wy[j])) * 13 / 128) + (wave(t + j * 500, 53 + j * 9) * 4 / 128);
}

// how bright firefly j glows at t: up and down, each at its own pace (2.6–4.1 s)
static int flyGlow(int j, int t) {
    int s = sin8(((t * (62 + j * 7) / 1000) + j * 43) & 255);
    return 60 + (195 * (s * s / 255) / 255);
}

// m lights (at most 18) at (px[j], py[j]), each as bright as gl[j]: a soft glow a ball and a quarter across that whitens
// at its core; where two meet, their light adds up
static void flies(int m, const int* px, const int* py, const int* gl, uint32_t col, int g) {
    uint32_t wc = mix(col, C_WHITE, 170);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = 0, w = 0;
        for (int j = 0; j < m; j++) {
            int dx = p - px[j], dy = q - py[j];
            if (!gl[j] || dx >= 10 || dx <= -10 || dy >= 10 || dy <= -10) continue;
            int d = oct(dx, dy);
            if (d >= 10) continue;
            int v = bell(d, 10) * gl[j] / 255;
            a += v;
            if (d < 5) w = imax(w, v);
        }
        if (a) put(i, mix(col, wc, w), imin(255, a) * g / 255);
    }
}

// Пробуждение · Слетаются: the fireflies fly in from beyond the edges one after another and settle into their drift
static const int8_t ff_in[12] PROGMEM = {-104, -16, -40, -44, -16, 44, 20, -44, 100, 12, 104, -20};  // where each comes from, (p, q)
static void flyWake(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t), lt = t - du, px[12], py[12], gl[12];
    fr.dg = 128;
    for (int j = 0; j < 6; j++) {
        int u0 = smooth(j * 130, j * 130 + 1000, t), u1 = smooth(j * 130, j * 130 + 1000, t - 80), x0 = (int8_t)pgm_read_byte(&ff_in[2 * j]), y0 = (int8_t)pgm_read_byte(&ff_in[2 * j + 1]);
        int dx = flyX(j, lt) - x0, dy = flyY(j, lt) - y0;
        px[2 * j] = x0 + (dx * u0 / 255);
        py[2 * j] = y0 + (dy * u0 / 255);
        px[2 * j + 1] = x0 + (dx * u1 / 255);
        py[2 * j + 1] = y0 + (dy * u1 / 255);
        gl[2 * j] = 120 + (135 * smooth(j * 130, j * 130 + 300, t) / 255);
        gl[2 * j + 1] = imin(110, (u0 - u1) * 4);  // the trail, only while it flies
    }
    flies(12, px, py, gl, col, fo);
}

// Слушает · Огоньки: six fireflies drift slowly about the display, each glowing up and down at its own pace
static void flyListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int px[6], py[6], gl[6];
    for (int j = 0; j < 6; j++) {
        px[j] = flyX(j, t);
        py[j] = flyY(j, t);
        gl[j] = flyGlow(j, t);
    }
    flies(6, px, py, gl, col, k);
}

// Думает · Хоровод: the six circle the middle one after another (3 s a turn), each with a short trail; half violet
static void flyThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int px[18], py[18], gl[18];
    for (int j = 0; j < 6; j++) {
        int rad = 44 + (wave(t + j * 400, 90) * 8 / 128);
        for (int m = 0; m < 3; m++) {
            int th = ((t - m * 60) * 256 / 3000) + j * 43, e = j * 3 + m;
            px[e] = (sin8((th + 64) & 255) - 128) * rad / 128;
            py[e] = (sin8(th & 255) - 128) * 13 / 128;
            gl[e] = m ? 100 - m * 30 : 170 + (flyGlow(j, t) * 85 / 255);
        }
    }
    flies(18, px, py, gl, mix(col, C_VIOLET, 128), k);
}

// Говорит · Хор: the fireflies hang in a loose row and glow with the voice two by two, each pair a beat after the last
static void flySpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int px[6], py[6], gl[6], v[3] = {voice(t), voice(t - 90), voice(t - 180)};
    for (int j = 0; j < 6; j++) {
        px[j] = -55 + j * 22 + (wave(t + j * 800, 37) * 6 / 128);
        py[j] = (j & 1 ? 5 : -5) + (wave(t + j * 600, 29) * 6 / 128);
        gl[j] = 45 + (v[j >> 1] * 210 / 255);
    }
    flies(6, px, py, gl, col, k);
}

// Готово · Рой: the fireflies gather into one bright cluster in the middle, flare up together, and it glows and turns
static void flyDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), u = smooth(0, 650, t), fl = tent(t - 780, 320), px[6], py[6], gl[6];
    fr.dg = 128;
    for (int j = 0; j < 6; j++) {
        int th = (t * 256 / 1400) + j * 43, x0 = flyX(j, 0), y0 = flyY(j, 0);
        px[j] = x0 + ((((sin8((th + 64) & 255) - 128) * 8 / 128) - x0) * u / 255);
        py[j] = y0 + ((((sin8(th & 255) - 128) * 4 / 128) - y0) * u / 255);
        gl[j] = 150 + (105 * imax(u, fl) / 255);
    }
    flies(6, px, py, gl, mix(col, C_WHITE, fl * 160 / 255), fo);
    if (fl) {
        for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
            int p = 4 * (b_x(i) - 19);
            if (abs(p) < 40) put(i, col, (bell(oct(p, 14 * (b_row(i) - 3)), 40) * fl / 255) * fo / 400);  // its halo
        }
    }
}

// Ошибка · Разлетелись: the fireflies startle and scatter out past the edges, going out one after another
static void flyError(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), st = tent(t - 60, 140), px[12], py[12], gl[12];
    fr.dg = 128;
    for (int j = 0; j < 6; j++) {
        int x0 = flyX(j, 0), y0 = flyY(j, 0), dx = x0 * 2 + (x0 < 0 ? -70 : 70), dy = y0 * 2 + (y0 < 0 ? -22 : 22);
        int u0 = smooth(120 + j * 40, 1000 + j * 40, t), u1 = smooth(120 + j * 40, 1000 + j * 40, t - 60), out = 255 - smooth(350 + j * 90, 950 + j * 90, t);
        px[2 * j] = x0 + (dx * u0 / 255);
        py[2 * j] = y0 + (dy * u0 / 255);
        px[2 * j + 1] = x0 + (dx * u1 / 255);
        py[2 * j + 1] = y0 + (dy * u1 / 255);
        gl[2 * j] = (200 + (st * 55 / 255)) * out / 255;
        gl[2 * j + 1] = imin(110, (u0 - u1) * 4) * out / 255;
    }
    flies(12, px, py, gl, col, fo);
}

// Уведомление · Вспышка: the fireflies hang where they are and all flash together, twice
static void flyNotify(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), fl = imax(tent(t - 200, 230), tent(t - 760, 230)), px[6], py[6], gl[6];
    fr.dg = 128;
    for (int j = 0; j < 6; j++) {
        px[j] = flyX(j, t);
        py[j] = flyY(j, t);
        gl[j] = 50 + (fl * 205 / 255);
    }
    flies(6, px, py, gl, mix(col, C_WHITE, fl * 130 / 255), fo);
}

// ----- 12 · Пламя: a flame on the bottom row whose tongues lick upwards; embers rise from it
// The cold flame in Kaya's colour (the catalog's default); its warm variant was not taken.

// the flame: w wide each side at its foot (1/8 ball), up to h high over the bottom row; its tongues lick at the phase ph
// (two waves across it going opposite ways, so they rise and fall in place); light runs up through it; the tips whiten,
// and the core at its foot a little; g: how bright
static void flame(int w, int h, int ph, uint32_t col, int g) {
    if (w <= 0 || h <= 0 || g <= 0) return;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), z = 21 - 7 * (b_row(i) - 3), ax = abs(p);  // z: the height over the bottom row
        if (ax >= w) continue;
        int env = 255 - (ax * ax * 255 / (w * w));
        int tg = ((sin8((p * 6 + ph) & 255) + sin8((p * 13 - ph * 2 + 90) & 255)) >> 1) - 128;  // the tongues, −128..127
        int e = ((h * env / 255) * (150 + (tg * 105 / 128)) / 255) - z;                       // how far under the flame's edge
        if (e <= -6) continue;
        int a = e < 0 ? (6 + e) * 25 : 150 + imin(105, e * 5);
        a = a * (175 + (sin8((z * 9 - ph * 3) & 255) * 80 / 255)) / 255;  // light running up through it
        int wh = imax(tent(e, 16) * imin(255, z * 18) / 255, tent(ax, w >> 1) * tent(z, 18) / 400);
        put(i, wh ? mix(col, C_WHITE, wh * 180 / 255) : col, a * g / 255);
    }
}

// nm embers (at most 8), one every per / nm ms, each rising for 1.2 s from z0 (1/8 ball over the bottom row), drifting
// and fading
static const int8_t em_x[8] PROGMEM = {-10, 14, -22, 4, 24, -4, 18, -16};  // where the embers start, 1/8 ball
static void embers(int nm, int t, int per, int z0, uint32_t col, int g) {
    if (g <= 0) return;
    uint32_t wc = mix(col, C_WHITE, 200);
    int ex[8], ez[8], ea[8];
    for (int j = 0; j < nm; j++) {
        int u = posMod(t + (j * per / nm), per);
        ex[j] = (int8_t)pgm_read_byte(&em_x[j]) + ((int8_t)pgm_read_byte(&em_x[j]) * u / 1500) + (wave(u + j * 300, 220) * 6 / 128);
        ez[j] = z0 + (u * 40 / 1000);
        ea[j] = u < 250 ? u * 255 / 250 : u < 1200 ? (1200 - u) * 255 / 950 : 0;
    }
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), z = 21 - 7 * (b_row(i) - 3);
        int a = 0;
        for (int j = 0; j < nm; j++) if (ea[j] && abs(p - ex[j]) < 8 && abs(z - ez[j]) < 8) a = imax(a, bell(oct(p - ex[j], z - ez[j]), 8) * ea[j] / 255);
        if (a) put(i, wc, a * g / 255);
    }
}

// Пробуждение · Розжиг: a spark glints at the foot, catches, and the flame rises, leaps once and settles
static void flameWake(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t), u = smooth(250, 1100, t), up = tent(t - 750, 450), sp = tent(t - 200, 260);
    fr.dg = 128;
    flame(u * 40 / 255, (u * 30 / 255) + (up * 16 / 255), t * 160 / 1000, col, 240 * fo / 255);
    if (sp) {
        uint32_t wc = mix(col, C_WHITE, 220);
        for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
            int p = 4 * (b_x(i) - 19), z = 21 - 7 * (b_row(i) - 3);
            if (abs(p) < 10 && z < 13) put(i, wc, bell(oct(p, z - 3), 10) * sp / 255);
        }
    }
}

// Слушает · Тихий огонь: a calm low flame, its tongues licking slowly; now and then an ember rises
static void flameListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    flame(40 + (wave(t, 30) * 3 / 128), 30 + (wave(t, 70) * 4 / 128), t * 90 / 1000, col, 235 * k / 255);
    embers(2, t, 3400, 16, col, 170 * k / 255);
}

// Думает · Пляска: the flame dances higher and quicker, and embers fly up from it; half violet
static void flameThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t c = mix(col, C_VIOLET, 128);
    flame(44, 46 + (wave(t, 180) * 6 / 128), t * 240 / 1000, c, 240 * k / 255);
    embers(5, t, 1500, 22, c, 210 * k / 255);
}

// Говорит · Голос огня: the flame's height follows the voice; loud, it widens a little
static void flameSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int v = voice(t);
    flame(36 + (v * 10 / 255), 18 + (v * 36 / 255), t * 150 / 1000, col, (190 + (v * 65 / 255)) * k / 255);
}

// Готово · Костёр: the flame flares up to the top, brighter and whiter, and a shower of embers rises from it
static const int8_t fl_bv[16] PROGMEM = {-30, 70, 24, 84, -12, 92, 40, 66, -44, 60, 8, 96, -22, 78, 32, 74};  // the embers' speeds (p, z), 1/8 ball a second
static void flameDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), up = smooth(0, 300, t) * (255 - smooth(700, 1500, t)) / 255;
    uint32_t wc = mix(col, C_WHITE, 210);
    int ex[8], ez[8], ea[8];
    fr.dg = 128;
    flame(40 + (up * 22 / 255), 30 + (up * 34 / 255), t * 200 / 1000, mix(col, C_WHITE, up * 90 / 255), (210 + (up * 45 / 255)) * fo / 255);
    for (int j = 0; j < 8; j++) {
        int u = t - 250 - j * 50;
        ex[j] = (int8_t)pgm_read_byte(&fl_bv[2 * j]) * u / 1000;
        ez[j] = 14 + ((int8_t)pgm_read_byte(&fl_bv[2 * j + 1]) * u / 1000) - (30 * (u * u / 1000) / 1000);
        ea[j] = u > 0 && u < 1100 ? (u < 150 ? u * 255 / 150 : (1100 - u) * 255 / 950) : 0;
    }
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), z = 21 - 7 * (b_row(i) - 3);
        int a = 0;
        for (int j = 0; j < 8; j++) if (ea[j] && abs(p - ex[j]) < 8 && abs(z - ez[j]) < 8) a = imax(a, bell(oct(p - ex[j], z - ez[j]), 8) * ea[j] / 255);
        if (a) put(i, wc, a * fo / 255);
    }
}

// Ошибка · Угасание: the flame sputters (two dips), sinks and goes out; smoke curls up from where it was
static void flameError(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), s = smooth(200, 1100, t), dip = imax(tent(t - 380, 140), tent(t - 700, 140)) * 90 / 255;
    uint32_t sc = mix(col, 0x9a9a94, 170);  // smoke: grey with a little of the flame's colour
    int cx[3], cz[3], cr[3], ca[3];
    for (int j = 0; j < 3; j++) {  // the smoke: three puffs, rising and spreading
        int u = t - 700 - j * 200;
        cx[j] = (j - 1) * 8 + (wave(u + j * 500, 150) * 6 / 128);
        cz[j] = 6 + (u * 28 / 1000);
        cr[j] = 9 + (imax(0, u) * 10 / 1000);
        ca[j] = u > 0 ? 150 - imin(150, u * 150 / 1200) : 0;
    }
    fr.dg = 128;
    flame(40 - (s * 14 / 255), (30 * (255 - s) / 255) * (255 - dip) / 255, t * 120 / 1000, col, 235 * fo / 255);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), z = 21 - 7 * (b_row(i) - 3);
        int a = 0;
        for (int j = 0; j < 3; j++) if (ca[j] && abs(p - cx[j]) < cr[j] && abs(z - cz[j]) < cr[j]) a = imax(a, bell(oct(p - cx[j], z - cz[j]), cr[j]) * ca[j] / 255);
        if (a) put(i, sc, a * fo / 255);
    }
}

// Уведомление · Треск: a log pops: the flame jumps and a burst of sparks flies out in arcs to both sides
static const int8_t fl_sv[20] PROGMEM = {-70, 60, 64, 70, -40, 90, 46, 84, -90, 40, 86, 46, -20, 100, 22, 96, -56, 76, 58, 66};  // the sparks' speeds (p, z)
static void flameNotify(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), up = tent(t - 120, 260);
    uint32_t wc = mix(col, C_WHITE, 200);
    int ex[10], ez[10], ea[10];
    fr.dg = 128;
    flame(40, 30 + (up * 16 / 255), t * 160 / 1000, col, (170 + (up * 85 / 255)) * fo / 255);
    for (int j = 0; j < 10; j++) {
        int u = t - 80 - (j % 3) * 40;
        ex[j] = (int8_t)pgm_read_byte(&fl_sv[2 * j]) * u / 1000;
        ez[j] = 12 + ((int8_t)pgm_read_byte(&fl_sv[2 * j + 1]) * u / 1000) - (90 * (u * u / 1000) / 1000);
        ea[j] = u > 0 && u < 1200 ? (1200 - u) * 255 / 1200 : 0;
    }
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), z = 21 - 7 * (b_row(i) - 3);
        int a = 0;
        for (int j = 0; j < 10; j++) if (ea[j] && abs(p - ex[j]) < 9 && abs(z - ez[j]) < 9) a = imax(a, bell(oct(p - ex[j], z - ez[j]), 9) * ea[j] / 255);
        if (a) put(i, wc, a * fo / 255);
    }
}

// ================= Kaya's styles of v1.9, part 2 (KAIA-202's catalog B: web/src/games.js, line by line) =================
// As the styles of v1.8: a style is a whole visual language, its own version of all 7 events; kaia_anim 13–18 picks one
// as the style, and its versions join every event's list (looks 18–23, wakes 24–29; look_style, wake_style).
//   13 Аркада, 14 Тетрис, 15 Механизм, 16 Неон, 17 Маятник, 18 Гирлянда
// The wakes fade out over their last 400 ms (wakeDraw fades the listening in under their last 800), the other
// one-shots over their last 300 ms; the states loop. The small tables are in PROGMEM; the arrays of a frame are on the
// stack, sized as the loop that fills them.
// ">>" on a negative int (tetPlace's (v + 64) >> 7, tetStack's k off the left end, Маятник · Обрыв's sx >> 1 and
// (sy − 45) >> 1) shifts arithmetically in GCC, as in the JS (rounds down: −4 >> 3 is −1): keep it ">>", never "/ 2"
// or "/ 8", which round towards 0.
// p = 4·(x − 19), q = 7·(row − 3): a ball from the middle in 1/8 balls (p to the right, q down), as in KAIA-173

// the sine and cosine of an angle (256 a turn), −128..127
static inline int psin(int a) {
    return sin8(a & 255) - 128;
}
static inline int pcos(int a) {
    return sin8((a + 64) & 255) - 128;
}

// the angle of (dx, dy) clockwise from 12 o'clock without atan, 0..255: exact on the axes and diagonals, a few off between
static int pang(int dx, int dy) {
    int s = abs(dx) + abs(dy);
    if (!s) return 0;
    return (dx >= 0 ? 64 + (dy * 64 / s) : 192 - (dy * 64 / s)) & 255;
}

// ----- 13 · Аркада: an 8-bit chomper with ghosts and dots, in Kaya's colour

// the chomper at (dp, dq) from its centre, radius r, facing dir (1 right, −1 left, 0 up),
// its mouth m (0 shut, 256 = ±45°, 2560 = all but a sliver): 0..255; the centre ball is never cut
static int chomp(int dp, int dq, int r, int dir, int m) {
    int d = oct(dp, dq);
    if (d >= r + 7) return 0;
    int a = d <= r ? 255 : (r + 7 - d) * 255 / 7;
    int fw = dir ? dp * dir : -dq, sd = dir ? abs(dq) : abs(dp);  // ahead of the centre, and to the side
    if (fw <= 0 || m <= 0) return a;
    int e = (fw * m >> 8) - sd;  // > 0 inside the mouth
    return e <= -4 ? a : e >= 4 ? 0 : a * (4 - e) >> 3;
}

// a ghost at (dp, dq) from its centre: a dome of seven balls, its two feet wiggling out of step: 0..255
// (the caller whitens the two balls on top, dq < −3: the eyes)
static int ghost(int dp, int dq, int t) {
    int d = oct(dp, dq);
    if (d >= 16) return 0;
    int a = d <= 9 ? 255 : (16 - d) * 255 / 7;
    return dq > 3 ? a * (170 + ((dp < 0 ? 85 : -85) * wave(t, 768) / 128)) / 255 : a;
}

// the dots: every other ball of the middle row; the one at the left edge is a power dot and pulses
static int arcDot(uint8_t i, int p, int t) {
    if (b_row(i) != 3 || (b_x(i) & 3)) return 0;
    return p == -76 ? 150 + (wave(t, 160) * 80 / 128) : 80;
}

// Пробуждение · Забег: the dots come up along the middle row; the chomper runs in from the left eating them,
// slowing to the patrol's pace, and is in the middle at the end (the patrol goes on from there)
static void arcWake(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t), g = smooth(0, 250, t);
    uint32_t dc = mix(col, C_WHITE, 170);
    int x = -100 + (t * 31 / 1000) + ((t * (3600 - t) / 3600) * 491 / 10000), m = abs(wave(t, 512)) * 3;
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = p > x ? arcDot(i, p, t) * g / 255 : 0;
        uint32_t c = dc;
        int v = chomp(p - x, q, 12, 1, m);
        if (v > a) {
            a = v;
            c = col;
        }
        put(i, c, a * fo / 255);
    }
}

// Слушает · Патруль: the chomper walks the middle row there and back (4.4 s a way), its mouth shut at the turns;
// the dots it ate come back behind it 0.7–1.7 s later
static void arcListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int s = posMod(t + 2200, 8800), dir = s < 4400 ? 1 : -1, x = s < 4400 ? -68 + (s * 136 / 4400) : 68 - ((s - 4400) * 136 / 4400);
    int m = abs(wave(t, 384)) * 3 * smooth(68, 52, abs(x)) / 255;
    uint32_t dc = mix(col, C_WHITE, 170);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = arcDot(i, p, t);
        uint32_t c = dc;
        if (a && p > -76) {
            int sr = (p + 68) * 4400 / 136, sl = 8800 - sr;  // when it passes the dot: going right, going left
            a = a * smooth(700, 1700, imin(posMod(s - sr, 8800), posMod(s - sl, 8800))) / 255;
        }
        int v = chomp(p - x, q, 12, dir, m);
        if (v > a) {
            a = v;
            c = col;
        }
        put(i, c, a * k / 255);
    }
}

// Думает · Погоня: a violet ghost chases the chomper along the middle row, now closing in, now falling back;
// out at the right and in again at the left (2.6 s a round); the dots are eaten and grow again
static void arcThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int h = t * 80 / 1000, xc = -104 + posMod(h, 208), xg = -104 + posMod(h - 40 - (wave(t, 98) * 14 / 128), 208), gy = wave(t, 300) * 3 / 128;
    // (v1.9: wave(t, 640) repeats every 400 ms and the ghost's wave(t, 768) every 1000, so t goes in modulo those: the
    // same frames, and t · 768 never overflows a 32-bit int in a long state)
    uint32_t cc = mix(col, C_VIOLET, 64), gc = mix(C_VIOLET, C_WHITE, 50), ec = mix(gc, C_WHITE, 170), dc = mix(col, C_WHITE, 170);
    int m = abs(wave(posMod(t, 400), 640)) * 3;
    int tg = posMod(t, 1000);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = b_row(i) == 3 && !(b_x(i) & 3) ? 80 * smooth(900, 1700, posMod(t - ((p + 104) * 25 / 2), 2600)) / 255 : 0;
        uint32_t c = dc;
        int v = chomp(p - xc, q, 12, 1, m);
        if (v > a) {
            a = v;
            c = cc;
        }
        v = ghost(p - xg, q - gy, tg);
        if (v > a) {
            a = v;
            c = q - gy < -3 ? ec : gc;
        }
        put(i, c, a * k / 255);
    }
}

// Говорит · Ам-ам: the chomper bites with the voice in the middle; a chain of dots flows into its mouth from the right
static void arcSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int v = voice(t), x = -16 + (wave(t, 30) * 8 / 128), m = 40 + (v * 420 / 255), off = t * 40 / 1000;
    uint32_t dc = mix(col, C_WHITE, 170);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = b_row(i) == 3 && p > x + 10 ? tent(posMod(p + off, 16) - 8, 8) * 90 / 255 : 0;  // the dots, two balls apart, sliding left
        uint32_t c = dc;
        int w = chomp(p - x, q, 12, 1, m);
        if (w > a) {
            a = w;
            c = col;
        }
        put(i, c, a * k / 255);
    }
}

// Готово · Энерджайзер: the chomper runs at a big pulsing power dot and eats it (0.52 s): the display flashes,
// a ring goes out, the chomper glows, grows and runs off
static void arcDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), e = t - 520, x = e < 0 ? -84 + (t * 104 / 520) : 20 + (e * 50 / 1000);
    int m = abs(wave(t, 640)) * 3, gl = e > 0 ? smooth(0, 300, e) : 0;
    uint32_t cc = mix(col, C_WHITE, 110 * gl / 255), wc = mix(col, C_WHITE, 150);
    int pd = e < 0 ? 170 + (wave(t, 700) * 85 / 128) : 0, fl = tent(e - 60, 220) * 235 / 255, rr = e * 120 / 1000, rf = e > 0 ? 255 - smooth(0, 700, e) : 0;
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = fl;
        uint32_t c = wc;
        if (pd) a = imax(a, tent(oct(p - 20, q), 11) * pd / 255);
        if (rf) a = imax(a, tent(oct(p - 20, q) - rr, 8) * rf / 255);
        int v = chomp(p - x, q, 12 + (3 * gl / 255), 1, m);
        if (v > a) {
            a = v;
            c = cc;
        }
        put(i, c, a * fo / 255);
    }
}

// Ошибка · Пойман: a violet ghost flies at the chomper head on and catches it (0.56 s); it freezes, its mouth opens
// upwards wider and wider while it shrinks to a dot, and pops
static void arcError(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), tc = imin(t, 560), xc = -40 + (tc * 40 / 1000), xg = 70 - (tc * 120 / 1000);
    int e = smooth(800, 1400, t), r = 12 - (12 * e / 255), m = t < 560 ? abs(wave(t, 512)) * 3 : t < 800 ? 0 : 256 + e * 9, dir = t < 800 ? 1 : 0;
    int g = 255 - smooth(1380, 1460, t), gf = 255 - smooth(700, 1000, t), pop = tent(t - 1450, 180), pr = imax(0, t - 1400) * 60 / 1000;
    uint32_t gc = mix(C_VIOLET, C_WHITE, 50), ec = mix(gc, C_WHITE, 170), pc = mix(col, C_WHITE, 120);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = pop ? tent(oct(p - xc, q) - pr, 6) * pop / 255 : 0;
        uint32_t c = pc;
        int v = chomp(p - xc, q, r, dir, m) * g / 255;
        if (v > a) {
            a = v;
            c = col;
        }
        if (gf) {
            v = ghost(p - xg, q, t) * gf / 255;
            if (v > a) {
                a = v;
                c = q < -3 ? ec : gc;
            }
        }
        put(i, c, a * fo / 255);
    }
}

// Уведомление · Бонус: a pair of cherries on green stems pops up in the middle and blinks three times, whiter on each blink
static const int8_t arc_ch[6] PROGMEM = {-8, 7, 8, 7, 4, -14};  // the two cherries and where their stems meet, (p, q)
#define C_STEM 0x5fd05a
static void arcNotify(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), g = smooth(0, 150, t), b = imax(imax(tent(t - 250, 200), tent(t - 650, 200)), tent(t - 1050, 200));
    int a0 = (110 + (145 * b / 255)) * g / 255;
    uint32_t cc = mix(col, C_WHITE, 120 * b / 255);
    int s1[4] = {(int8_t)pgm_read_byte(&arc_ch[0]), (int8_t)pgm_read_byte(&arc_ch[1]), (int8_t)pgm_read_byte(&arc_ch[4]), (int8_t)pgm_read_byte(&arc_ch[5])},
        s2[4] = {(int8_t)pgm_read_byte(&arc_ch[2]), (int8_t)pgm_read_byte(&arc_ch[3]), (int8_t)pgm_read_byte(&arc_ch[4]), (int8_t)pgm_read_byte(&arc_ch[5])};
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = tent(imin(oct(p - (int8_t)pgm_read_byte(&arc_ch[0]), q - (int8_t)pgm_read_byte(&arc_ch[1])), oct(p - (int8_t)pgm_read_byte(&arc_ch[2]), q - (int8_t)pgm_read_byte(&arc_ch[3]))), 11) * a0 / 255;
        uint32_t c = cc;
        int v = tent(imin(segDist(p, q, s1, 256), segDist(p, q, s2, 256)), 5) * (g * 3 >> 2) / 255;  // the stems
        if (v > a) {
            a = v;
            c = C_STEM;
        }
        put(i, c, a * fo / 255);
    }
}

// ----- 14 · Тетрис: blocks in the diagonal grid, a stack in the three bottom rows

// the stack: rows 4, 5, 6, bit k = the k-th ball of the row from the left (row r starts at p = −76 + 4·(r − 3)); its brightness by row
static const uint32_t tet_st[3] PROGMEM = {0x18007, 0x3e0cf, 0x1f7ff};
static const uint8_t tet_sh[3] PROGMEM = {205, 165, 130};
static int tetStack(int r, int p) {
    if (r < 4 || r > 6) return 0;
    int k = (p + 76 - 4 * (r - 3)) >> 3;
    return k >= 0 && k < 20 ? (pgm_read_dword(&tet_st[r - 4]) >> k) & 1 : 0;
}

// the stack's block at (r, p) when it is in quarter j (from the left): its brightness, else 0
static int tetQ(int r, int p, int j) {
    if (!tetStack(r, p)) return 0;
    return (p < -36 ? 0 : p < 0 ? 1 : p < 36 ? 2 : 3) == j ? pgm_read_byte(&tet_sh[r - 4]) : 0;
}

// a piece of 4 blocks (tet_pc, from its centre) turned by ang (256 a turn, 43 ≈ 60°: the grid maps onto itself), centre (x, y):
// its blocks into xs, ys from j0
static const int8_t tet_pc[8] PROGMEM = {-8, 0, 0, 0, 8, 0, 4, -7};
static void tetPlace(int* xs, int* ys, int j0, int x, int y, int ang) {
    int cs = pcos(ang), sn = psin(ang);
    for (int j = 0; j < 4; j++) {
        int ox = (int8_t)pgm_read_byte(&tet_pc[2 * j]), oy = (int8_t)pgm_read_byte(&tet_pc[2 * j + 1]);
        xs[j0 + j] = x + ((ox * cs - oy * sn + 64) >> 7);
        ys[j0 + j] = y + ((ox * sn + oy * cs + 64) >> 7);
    }
}

// n blocks at (p, q): the nearest one, a ball wide (between two balls both share it)
static int tetAt(int p, int q, const int* xs, const int* ys, int n) {
    int a = 0;
    for (int j = 0; j < n; j++) {
        int dx = p - xs[j];
        if (dx > -8 && dx < 8) a = imax(a, tent(oct(dx, q - ys[j]), 8));
    }
    return a;
}

// Пробуждение · Стопка: the stack falls in four chunks, one after another, row by row from above the top
// (each row down moves it half a ball, as the grid wants); each lands with a soft white flash
static const int16_t tet_dt[4] PROGMEM = {380, 0, 570, 190};  // when each quarter (from the left) starts to fall, ms
static void tetWake(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t);
    uint32_t sc = mix(col, C_WHITE, 40);
    int off[4] = {0, 0, 0, 0}, fl[4] = {0, 0, 0, 0};
    for (int j = 0; j < 4; j++) {
        int u = imin(imax(0, t - (int16_t)pgm_read_word(&tet_dt[j])), 480), lt = t - (int16_t)pgm_read_word(&tet_dt[j]) - 480;
        off[j] = 1792 - (1792 * u * u / 230400);  // 7 rows above, in 1/256 row, falling with gravity
        fl[j] = lt >= 0 ? tent(lt, 200) : 0;
    }
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), r = b_row(i);
        int a = 0;
        uint32_t c = sc;
        for (int j = 0; j < 4; j++) {
            if (t < (int16_t)pgm_read_word(&tet_dt[j])) continue;
            int R = off[j] >> 8, w = off[j] & 255;
            int v = (tetQ(r + R, p - 4 * (R & 1), j) * (256 - w) + tetQ(r + R + 1, p - 4 * ((R + 1) & 1), j) * w) >> 8;
            if (v > a) {
                a = v;
                c = fl[j] ? mix(sc, C_WHITE, fl[j] * 150 / 255) : sc;
            }
        }
        put(i, c, a * fo / 255);
    }
}

// Слушает · Фигура: one piece drifts down from above the top, turning twice by 60° on the way, and melts into the stack;
// then the next one, in another column (6 s each)
static const int8_t tet_cx[4] PROGMEM = {-28, 20, -4, 28};
static void tetListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int u = posMod(t, 6000), x = (int8_t)pgm_read_byte(&tet_cx[((t - u) / 6000) & 3]), y = -34 + (34 * smooth(0, 5000, u) / 255);
    int g = smooth(0, 700, u) * smooth(6000, 5100, u) / 255, ang = (43 * smooth(1000, 1700, u) + 43 * smooth(2800, 3500, u)) / 255;
    int xs[4] = {0, 0, 0, 0}, ys[4] = {0, 0, 0, 0};
    uint32_t sc = mix(col, C_WHITE, 40), pc = mix(col, C_WHITE, 110);
    int glow = tent(u - 5600, 500) * 40 / 255;
    tetPlace(xs, ys, 0, x, y, ang);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3), r = b_row(i);
        int a = tetStack(r, p) ? pgm_read_byte(&tet_sh[r - 4]) + glow : 0;
        uint32_t c = sc;
        int v = tetAt(p, q, xs, ys, 4) * g / 255;
        if (v > a) {
            a = v;
            c = pc;
        }
        put(i, c, a * k / 255);
    }
}

// Думает · Ливень: pieces rain into three columns, each falling in 0.6 s and flashing as it goes into the stack; violet
static const int8_t tet_lx[3] PROGMEM = {-44, 4, 44};
static const uint8_t tet_la[3] PROGMEM = {0, 43, 128};
static void tetThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t pc = mix(col, C_VIOLET, 140), sc = mix(col, C_WHITE, 40);
    int xs[12] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, ys[12] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, fl[3] = {0, 0, 0};
    for (int m = 0; m < 3; m++) {
        int u = posMod(t - m * 300, 900);
        tetPlace(xs, ys, 4 * m, (int8_t)pgm_read_byte(&tet_lx[m]), u < 600 ? -42 + (42 * u * u / 360000) : -99, pgm_read_byte(&tet_la[m]));
        fl[m] = tent(u - 650, 150);
    }
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3), r = b_row(i);
        int a = 0;
        uint32_t c = sc;
        if (tetStack(r, p)) {
            int m = p < -20 ? 0 : p < 24 ? 1 : 2, fv = fl[m] * tent(p - (int8_t)pgm_read_byte(&tet_lx[m]), 24) / 255;
            a = imax(pgm_read_byte(&tet_sh[r - 4]), fv);
            if (fv) c = mix(sc, C_WHITE, fv * 150 / 255);
        }
        int v = tetAt(p, q, xs, ys, 12);
        if (v > a) {
            a = v;
            c = pc;
        }
        put(i, c, a * k / 255);
    }
}

// Говорит · Верхний ряд: the top of the stack lights with the voice, from the middle out; when loud, a glow rises over it
static void tetSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int v[3] = {voice(t), voice(t - 90), voice(t - 180)};
    uint32_t sc = mix(col, C_WHITE, 40);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), r = b_row(i), e = v[abs(p) < 28 ? 0 : abs(p) < 56 ? 1 : 2];
        int a = 0;
        uint32_t c = sc;
        if (tetStack(r, p)) {
            a = pgm_read_byte(&tet_sh[r - 4]) * 3 >> 2;
            if (!tetStack(r - 1, p - 4) && !tetStack(r - 1, p + 4)) {  // a top block: nothing over it
                a = 90 + (165 * e / 255);
                c = mix(col, C_WHITE, 60 + (120 * e / 255));
            }
        } else if (r >= 3 && (tetStack(r + 1, p - 4) || tetStack(r + 1, p + 4))) {
            a = imax(0, e - 150) * 110 / 105;  // just over the top, only when loud
            c = col;
        }
        put(i, c, a * k / 255);
    }
}

// Готово · Линия: a block falls into the gap of the bottom row; the full row flashes white and melts from the gap outwards;
// the stack over it drops a row
static void tetDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), y = t < 450 ? -28 + (49 * t * t / 202500) : 21, x = 24 + (abs(posMod(y, 14) - 7) * 4 / 7);
    int fl = smooth(430, 520, t) * (255 - smooth(700, 1000, t)) / 255, e = smooth(1000, 1250, t);
    uint32_t sc = mix(col, C_WHITE, 40), bc = mix(col, C_WHITE, 90);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3), r = b_row(i);
        int a = 0;
        uint32_t c = sc;
        if (r == 6 && (tetStack(6, p) || t >= 450)) {  // the bottom row, full once the block is in: white, then gone from the gap out
            int g = 255 - smooth(700 + abs(p - 24) * 3, 820 + abs(p - 24) * 3, t);
            a = imax(pgm_read_byte(&tet_sh[2]), fl) * g / 255;
            if (fl) c = mix(sc, C_WHITE, fl * 200 / 255);
        }
        if (r >= 4) {  // rows 4–5 as they are, and one row lower (down-left) as e goes to 255
            int here = r < 6 && tetStack(r, p) ? pgm_read_byte(&tet_sh[r - 4]) : 0, up = r > 4 && tetStack(r - 1, p + 4) ? pgm_read_byte(&tet_sh[r - 5]) : 0;
            int s = (here * (255 - e) + up * e) / 255;
            if (s > a) {
                a = s;
                c = sc;
            }
        }
        if (t < 450) {
            int v = tent(oct(p - x, q - y), 8);
            if (v > a) {
                a = v;
                c = bc;
            }
        }
        put(i, c, a * fo / 255);
    }
}

// Ошибка · Конец игры: the stack grows row after row up to the top; the full display flashes, then empties from the top down
static void tetError(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), fl = tent(t - 900, 160);
    uint32_t sc = mix(col, C_WHITE, 40), wc = mix(sc, C_WHITE, 170 * fl / 255);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), r = b_row(i), up = (6 - r) * 120;
        int a = imax(tetStack(r, p) ? pgm_read_byte(&tet_sh[r - 4]) : 0, (210 - r * 10) * smooth(up, up + 140, t) / 255);
        a = imax(a, fl * 230 / 255) * (255 - smooth(1050 + r * 70, 1250 + r * 70, t)) / 255;
        put(i, wc, a * fo / 255);
    }
}

// Уведомление · Новая фигура: a piece appears at the top and blinks three times, whiter on each blink, over a dim stack
static void tetNotify(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), b = imax(imax(tent(t - 200, 200), tent(t - 600, 200)), tent(t - 1000, 200)), g = smooth(0, 120, t);
    int xs[4] = {0, 0, 0, 0}, ys[4] = {0, 0, 0, 0};
    uint32_t pc = mix(col, C_WHITE, 150 * b / 255);
    int a0 = (90 + (165 * b / 255)) * g / 255;
    tetPlace(xs, ys, 0, 0, -21, 128);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3), r = b_row(i);
        int a = tetStack(r, p) ? pgm_read_byte(&tet_sh[r - 4]) >> 2 : 0;
        uint32_t c = col;
        int v = tetAt(p, q, xs, ys, 4) * a0 / 255;
        if (v > a) {
            a = v;
            c = pc;
        }
        put(i, c, a * fo / 255);
    }
}

// ----- 15 · Механизм: it is a clock, so gears: two big wheels meshed in the middle, a pinion at each edge

// a gear on the axle ball (x0 half-balls across, row r0): its teeth on the hex ring R balls out (6R balls, a clean loop on this
// grid) with a dim rim between them, a bar across the ring 1 out (on the big wheels), the axle; turned by th (256 a turn): 0..255
static int gear(uint8_t i, int x0, int r0, int R, int N, int th) {
    int dr = b_row(i) - r0, dx = b_x(i) - x0, ar = abs(dr), ax = abs(dx), h = ar >= ax ? ar : (ax + ar) >> 1;  // the hex distance, balls
    if (h > R) return 0;
    if (!h) return 255;  // the axle
    int a = pang(4 * dx, 7 * dr) + th;
    if (h == R) {  // the ring: a tooth, or the rim between two
        int v = (a * N) & 255, w = v < 128 ? v : 256 - v;
        return 50 + (smooth(80, 36, w) * 190 / 255);
    }
    if (h > 1) return 0;
    int s = (a * 2) & 255, ws = s < 128 ? s : 256 - s;  // the bar: two spokes
    return smooth(48, 16, ws) * 160 / 255;
}

// the mechanism at ball i: two big wheels (6 teeth on rings of 18 balls) round the balls 3 to each side of the middle, meshed
// where they touch, and a pinion (2 teeth on 6 balls) at each edge, three times as fast; th turns the left wheel, the rest follow
static int gears(uint8_t i, int th) {
    int x = b_x(i);
    if (x < 5) return gear(i, 2, 3, 1, 2, 64 - 3 * th) * 190 / 255;
    if (x < 19) return gear(i, 12, 3, 3, 6, th);
    if (x < 34) return gear(i, 26, 3, 3, 6, 21 - th);
    return gear(i, 36, 3, 1, 2, 1 + 3 * th) * 190 / 255;
}

// Пробуждение · Завод: the big wheels come up, then the pinions, and the mechanism starts to turn, speeding up to the listening's pace
// (the angle −21 + 21·t²/du² ends where the listening starts, at its speed)
static void gearWake(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t), al = (21 * t * t / 4000000) - 21, g0 = smooth(0, 450, t), g1 = smooth(350, 850, t);
    uint32_t wc = mix(col, C_WHITE, 140);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int x = b_x(i), a = gears(i, al) * (x < 5 || x >= 34 ? g1 : g0) / 255;
        put(i, a > 240 ? wc : col, a * fo / 255);
    }
}

// Слушает · Ход: the gears turn slowly, meshed (a big wheel 12 s a turn, the pinions three times faster); a soft light breathes on them
static void gearListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int th = t * 256 / 12000, br = 215 + (wave(t, 45) * 40 / 128);
    uint32_t wc = mix(col, C_WHITE, 140);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int a = gears(i, th);
        put(i, a > 240 ? wc : col, (a * br / 255) * k / 255);
    }
}

// Думает · Быстрый ход: the same gears spin fast (1.5 s a turn of a big wheel); violet
static void gearThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t c = mix(col, C_VIOLET, 128), wc = mix(c, C_WHITE, 140);
    int th = t * 256 / 1500;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int a = gears(i, th);
        put(i, a > 240 ? wc : c, a * k / 255);
    }
}

// Говорит · Тик: the mechanism ticks with the voice: the gears jerk forward on its peaks (up to a third of a tooth) and glow brighter
static void gearSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int v = voice(t), th = (t * 256 / 12000) + (v * 14 / 255);
    int br = 140 + (v * 115 / 255);
    uint32_t c = mix(col, C_WHITE, v * 60 / 255), wc = mix(col, C_WHITE, 80 + (v * 120 / 255));
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int a = gears(i, th);
        put(i, a > 240 ? wc : c, (a * br / 255) * k / 255);
    }
}

// Готово · Щелчок: the gears turn a quarter, overshoot a little and click into place; a chime: a flash and a ring from where they mesh
static void gearDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), g = smooth(0, 150, t), th = (70 * smooth(0, 520, t) - 6 * smooth(520, 640, t)) / 255;
    int fl = tent(t - 600, 220), e = t - 600, rr = e * 110 / 1000, rf = e > 0 ? 255 - smooth(0, 800, e) : 0;
    uint32_t c = mix(col, C_WHITE, 150 * fl / 255), wc = mix(col, C_WHITE, 180);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = (gears(i, th) * (170 + (85 * fl / 255)) / 255) * g / 255;
        uint32_t cc = a > 240 ? wc : c;
        if (rf) {
            int v = tent(oct(p, q) - rr, 7) * rf / 255;
            if (v > a) {
                a = v;
                cc = wc;
            }
        }
        put(i, cc, a * fo / 255);
    }
}

// Ошибка · Заклинило: the gears turn, then jam (0.35 s): they shake on the spot, sparks where the teeth meet, the mechanism dims
static void gearError(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), sh = (wave(t, 2000) * 5 / 128) * (255 - smooth(350, 1100, t)) / 255;
    int th = (imin(t, 350) * 256 / 2000) + (t > 350 ? sh : 0), sp = tent(t - 380, 250);
    uint32_t wc = mix(col, C_WHITE, 170);
    int g = 255 - (110 * smooth(500, 1200, t) / 255);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = gears(i, th) * g / 255;
        uint32_t c = a > 240 ? wc : col;
        int v = tent(imin(oct(p, q), oct(abs(p) - 56, q)), 12) * sp / 255;  // the sparks where the teeth jam
        if (v > a) {
            a = v;
            c = wc;
        }
        put(i, c, a * fo / 255);
    }
}

// Уведомление · Кукушка: over the still mechanism a door opens at the top between the wheels and the cuckoo pops out twice;
// a soft ring on each «ку»
static void gearNotify(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), u = t < 650 ? t - 100 : t - 750;  // the two pops, 500 ms each
    int y = -34 + ((22 * smooth(0, 130, u) + 5 * tent(u - 170, 90) - 22 * smooth(330, 480, u)) / 255);
    int rr = imax(0, u - 150) * 80 / 1000, rf = u > 150 ? 255 - smooth(150, 500, u) : 0;
    uint32_t wc = mix(col, C_WHITE, 170);
    int dr = 40 + (100 * smooth(-34, -24, y) / 255);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = gears(i, 0) * 50 / 255;
        uint32_t c = col;
        if (q == -21 && abs(p) <= 12) a = imax(a, dr);  // the door
        if (rf) a = imax(a, tent(oct(p, q - y) - 14 - rr, 6) * rf / 400);
        int v = tent(oct(p, q - y), 12);
        if (v > a) {
            a = v;
            c = tent(oct(p - 7, q - y + 3), 7) > 150 ? wc : col;  // the beak whiter
        }
        put(i, c, a * fo / 255);
    }
}

// ----- 16 · Неон: neon tubes in the dark: a white-hot core, a faint glow round it
// the sign's frame is the rim, its second tube (pink) the ring inside
#define C_PINK 0xff3fa8

// a tube d (1/8 ball) from its line: the core (d < 3), a faint glow round it to 11: 0..255
static int neon(int d) {
    return d < 3 ? 255 : d < 11 ? (11 - d) * 70 / 8 : 0;
}

// the circuit: a closed trace along the grid's lines (0° and 60°): its corners (p, q) and the lengths of its sides (272 in all)
static const int8_t neon_pt[16] PROGMEM = {-44, -14, 44, -14, 56, 7, 16, 7, 12, 0, -20, 0, -28, 14, -60, 14};
static const uint8_t neon_len[8] PROGMEM = {88, 24, 40, 8, 32, 16, 32, 32};
// the circuit at (p, q) with its bright head at h along it, a cooling trail 150 behind: 0..255
static int neonTrace(int p, int q, int h) {
    int best = 0, at = 0;
    for (int j = 0; j < 8; j++) {
        int x0 = (int8_t)pgm_read_byte(&neon_pt[2 * j]), y0 = (int8_t)pgm_read_byte(&neon_pt[2 * j + 1]), x1 = (int8_t)pgm_read_byte(&neon_pt[(2 * j + 2) & 15]), y1 = (int8_t)pgm_read_byte(&neon_pt[(2 * j + 3) & 15]);
        if (p >= imin(x0, x1) - 10 && p <= imax(x0, x1) + 10) {
            int dx = x1 - x0, dy = y1 - y0;
            int u = ((p - x0) * dx + (q - y0) * dy) * 256 / (dx * dx + dy * dy);
            u = u < 0 ? 0 : u > 256 ? 256 : u;
            int d = oct(p - x0 - (dx * u / 256), q - y0 - (dy * u / 256));
            if (d < 11) {
                int e = posMod(h - at - (pgm_read_byte(&neon_len[j]) * u >> 8), 272), w = e < 150 ? (150 - e) * 255 / 150 : 0;
                best = imax(best, neon(d) * (w * w / 255) / 255);
            }
        }
        at += pgm_read_byte(&neon_len[j]);
    }
    return best;
}

// Пробуждение · Зажигание: the frame stutters twice, then the light runs round it from 12 o'clock both ways (white at its front);
// the pink tube catches with its own stutter
static void neonWake(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t);
    uint32_t fc = mix(col, C_WHITE, 110), hc = mix(col, C_WHITE, 220), pc = mix(C_PINK, C_WHITE, 90);
    int st = imax(tent(t - 130, 60) * 150 / 255, tent(t - 300, 50) * 200 / 255), fs = smooth(430, 800, t), n0 = ring_len[0];
    int g2 = imax(imax(tent(t - 920, 60) * 150 / 255, tent(t - 1060, 50) * 200 / 255), 120 * smooth(1150, 1300, t) / 255);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int r = ringOf(i);
        if (r == 0) {
            int m = imin(b_pos[i], n0 - b_pos[i]), F = (n0 / 2 + 3) * fs / 255;
            put(i, fs < 255 && m >= F - 3 && m < F ? hc : fc, imax(st, m < F ? 185 : 0) * fo / 255);
        } else if (r == 2) put(i, pc, g2 * fo / 255);
    }
}

// Слушает · Гул: the sign hums: the frame burns evenly, two slightly brighter zones creep round it (6.4 s); the pink tube breathes;
// dark between them
static void neonListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int n0 = ring_len[0];
    uint32_t fc = mix(col, C_WHITE, 110), pc = mix(C_PINK, C_WHITE, 90);
    int g2 = 120 + (wave(t, 37) * 30 / 128);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int r = ringOf(i);
        if (r == 0) put(i, fc, (185 + (psin((b_pos[i] * 512 / n0) - (t * 40 / 1000)) * 30 / 128)) * k / 255);
        else if (r == 2) put(i, pc, g2 * k / 255);
    }
}

// Думает · Схема: a bright head runs round a closed circuit trace, a cooling trail behind it: the circuit keeps tracing itself; violet
static void neonThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t c = mix(col, C_VIOLET, 128), wc = mix(c, C_WHITE, 150);
    int h = t * 120 / 1000;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int v = neonTrace(4 * (b_x(i) - 19), 7 * (b_row(i) - 3), h);
        put(i, v > 200 ? wc : c, v * k / 255);
    }
}

// Говорит · Пульс трубок: both tubes beat with the voice, the frame at once, the pink one a beat later; loud, the cores go white
static void neonSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int v = voice(t), v2 = voice(t - 120);
    uint32_t fc = mix(col, C_WHITE, 60 + (v * 120 / 255)), pc = mix(C_PINK, C_WHITE, 40 + (v2 * 120 / 255));
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int r = ringOf(i);
        if (r == 0) put(i, fc, (70 + (v * 185 / 255)) * k / 255);
        else if (r == 2) put(i, pc, (50 + (v2 * 205 / 255)) * k / 255);
    }
}

// Готово · Неоновая галочка: a check of tube along the grid's lines catches with two stutters, burns with a white core and flashes
static const int8_t neon_ck[6] PROGMEM = {-16, -7, -4, 14, 16, -21};
static void neonDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), s = imax(imax(tent(t - 110, 50) * 160 / 255, tent(t - 250, 50) * 210 / 255), smooth(360, 440, t)), fl = tent(t - 700, 250);
    int s1[4] = {(int8_t)pgm_read_byte(&neon_ck[0]), (int8_t)pgm_read_byte(&neon_ck[1]), (int8_t)pgm_read_byte(&neon_ck[2]), (int8_t)pgm_read_byte(&neon_ck[3])},
        s2[4] = {(int8_t)pgm_read_byte(&neon_ck[2]), (int8_t)pgm_read_byte(&neon_ck[3]), (int8_t)pgm_read_byte(&neon_ck[4]), (int8_t)pgm_read_byte(&neon_ck[5])};
    uint32_t cc = mix(col, C_WHITE, 90 + (120 * fl / 255));
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3), d = imin(segDist(p, q, s1, 256), segDist(p, q, s2, 256));
        put(i, d < 3 ? cc : col, (neon(d) * s / 255) * fo / 255);
    }
}

// Ошибка · Искрит: the frame sparks at the top right, three white sparks, the tube by them stutters; then it dies from there
// both ways round, and the pink tube goes out with a last flicker
static void neonError(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), D = 140 * smooth(650, 1250, t) / 255, sk = imax(imax(tent(t - 220, 60), tent(t - 390, 50)), tent(t - 560, 70));
    uint32_t fc = mix(col, C_WHITE, 110), pc = mix(C_PINK, C_WHITE, 90);
    int g2 = 120 - (120 * smooth(750, 950, t) / 255) + (tent(t - 1000, 50) * 90 / 255), dip = 255 - (sk >> 1);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3), r = ringOf(i), da = abs(((b_ang[i] - 44 + 128) & 255) - 128);
        int a = 0;
        uint32_t c = col;
        if (r == 0) {
            a = 185 * (da < D ? 0 : da < D + 12 ? (da - D) * 255 / 12 : 255) / 255;
            if (da < 24) a = a * dip / 255;
            c = fc;
        } else if (r == 2) {
            a = g2;
            c = pc;
        }
        int v = tent(oct(p - 44, q + 21), 12) * sk / 255;
        if (v > a) {
            a = v;
            c = C_WHITE;
        }
        put(i, c, a * fo / 255);
    }
}

// Уведомление · Стрелка: a neon arrow to the right blinks three times, stepping a ball forward on each blink
static const int8_t neon_ar[12] PROGMEM = {-36, 0, 20, 0, 12, -14, 20, 0, 12, 14, 20, 0};
static void neonNotify(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), j = t < 380 ? 0 : t < 760 ? 1 : 2, u = t - j * 380, dx = j * 8;
    int g = smooth(0, 50, u) * (j < 2 ? smooth(300, 250, u) : 255) / 255;
    uint32_t cc = mix(col, C_WHITE, 120);
    int s[4] = {0, 0, 0, 0};
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int d = 99;
        for (int m = 0; m < 3; m++) {
            s[0] = (int8_t)pgm_read_byte(&neon_ar[4 * m]) + dx;
            s[1] = (int8_t)pgm_read_byte(&neon_ar[4 * m + 1]);
            s[2] = (int8_t)pgm_read_byte(&neon_ar[4 * m + 2]) + dx;
            s[3] = (int8_t)pgm_read_byte(&neon_ar[4 * m + 3]);
            d = imin(d, segDist(p, q, s, 256));
        }
        put(i, d < 3 ? cc : col, (neon(d) * g / 255) * fo / 255);
    }
}

// ----- 17 · Маятник: physics: a pendulum hung above the top edge
// at (x, −45), 53 long: the bob hangs in the middle of row 4

// the bob of a pendulum hung at px, turned by th (256 a turn, + to the right)
static int pendX(int px, int th) {
    return px + (53 * psin(th) / 128);
}
static int pendY(int th) {
    return -45 + (53 * pcos(th) / 128);
}

// Пробуждение · Толчок: the pendulum fades in hanging still; at 0.35 s a push (a ring off the bob) and it swings wider and wider
// into the listening's swing (its phase, the amplitude growing)
static void pendWake(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t), g = smooth(0, 300, t), e = smooth(350, 1700, t), fl = tent(t - 380, 160);
    int th = (wave(t - du, 91) * 28 / 128) * e / 255, bx = pendX(0, th), by = pendY(th), s[4] = {0, -45, bx, by};
    int rr = imax(0, t - 350) * 70 / 1000, rf = t > 350 ? 255 - smooth(350, 900, t) : 0;
    uint32_t hc = mix(col, C_WHITE, 90 + (fl * 150 / 255));
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = tent(segDist(p, q, s, 256), 5) * 40 / 255;
        uint32_t c = col;
        int d = oct(p - bx, q - by), v = tent(d, 10);
        if (rf) a = imax(a, tent(d - 10 - rr, 6) * rf / 300);
        if (v > a) {
            a = v;
            c = d < 4 ? hc : col;
        }
        put(i, c, (a * g / 255) * fo / 255);
    }
}

// Слушает · Качание: one pendulum swings slowly (2.8 s there and back, ±39°) with a soft trail; the string glows faintly
static void pendListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int bx[3] = {0, 0, 0}, by[3] = {0, 0, 0};
    uint32_t wc = mix(col, C_WHITE, 150);
    int s[4] = {0, -45, 0, 0};
    for (int m = 0; m < 3; m++) {
        int th = wave(t - m * 70, 91) * 28 / 128;
        bx[m] = pendX(0, th);
        by[m] = pendY(th);
    }
    s[2] = bx[0];
    s[3] = by[0];
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = tent(segDist(p, q, s, 256), 5) * 40 / 255;
        uint32_t c = col;
        for (int m = 0; m < 3; m++) {
            int d = oct(p - bx[m], q - by[m]), v = tent(d, m ? 8 : 10) * (m ? 120 - m * 40 : 255) / 255;
            if (v > a) {
                a = v;
                c = !m && d < 4 ? wc : col;
            }
        }
        put(i, c, a * k / 255);
    }
}

// Думает · Колыбель Ньютона: five balls hang in a row; the right one swings out on its string and clicks back, the left one flies out; violet
static void pendThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    uint32_t c = mix(col, C_VIOLET, 128);
    int s = posMod(t, 1200), ln[4] = {0, -45, 0, 0};
    int thR = s < 600 ? psin(s * 128 / 600) * 24 / 128 : 0, thL = s >= 600 ? -(psin((s - 600) * 128 / 600) * 24 / 128) : 0;
    int ck = imax(imax(tent(s, 90), tent(s - 600, 90)), tent(s - 1200, 90));
    uint32_t wc = mix(c, C_WHITE, 200 * ck / 255), hc = mix(c, C_WHITE, 90);
    int j = s < 600 ? 4 : 0, th = j ? thR : thL, mx = pendX(-32 + 16 * j, th), my = pendY(th);  // the ball that swings now
    ln[0] = -32 + 16 * j;
    ln[2] = mx;
    ln[3] = my;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = th ? tent(segDist(p, q, ln, 256), 4) * 36 / 255 : 0;  // its string
        uint32_t cc = c;
        for (int b = 0; b < 5; b++) {
            int x = b == j ? mx : -32 + 16 * b, y = b == j ? my : 7, d = oct(p - x, q - y);
            if (d < 8) {
                int v = tent(d, 8);
                if (v > a) {
                    a = v;
                    cc = d < 4 ? (b && b < 4 ? wc : hc) : c;
                }
            }
        }
        put(i, cc, a * k / 255);
    }
}

// Говорит · Прыжки: the five balls on their strings jump with the voice: the middle one at once, its neighbours a beat and two later
static void pendSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int v[3] = {voice(t - 140), voice(t - 70), voice(t)};
    uint32_t wc = mix(col, C_WHITE, 160);
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = 0;
        uint32_t c = col;
        for (int j = 0; j < 5; j++) {
            int e = v[j < 2 ? j : 4 - j], x = -32 + 16 * j, y = 7 - (e * 16 / 255);
            if (q < y - 4 && p == x) a = imax(a, 24);  // the string, straight up
            int d = oct(p - x, q - y), w = tent(d, 8) * (150 + (e * 105 / 255)) / 255;
            if (w > a) {
                a = w;
                c = d < 4 && e > 150 ? wc : col;
            }
        }
        put(i, c, a * k / 255);
    }
}

// Готово · В такт: all five balls swing out to the right together and come back as one; the click: a flash and a ring
static void pendDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), g = smooth(0, 150, t), th = t < 900 ? psin(t * 128 / 900) * 26 / 128 : 0, fl = tent(t - 920, 240);
    int ox = pendX(0, th), y = pendY(th), rr = imax(0, t - 900) * 90 / 1000, rf = t > 900 ? 255 - smooth(900, 1500, t) : 0;
    uint32_t wc = mix(col, C_WHITE, 170), hc = mix(col, C_WHITE, 60 + (150 * fl / 255));
    int s[4] = {0, -45, 0, y};
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = 0;
        uint32_t c = col;
        for (int j = 0; j < 5; j++) {
            int x0 = -32 + 16 * j, x = x0 + ox;
            if (th) {
                s[0] = x0;
                s[2] = x;
                a = imax(a, tent(segDist(p, q, s, 256), 4) * 30 / 255);
            }
            int d = oct(p - x, q - y), v = tent(d, 8) * (170 + (85 * fl / 255)) / 255;
            if (v > a) {
                a = v;
                c = d < 4 || fl > 120 ? hc : col;
            }
        }
        if (rf) {
            int v = tent(oct(p, q - 7) - rr, 7) * rf / 255;
            if (v > a) {
                a = v;
                c = wc;
            }
        }
        put(i, c, (a * g / 255) * fo / 255);
    }
}

// Ошибка · Обрыв: the pendulum swings down from the left; near the bottom (0.6 s) the string snaps with a white flash and the ball
// flies on to the right and falls off the bottom edge; the stub of the string fades
static void pendError(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), g = smooth(0, 100, t), th = -(28 * pcos(imin(t, 600) * 128 / 1400) / 128), sx = pendX(0, th), sy = pendY(th), w = t - 600;
    int bx = w > 0 ? sx + (w * 82 / 1000) : sx, by = w > 0 ? sy + (w * 12 / 1000) + (w * w * 64 / 1000000) : sy;
    int sg = w > 0 ? 40 * (255 - smooth(0, 500, w)) / 255 : 40, s[4] = {0, -45, w > 0 ? sx >> 1 : sx, w > 0 ? (sy - 45) >> 1 : sy}, fl = w >= 0 ? tent(w, 160) : 0;
    uint32_t wc = mix(col, C_WHITE, 170), hc = mix(col, C_WHITE, 90);
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = sg ? tent(segDist(p, q, s, 256), 5) * sg / 255 : 0;
        uint32_t c = col;
        if (fl) {
            int v = tent(oct(p - s[2], q - s[3]), 10) * fl / 255;
            if (v > a) {
                a = v;
                c = wc;
            }
        }
        int d = oct(p - bx, q - by), v = tent(d, 10);
        if (v > a) {
            a = v;
            c = d < 4 ? hc : col;
        }
        put(i, c, (a * g / 255) * fo / 255);
    }
}

// Уведомление · Тик-так: the pendulum gives two quick short swings, right and left; a «tick» at each end: the bob whitens, a faint ring
static void pendNotify(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), g = smooth(0, 120, t);
    int th = t < 300 ? psin(t * 128 / 300) * 18 / 128 : t >= 350 && t < 650 ? -(psin((t - 350) * 128 / 300) * 18 / 128) : 0;
    int tk = imax(tent(t - 150, 110), tent(t - 500, 110)), bx = pendX(0, th), by = pendY(th), s[4] = {0, -45, bx, by};
    uint32_t hc = mix(col, C_WHITE, 60 + (tk * 150 / 255));
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        int a = tent(segDist(p, q, s, 256), 5) * 40 / 255;
        uint32_t c = col;
        int d = oct(p - bx, q - by), v = tent(d, 10);
        a = imax(a, tent(d - 14, 5) * tk / 400);
        if (v > a) {
            a = v;
            c = d < 4 ? hc : col;
        }
        put(i, c, (a * g / 255) * fo / 255);
    }
}

// ----- 18 · Гирлянда: the balls as string lights: 11 bulbs on a sagging wire, each in its own colour, Kaya's among them
static const int8_t gar_b[22] PROGMEM = {-64, -21, -52, -14, -40, -7, -28, 0, -16, 7, 0, 7, 16, 7, 28, 0, 40, -7, 52, -14, 64, -21};  // the bulbs, (p, q), each on a ball
static const uint32_t gar_pal[4] PROGMEM = {0, 0xffa83a, 0xff4f6e, 0x7fe05a};  // by k & 3: 0 = Kaya's colour, warm amber, rose, green
static const uint8_t gar_ph[11] PROGMEM = {0, 140, 60, 200, 100, 30, 170, 90, 220, 120, 45}, gar_sp[11] PROGMEM = {57, 43, 64, 50, 39, 61, 47, 55, 41, 66, 52};  // each bulb's phase and pace
#define C_WIRE 0xffe2b0
#define C_WARM 0xfff0d8

// bulb k's own colour (c0: the colour of every fourth, Kaya's in the states)
static uint32_t garCol(int k, uint32_t c0) {
    int j = k & 3;
    return j ? pgm_read_dword(&gar_pal[j]) : c0;
}

// the garland at ball i: the wire at brightness w between the bulbs; bulb k lights its own ball at g[k] in cb[k];
// no halo, so neighbouring colours never mix
static void garPut(uint8_t i, int p, int q, const int* g, const uint32_t* cb, int w, int k) {
    int s[4] = {0, 0, 0, 0};
    int j = 0, a = 0;
    uint32_t c = C_WIRE;
    while (j < 9 && p >= (int8_t)pgm_read_byte(&gar_b[2 * j + 2])) j++;
    if (w && p >= -64 && p <= 64) {
        s[0] = (int8_t)pgm_read_byte(&gar_b[2 * j]);
        s[1] = (int8_t)pgm_read_byte(&gar_b[2 * j + 1]);
        s[2] = (int8_t)pgm_read_byte(&gar_b[2 * j + 2]);
        s[3] = (int8_t)pgm_read_byte(&gar_b[2 * j + 3]);
        a = tent(segDist(p, q, s, 256), 5) * w / 255;
    }
    for (int m = j; m <= j + 1; m++) {  // the two bulbs round it
        if (oct(p - (int8_t)pgm_read_byte(&gar_b[2 * m]), q - (int8_t)pgm_read_byte(&gar_b[2 * m + 1])) < 4 && g[m] > a) {
            a = g[m];
            c = cb[m];
        }
    }
    put(i, c, a * k / 255);
}

// Пробуждение · По цепочке: the wire glows first, then the bulbs light one after another from the left, each with a white flash
static void garWake(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 400, t), g[11] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    uint32_t cb[11] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    for (int m = 0; m < 11; m++) {
        int u = t - 200 - m * 100;
        g[m] = u < 0 ? 0 : smooth(0, 80, u) * (255 - (70 * smooth(100, 450, u) / 255)) / 255;
        cb[m] = mix(garCol(m, col), C_WHITE, 60 + (160 * tent(u - 80, 150) / 255));
    }
    fr.dg = 128;
    int w = 18 * smooth(0, 250, t) / 255;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) garPut(i, 4 * (b_x(i) - 19), 7 * (b_row(i) - 3), g, cb, w, fo);
}

// Слушает · Мерцание: every bulb breathes slowly at its own pace (3.9–6.6 s), the wire faintly warm
static void garListen(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int g[11] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    uint32_t cb[11] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    for (int m = 0; m < 11; m++) {
        int s = sin8((pgm_read_byte(&gar_ph[m]) + (t * pgm_read_byte(&gar_sp[m]) / 1000)) & 255);
        g[m] = 120 + ((s * s / 255) * 135 / 255);
        cb[m] = mix(garCol(m, col), C_WHITE, 60);
    }
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) garPut(i, 4 * (b_x(i) - 19), 7 * (b_row(i) - 3), g, cb, 18, k);
}

// Думает · Бегущие огни: a chase runs along the string: every third bulb is lit and the light flows on to the next, 6 bulbs a second
static void garThink(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    // (v1.9: h moves 768, a whole round of the pattern, every 500 ms, so t goes in modulo 500: the same frames, and
    // t · 1536 never overflows a 32-bit int in a long state)
    int h = posMod(t, 500) * 1536 / 1000, g[11] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    uint32_t cb[11] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    for (int m = 0; m < 11; m++) {
        int ph = posMod(m * 256 - h, 768), w = imin(ph, 768 - ph);
        g[m] = 20 + (235 * smooth(256, 0, w) / 255);
        cb[m] = mix(garCol(m, col), C_WHITE, 40 + (110 * smooth(160, 0, w) / 255));
    }
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) garPut(i, 4 * (b_x(i) - 19), 7 * (b_row(i) - 3), g, cb, 18, k);
}

// Говорит · Вспышки: the bulbs flare with the voice, from the middle out to the ends
static void garSpeak(Anim, int t, uint32_t col, int k) {
    if (k <= 0) return;
    int v[3] = {voice(t), voice(t - 80), voice(t - 160)}, g[11] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    uint32_t cb[11] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    for (int m = 0; m < 11; m++) {
        int e = v[abs(m - 5) >> 1];
        g[m] = 70 + (e * 185 / 255);
        cb[m] = mix(garCol(m, col), C_WHITE, 40 + (e * 140 / 255));
    }
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) garPut(i, 4 * (b_x(i) - 19), 7 * (b_row(i) - 3), g, cb, 18, k);
}

// Готово · Праздник: the whole garland flashes green and white, then sparkles: bulb by bulb they flare to white
static void garDone(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), fl = 255 - smooth(150, 450, t), on = smooth(0, 60, t), g[11] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    uint32_t cb[11] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    for (int m = 0; m < 11; m++) {
        int s = sin8((pgm_read_byte(&gar_ph[m]) + (t * pgm_read_byte(&gar_sp[m]) * 5 / 1000)) & 255), tw = s * s / 255;
        g[m] = imax(fl, 100 + (tw * 155 / 255)) * on / 255;
        cb[m] = mix(col, C_WHITE, imax(fl * 200 / 255, tw * 170 / 255));
    }
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) garPut(i, 4 * (b_x(i) - 19), 7 * (b_row(i) - 3), g, cb, 30, fo);
}

// Ошибка · Перегорела: the middle bulb blows with a white pop (a ring of sparks) and smoulders red; the garland goes dark from it
// to the ends, each bulb reddening and going out
static void garError(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), on = smooth(0, 80, t), pop = tent(t - 300, 120), rr = imax(0, t - 300) * 70 / 1000, rf = t > 300 ? 255 - smooth(300, 750, t) : 0;
    int g[11] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    uint32_t cb[11] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, pc = mix(col, C_WHITE, 120);
    int wl = 18 * (255 - smooth(900, 1400, t)) / 255;
    for (int m = 0; m < 11; m++) {
        if (m == 5) {
            g[m] = imax(pop, t < 300 ? 185 : 90 * (255 - smooth(400, 1000, t)) / 255);
            cb[m] = mix(t < 300 ? garCol(5, C_WARM) : col, C_WHITE, imax(60, 230 * pop / 255));
        } else {
            int T = 450 + abs(m - 5) * 110;
            g[m] = 185 * (255 - smooth(T + 80, T + 260, t)) / 255;
            cb[m] = mix(mix(garCol(m, C_WARM), col, smooth(T - 80, T + 60, t)), C_WHITE, 50);
        }
        g[m] = g[m] * on / 255;
    }
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) {
        int p = 4 * (b_x(i) - 19), q = 7 * (b_row(i) - 3);
        garPut(i, p, q, g, cb, wl, fo);
        if (rf) put(i, pc, (tent(oct(p, q - 7) - rr, 6) * rf / 255) * fo / 255);
    }
}

// Уведомление · Двойной бег: a bright light runs along the garland from left to right twice, fast, with a tail; then all of it blinks amber
static void garNotify(Anim, int t, int du, uint32_t col) {
    int fo = smooth(du, du - 300, t), j = t < 550 ? 0 : 1, u = t - j * 550, h = u < 480 ? u * 3072 / 450 : 99999, all = tent(t - 1150, 220), on = smooth(0, 80, t);
    int g[11] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    uint32_t cb[11] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    for (int m = 0; m < 11; m++) {
        int d = h - m * 256, v = d >= -128 && d < 768 ? tent(d, d < 0 ? 128 : 768) : 0, e = imax(v, all);
        g[m] = imax(45, e) * on / 255;
        cb[m] = mix(mix(garCol(m, C_WARM), col, e), C_WHITE, 40 + (e * 150 / 255));
    }
    fr.dg = 128;
    for (uint8_t i = 0; i < MX_LED_AMOUNT; i++) garPut(i, 4 * (b_x(i) - 19), 7 * (b_row(i) - 3), g, cb, 16, fo);
}

// ----- the event in a new style

// a state (listening, thinking, speaking) of style 4–18; k: how far it shows (255 = all)
static void styleState(uint8_t style, Anim n, int t, uint32_t col, int k) {
    if (n == A_LISTENING) {
        switch (style) {
            case 4: ppListen(n, t, col, k); break;
            case 5: kalListen(n, t, col, k); break;
            case 6: lavaListen(n, t, col, k); break;
            case 7: faceListen(n, t, col, k); break;
            case 8: galListen(n, t, col, k); break;
            case 9: scanListen(n, t, col, k); break;
            case 10: snowListen(n, t, col, k); break;
            case 11: flyListen(n, t, col, k); break;
            case 12: flameListen(n, t, col, k); break;
            case 13: arcListen(n, t, col, k); break;
            case 14: tetListen(n, t, col, k); break;
            case 15: gearListen(n, t, col, k); break;
            case 16: neonListen(n, t, col, k); break;
            case 17: pendListen(n, t, col, k); break;
            default: garListen(n, t, col, k); break;
        }
    } else if (n == A_THINKING) {
        switch (style) {
            case 4: ppThink(n, t, col, k); break;
            case 5: kalThink(n, t, col, k); break;
            case 6: lavaThink(n, t, col, k); break;
            case 7: faceThink(n, t, col, k); break;
            case 8: galThink(n, t, col, k); break;
            case 9: scanThink(n, t, col, k); break;
            case 10: snowThink(n, t, col, k); break;
            case 11: flyThink(n, t, col, k); break;
            case 12: flameThink(n, t, col, k); break;
            case 13: arcThink(n, t, col, k); break;
            case 14: tetThink(n, t, col, k); break;
            case 15: gearThink(n, t, col, k); break;
            case 16: neonThink(n, t, col, k); break;
            case 17: pendThink(n, t, col, k); break;
            default: garThink(n, t, col, k); break;
        }
    } else {
        switch (style) {
            case 4: ppSpeak(n, t, col, k); break;
            case 5: kalSpeak(n, t, col, k); break;
            case 6: lavaSpeak(n, t, col, k); break;
            case 7: faceSpeak(n, t, col, k); break;
            case 8: galSpeak(n, t, col, k); break;
            case 9: scanSpeak(n, t, col, k); break;
            case 10: snowSpeak(n, t, col, k); break;
            case 11: flySpeak(n, t, col, k); break;
            case 12: flameSpeak(n, t, col, k); break;
            case 13: arcSpeak(n, t, col, k); break;
            case 14: tetSpeak(n, t, col, k); break;
            case 15: gearSpeak(n, t, col, k); break;
            case 16: neonSpeak(n, t, col, k); break;
            case 17: pendSpeak(n, t, col, k); break;
            default: garSpeak(n, t, col, k); break;
        }
    }
}

// a one-shot (the wake, done, error, notify) of style 4–18, t = 0 .. du
static void styleShot(uint8_t style, Anim n, int t, int du, uint32_t col) {
    if (n == A_WAKE) {
        switch (style) {
            case 4: ppWake(n, t, du, col); break;
            case 5: kalWake(n, t, du, col); break;
            case 6: lavaWake(n, t, du, col); break;
            case 7: faceWake(n, t, du, col); break;
            case 8: galWake(n, t, du, col); break;
            case 9: scanWake(n, t, du, col); break;
            case 10: snowWake(n, t, du, col); break;
            case 11: flyWake(n, t, du, col); break;
            case 12: flameWake(n, t, du, col); break;
            case 13: arcWake(n, t, du, col); break;
            case 14: tetWake(n, t, du, col); break;
            case 15: gearWake(n, t, du, col); break;
            case 16: neonWake(n, t, du, col); break;
            case 17: pendWake(n, t, du, col); break;
            default: garWake(n, t, du, col); break;
        }
    } else if (n == A_DONE) {
        switch (style) {
            case 4: ppDone(n, t, du, col); break;
            case 5: kalDone(n, t, du, col); break;
            case 6: lavaDone(n, t, du, col); break;
            case 7: faceDone(n, t, du, col); break;
            case 8: galDone(n, t, du, col); break;
            case 9: scanDone(n, t, du, col); break;
            case 10: snowDone(n, t, du, col); break;
            case 11: flyDone(n, t, du, col); break;
            case 12: flameDone(n, t, du, col); break;
            case 13: arcDone(n, t, du, col); break;
            case 14: tetDone(n, t, du, col); break;
            case 15: gearDone(n, t, du, col); break;
            case 16: neonDone(n, t, du, col); break;
            case 17: pendDone(n, t, du, col); break;
            default: garDone(n, t, du, col); break;
        }
    } else if (n == A_ERROR) {
        switch (style) {
            case 4: ppError(n, t, du, col); break;
            case 5: kalError(n, t, du, col); break;
            case 6: lavaError(n, t, du, col); break;
            case 7: faceError(n, t, du, col); break;
            case 8: galError(n, t, du, col); break;
            case 9: scanError(n, t, du, col); break;
            case 10: snowError(n, t, du, col); break;
            case 11: flyError(n, t, du, col); break;
            case 12: flameError(n, t, du, col); break;
            case 13: arcError(n, t, du, col); break;
            case 14: tetError(n, t, du, col); break;
            case 15: gearError(n, t, du, col); break;
            case 16: neonError(n, t, du, col); break;
            case 17: pendError(n, t, du, col); break;
            default: garError(n, t, du, col); break;
        }
    } else {
        switch (style) {
            case 4: ppNotify(n, t, du, col); break;
            case 5: kalNotify(n, t, du, col); break;
            case 6: lavaNotify(n, t, du, col); break;
            case 7: faceNotify(n, t, du, col); break;
            case 8: galNotify(n, t, du, col); break;
            case 9: scanNotify(n, t, du, col); break;
            case 10: snowNotify(n, t, du, col); break;
            case 11: flyNotify(n, t, du, col); break;
            case 12: flameNotify(n, t, du, col); break;
            case 13: arcNotify(n, t, du, col); break;
            case 14: tetNotify(n, t, du, col); break;
            case 15: gearNotify(n, t, du, col); break;
            case 16: neonNotify(n, t, du, col); break;
            case 17: pendNotify(n, t, du, col); break;
            default: garNotify(n, t, du, col); break;
        }
    }
}

// ----- the event in its look

// a state in its look; style: kaia_anim (1–18), look: the event's setting, k: how far it shows (255 = all)
static void stateLook(uint8_t style, uint8_t look, Anim n, int t, uint32_t col, int k) {
    look = lookOf(style, look);
    if (look < 4) {
        stateDraw(look ? look : style, n, t, col, k);
        return;
    }
    if (pgm_read_byte(&look_style[look])) {
        styleState(pgm_read_byte(&look_style[look]), n, t, col, k);
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
    look = lookOf(style, look);
    if (look < 4) {
        shotDraw(look ? look : style, n, t, du, col);
        return;
    }
    if (pgm_read_byte(&look_style[look])) {
        styleShot(pgm_read_byte(&look_style[look]), n, t, du, col);
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

// the wake that plays: kaia_wake, or with 0 the style's own (style_wake: 1–3 theirs, 4–18 their wakes 15–29)
static int wakeOf(int style, int wake) {
    return wake ? wake : pgm_read_byte(&style_wake[style]);
}

// the wake's real length at the speed, ms
static int wakeLength(int id, int speed) {
    return (int)pgm_read_word(&wake_ms[id]) * 100 / speed;
}

// t: ms since the wake started (real time); style: kaia_anim (1–18); wake: kaia_wake (0 = the style's: wakeOf);
// lk: kaia_listen, the look of the listening that fades in under the wake and goes on after it
static void wakeDraw(uint8_t style, uint8_t wake, uint8_t lk, int speed, int t, uint32_t col) {
    int id = wakeOf(style, wake);
    int du = pgm_read_word(&wake_ms[id]);
    int u = t * speed / 100;  // the wake's own time
    if (u > du) u = du;
    fr.lt = t - wakeLength(id, speed);  // the listening's time: it goes on at its own pace after the wake
    fr.ls = lk >= 4 ? 0 : lk ? lk : style <= 3 ? style : 0;  // the listening's style (0: a new look or a new style)

    if (pgm_read_byte(&wake_style[id])) styleShot(pgm_read_byte(&wake_style[id]), A_WAKE, u, du, col);
    else switch (id) {
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

// the saved style (kaia_anim, 0 = off), the saved look of an event, the saved speed of the wake; a value out of range
// reads as the default
static uint8_t savedStyle() {
    int v = db[kk::kaia_anim].toInt();
    return v >= 0 && v <= STYLE_COUNT ? v : 1;
}

static uint8_t savedLook(Anim n) {
    int v = db[(size_t)pgm_read_dword(&look_keys[n])].toInt();
    return v >= 0 && v < (n == A_WAKE ? WAKE_COUNT : LOOK_COUNT) ? v : 0;
}

static uint8_t savedWakeSpeed() {
    int s = db[kk::kaia_wake_speed].toInt();
    return s >= 50 && s <= 200 ? s : 100;
}

// ================= the Digit fade (v1.7, web/src/frame.js) =================

// its settings, in hide_keys' order
struct HideSet {
    uint32_t kaia_hide, kaia_hide_out, kaia_hide_in, kaia_hide_hold, kaia_hide_keep;
};

// the keys with their ranges and db.init's defaults
static const struct {
    uint32_t key;
    uint16_t lo, hi, def;
} hide_keys[] PROGMEM = {
    {kk::kaia_hide, 0, 1, 1},
    {kk::kaia_hide_out, 100, 3000, 600},
    {kk::kaia_hide_in, 100, 5000, 1200},
    {kk::kaia_hide_hold, 0, 5000, 1000},
    {kk::kaia_hide_keep, 0, 100, 0},
};
#define HIDE_KEYS (sizeof(hide_keys) / sizeof(hide_keys[0]))

// the index of a Digit fade key in hide_keys, or -1
static int hideIndex(size_t key) {
    for (uint8_t i = 0; i < HIDE_KEYS; i++) {
        if (pgm_read_dword(&hide_keys[i].key) == key) return i;
    }
    return -1;
}

// the saved value of hide_keys[i]; a value out of range reads as the default (as savedLook)
static uint16_t savedHide(uint8_t i) {
    int v = db[(size_t)pgm_read_dword(&hide_keys[i].key)].toInt();
    return v >= (int)pgm_read_word(&hide_keys[i].lo) && v <= (int)pgm_read_word(&hide_keys[i].hi) ? v : pgm_read_word(&hide_keys[i].def);
}

static HideSet hideSet() {
    return {savedHide(0), savedHide(1), savedHide(2), savedHide(3), savedHide(4)};
}

// the level h, 16 bits (0 = shown, 65535 = gone), stepped by the real ms between two frames (dt, capped so the
// uint32_t product cannot overflow): up while an animation is drawn, down once kaia_hide_hold ms have passed since the
// last one (sinceEnd); a new animation turns it round where it stands. kaia_hide 0 → 0 at once
static uint16_t hideStep(int32_t h, uint32_t dt, bool playing, uint32_t sinceEnd, const HideSet& S) {
    if (!S.kaia_hide) return 0;
    if (dt > 60000) dt = 60000;
    if (playing) {
        h += (int32_t)(65535 * dt / S.kaia_hide_out);
        return h > 65535 ? 65535 : h;
    }
    if (sinceEnd >= S.kaia_hide_hold) {
        h -= (int32_t)(65535 * dt / S.kaia_hide_in);
        return h < 0 ? 0 : h;
    }
    return h;
}

// one step a frame with whether an animation is drawn now (frame.js hideTrack: ov.hide, ov.hideT, ov.hideEnd, ov.hideOn).
// It reads the settings itself, so they stay out of kaiaDraw's frame while the looks run
static void hideTrack(bool playing, uint32_t now) {
    HideSet S = hideSet();
    uint32_t dt = now - ov.hideT;
    ov.hideT = now;
    if (playing) ov.hideOn = true;
    else if (ov.hideOn) {
        ov.hideOn = false;
        ov.hideEnd = now;
    }
    ov.hide = hideStep(ov.hide, dt, playing, now - ov.hideEnd, S);
}

// frame.js digitHide(): smoothstep of the level, less by kaia_hide_keep %
uint8_t kaiaDigitScale() {
    HideSet S = hideSet();
    if (!S.kaia_hide) return 0;
    return smooth(0, 65535, ov.hide) * (100 - S.kaia_hide_keep) / 100;
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
    if (ov.anim == A_WAKE) return wakeLength(wakeOf(ov.style, ov.look), ov.speed);
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
    if (!savedStyle() && !ov.own_style) return false;
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

void kaiaDraw(bool night, uint8_t hide) {
    uint32_t now = millis();
    uint8_t rule = db[kk::kaia_night].toInt();
    uint8_t style = savedStyle();

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

    // the Digit fade steps every frame, before the returns below: an animation is drawn (frame.js isPlaying; the
    // running text never counts)
    hideTrack((ov.mode == M_SHOT || ov.mode == M_STATE) && style && !(night && rule == 2), now);

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
    fr.hd = hide;

    if (ov.mode == M_STATE) stateLook(ov.style, ov.look, ov.anim, t, col, 255);
    else if (ov.anim == A_WAKE) wakeDraw(ov.style, ov.look, ov.lk, ov.speed, t, col);
    else shotLook(ov.style, ov.look, ov.anim, t, col);
    fr.hd = 0;
}

// ================= HTTP: /kaia/state, /kaia/show, /kaia/anim =================

static KaiaServer* srv = nullptr;

// every setting but the Wi-Fi and the page password
static const char state_keys[] PROGMEM =
    "show_ip,ntp_gmt,ntp_host,bright,auto_bright,bright_min,bright_max,adc_min,adc_max,"
    "night_mode,night_mode_auto,night_mode_auto_since,night_mode_auto_to,night_color,night_trsh,"
    "clock_style,clock_style_zero,clock_color,back_mode,back_pal,back_speed,back_angle,back_scale,back_bright,"
    "kaia_anim,kaia_wake,kaia_wake_speed,kaia_listen,kaia_think,kaia_speak,kaia_done,kaia_error,kaia_notify,"
    "kaia_hide,kaia_hide_out,kaia_hide_in,kaia_hide_hold,kaia_hide_keep,"
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
    s.reserve(1500);  // v1.7: the Digit fade's keys add about 95
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
    s += F(",\"stack\":");
    s += ESP.getFreeContStack();  // the lowest free cont stack since boot (of 4096)
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
        int hi = hideIndex(h);
        if (ev != A_OFF) {
            s += savedLook(ev);
        } else if (h == kk::kaia_anim) {
            s += savedStyle();
        } else if (h == kk::kaia_wake_speed) {
            s += savedWakeSpeed();
        } else if (hi >= 0) {
            s += savedHide(hi);
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
    if (!readNum(F("style"), 1, STYLE_COUNT, style)) return replyError(400, F("style: 1-18"));
    if (!readNum(F("wake"), 0, WAKE_COUNT - 1, wake)) return replyError(400, F("wake: 0-29"));
    if (!readNum(F("speed"), 50, 200, speed)) return replyError(400, F("speed: 50-200"));
    // look= for every name but off: the event's animation for this call (wake= is its old name for the wake)
    if (n == A_WAKE) {
        if (!readNum(F("look"), 0, WAKE_COUNT - 1, look)) return replyError(400, F("look: 0-29 for wake"));
        if (look < 0) look = wake;
    } else if (n != A_OFF) {
        if (!readNum(F("look"), 0, LOOK_COUNT - 1, look)) return replyError(400, F("look: 0-23"));
    }

    ov.text_waits = false;
    if (n == A_OFF) {
        LOGF(LG_DEBUG, "kaia", "off");
        ov.mode = M_NONE;
        return replyOk();
    }

    // an explicit style plays even when the saved one is off
    bool own_style = style;
    if (!own_style) style = savedStyle();
    if (style < 1 || style > STYLE_COUNT) return replyOk();  // animations are off in the settings

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

// GET /kaia/test (v1.8): every animation drawn off screen once and timed on the real CPU, so a release checks them all
// without a crash in front of the owner (KAIA-186 was a boot loop from one bad read). Each style's own version of every
// event (styles 1–18, look 0), every look of listening … notify (1–23) and every wake (1–29), both with style 1; a
// one-shot at its start, its middle and 50 ms before its end, a state at 0, 15 s, 50 ms before a call's default 30 s,
// 60 s and 70 min. Drawn into the strip without show(), a yield() after each animation, then the normal frame again.
// The animations' own state (ov) is not touched. Small frames: it runs inside a web handler on the 4 KB cont stack.

// the run so far: how many draws, the slowest one
struct KaiaTest {
    uint16_t n;
    uint32_t us;
    uint8_t kind, id;  // 0 a style (id) with look 0, 1 a look (id) with style 1, 2 a wake (id) with style 1
    Anim anim;
    uint32_t t;
};

// the moments of a state, ms
static const uint32_t test_state_t[5] PROGMEM = {0, 15000, KAIA_STATE_MS - 50, 60000, 70ul * 60 * 1000};

// one draw, its micros
static uint32_t __attribute__((noinline)) testDraw(uint8_t kind, uint8_t id, Anim n, int t) {
    uint8_t style = kind ? 1 : id, look = kind ? id : 0;
    uint32_t col = n == A_DONE ? C_GREEN : n == A_ERROR ? C_RED : n == A_NOTIFY ? C_AMBER : db[kk::kaia_color].toInt32();
    fr.sc = 255;
    fr.dg = 89;
    fr.hd = 0;
    uint32_t us = micros();
    if (n == A_WAKE) wakeDraw(style, look, 0, 100, t, col);
    else if (n <= A_SPEAKING) stateLook(style, look, n, t, col, 255);
    else shotLook(style, look, n, t, col);
    return micros() - us;
}

// one animation at its moments, then the network's turn
static void __attribute__((noinline)) testAnim(KaiaTest& r, uint8_t kind, uint8_t id, Anim n) {
    bool state = n >= A_LISTENING && n <= A_SPEAKING;
    uint8_t style = kind ? 1 : id, look = kind ? id : 0;
    int du = n == A_WAKE ? wakeLength(wakeOf(style, look), 100) : state ? 0 : shotLength(n, look, style);
    for (uint8_t m = 0; m < (state ? 5 : 3); m++) {
        uint32_t t = state ? pgm_read_dword(&test_state_t[m]) : m == 0 ? 0 : m == 1 ? du / 2 : du - 50;
        uint32_t us = testDraw(kind, id, n, t);
        r.n++;
        if (us > r.us) {
            r.us = us;
            r.kind = kind;
            r.id = id;
            r.anim = n;
            r.t = t;
        }
    }
    yield();
}

// {ok, n, slowest: {name, us}, ms} and one log line
static void __attribute__((noinline)) testReply(const KaiaTest& r, uint32_t ms) {
    char name[40], ev[sizeof(anim_names[0])];
    strcpy_P(ev, anim_names[r.anim]);
    if (r.kind == 2) snprintf_P(name, sizeof(name), PSTR("wake=%u t=%u"), (unsigned)r.id, (unsigned)r.t);
    else snprintf_P(name, sizeof(name), r.kind ? PSTR("look=%u %s t=%u") : PSTR("style=%u %s t=%u"), (unsigned)r.id, ev, (unsigned)r.t);
    LOGF(LG_INFO, "kaia", "test n=%u slowest=\"%s\" us=%u ms=%u", (unsigned)r.n, name, (unsigned)r.us, (unsigned)ms);

    char p[112];
    snprintf_P(p, sizeof(p), PSTR("{\"ok\":true,\"n\":%u,\"slowest\":{\"name\":\"%s\",\"us\":%u},\"ms\":%u}"),
               (unsigned)r.n, name, (unsigned)r.us, (unsigned)ms);
    reply(200, p);
}

static void handleTest() {
    if (!authorized()) return;

    uint32_t start = millis();
    KaiaTest r = {};
    for (uint8_t s = 1; s <= STYLE_COUNT; s++) {
        for (uint8_t n = A_WAKE; n < A_OFF; n++) testAnim(r, 0, s, (Anim)n);
    }
    for (uint8_t l = 1; l < LOOK_COUNT; l++) {
        for (uint8_t n = A_LISTENING; n < A_OFF; n++) testAnim(r, 1, l, (Anim)n);
    }
    for (uint8_t w = 1; w < WAKE_COUNT; w++) testAnim(r, 2, w, A_WAKE);
    redrawFrame();  // the strip as the clock draws it, shown
    testReply(r, millis() - start);
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
    server.on("/kaia/test", HTTP_GET, handleTest);
#ifdef ESP8266
    server.addHandler(new SettingsGuard());
#endif
}
