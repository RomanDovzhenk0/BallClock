#pragma once
#include <Arduino.h>

// the names of paletteArr, ";" between them, in flash: Select takes it as a Text, no 650 B String on the heap
const __FlashStringHelper* getPaletteList();
uint32_t getPaletteColor(uint8_t pal, uint16_t idx, uint8_t bright);