#include <GyverGFX.h>

// BallClock Generator
#define MX_LED_AMOUNT 128
#define MX_XY_W 39
#define MX_XY_H 13
#define MX_DIAG_W 20
#define MX_DIAG_H 7

// each channel from a towards b by k / 255, truncating toward zero (the overlay's blend and the Digit fade's)
inline uint32_t mix(uint32_t a, uint32_t b, int k) {
    uint32_t out = 0;
    for (uint8_t s = 0; s <= 16; s += 8) {
        int ca = (a >> s) & 0xff, cb = (b >> s) & 0xff;
        out |= (uint32_t)(ca + (cb - ca) * k / 255) << s;
    }
    return out;
}

// BallMatrix
class BallMatrix : public GyverGFX {
   public:
    BallMatrix() {
        setModeXY();
    }

    // strip
    void setLED(uint8_t idx, uint32_t color);
    uint32_t getLED(uint8_t idx);
    void begin();
    void update();
    void setBright(uint8_t bright);
    void clear();

    // gfx
    void fastSet(int x, int y) {
        if (_buf16 != getColor()) {
            _buf16 = getColor();
            _buf32 = getColor24full();
        }
        setLED(x, y, _buf32);
    }

    // matrix
    int ledXY(int x, int y);
    int ledDiag(int x, int y);

    void setLED(int x, int y, uint32_t color) {
        int led = _diag_mode ? ledDiag(x, y) : ledXY(x, y);
        if (led < 0) return;
        if (_marking) {
            _marks[led >> 3] |= 1 << (led & 7);
            if (markAlpha < 255) color = mix(getLED(led), color, markAlpha);
        }
        setLED(led, color);
    }

    // v1.7: while marking, setLED(x, y, c) draws this much of the new colour over what is there (255 = all)
    uint8_t markAlpha = 255;

    // marks: the balls drawn by x, y between beginMarks and endMarks (the clock digits)
    void beginMarks() {
        memset(_marks, 0, sizeof(_marks));
        _marking = true;
    }
    void endMarks() {
        _marking = false;
    }
    bool marked(uint8_t idx) {
        return _marks[idx >> 3] & (1 << (idx & 7));
    }
    uint32_t getLED(int x, int y) {
        int led = _diag_mode ? ledDiag(x, y) : ledXY(x, y);
        return (led >= 0) ? getLED(led) : 0;
    }

    void setModeXY() {
        _diag_mode = false;
        size(MX_XY_W, MX_XY_H);
    }
    void setModeDiag() {
        _diag_mode = true;
        size(MX_DIAG_W, MX_DIAG_H);
    }

   private:
    bool _diag_mode = false;
    bool _marking = false;
    uint8_t _marks[MX_LED_AMOUNT / 8] = {};
    uint16_t _buf16;
    uint32_t _buf32;
};

extern BallMatrix matrix;