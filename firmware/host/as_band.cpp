// band_logic.h as the band's own compiler takes it. The ESP32 Arduino core
// compiles C++ as gnu++11, and every firmware file sees Arduino.h's macros
// first; logic_test.cpp is C++17 and has neither. Without this, a constexpr
// loop and a note table named LOW passed npm test and broke only in pio.
// tests/firmware.test.js compiles it, and nothing runs it.

#include "arduino_macros.h"

#include "../src/band_logic.h"

static_assert(otb::SOUND_SAMPLES > 0, "the sound buffers are sized when the band is built");
