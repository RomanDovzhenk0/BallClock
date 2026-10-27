#pragma once
#include "adcf.h"

extern ADCFilt photo;

// the brightness the last frame was drawn with (0..255)
uint8_t redrawBright();

// night mode was on in the last frame
bool redrawNight();

// one frame as the 50 ms timer draws it: the background, the clock, the overlay, then the strip shown
// (v1.8: GET /kaia/test draws it again after its run)
void redrawFrame();
