#pragma once
#include "adcf.h"

extern ADCFilt photo;

// the brightness the last frame was drawn with (0..255)
uint8_t redrawBright();

// night mode was on in the last frame
bool redrawNight();
