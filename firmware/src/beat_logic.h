// ON THE BEAT — the beat on the wristband, with no hardware in it
// (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §2).
//
// What the microphone's samples become: five levels a block, which the band's
// tracker follows. Its twin is app/lib/beat.js, which the stand-in at /band
// runs; tests/firmware.test.js holds the two to each other on the same
// samples. This side works in float, as the band's FPU does; the stand-in in
// double, so they are held to within a small tolerance, not to the bit.
//
// band_logic.h includes this, so it builds as the band's compiler takes it
// (C++11, after Arduino's macros) as well as on a laptop.

#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>

namespace otb {

constexpr uint32_t BEAT_RATE = 16000;         // the microphone's samples a second
constexpr size_t BEAT_BLOCK = 128;            // samples in one block: 8 ms of sound
constexpr size_t BEAT_BANDS = 5;              // below 150 Hz, up to 400, 1200, 3500, and above

// Where the five bands meet, in Hz.
constexpr float BEAT_EDGE_1 = 150;
constexpr float BEAT_EDGE_2 = 400;
constexpr float BEAT_EDGE_3 = 1200;
constexpr float BEAT_EDGE_4 = 3500;

// One block's five levels: the root mean square of each band.
struct BandLevels {
  float v[BEAT_BANDS];
};

// A second-order low or high pass, Q 0.7071 (the RBJ cookbook), carried from
// sample to sample and so from block to block.
class BeatFilter {
 public:
  BeatFilter(bool low, float fc) {
    const float w = 6.28318530718f * fc / static_cast<float>(BEAT_RATE);
    const float cw = std::cos(w);
    const float al = std::sin(w) / (2 * 0.7071f);
    const float a0 = 1 + al;
    const float edge = low ? (1 - cw) / 2 : (1 + cw) / 2;
    b0_ = edge / a0;
    b1_ = (low ? 1 - cw : -(1 + cw)) / a0;
    b2_ = edge / a0;
    a1_ = -2 * cw / a0;
    a2_ = (1 - al) / a0;
  }
  float step(float x) {
    const float y = b0_ * x + z1_;
    z1_ = b1_ * x - a1_ * y + z2_;
    z2_ = b2_ * x - a2_ * y;
    return y;
  }

 private:
  float b0_ = 0, b1_ = 0, b2_ = 0, a1_ = 0, a2_ = 0;
  float z1_ = 0, z2_ = 0;
};

// Five levels a block, after a slow tracker has taken out any offset from zero.
class Levels {
 public:
  // One block of BEAT_BLOCK samples in, its five levels out.
  BandLevels block(const int16_t* samples) {
    float sum[BEAT_BANDS] = {0, 0, 0, 0, 0};
    for (size_t i = 0; i < BEAT_BLOCK; ++i) {
      const float x = samples[i];
      dc_ += 0.001f * (x - dc_);
      const float y = x - dc_;
      const float v[BEAT_BANDS] = {lo150_.step(y), lo400_.step(hi150_.step(y)), lo1200_.step(hi400_.step(y)),
                                   lo3500_.step(hi1200_.step(y)), hi3500_.step(y)};
      for (size_t k = 0; k < BEAT_BANDS; ++k) sum[k] += v[k] * v[k];
    }
    BandLevels out;
    for (size_t k = 0; k < BEAT_BANDS; ++k) out.v[k] = std::sqrt(sum[k] / BEAT_BLOCK);
    return out;
  }

 private:
  float dc_ = 0;
  BeatFilter lo150_{true, BEAT_EDGE_1}, hi150_{false, BEAT_EDGE_1};
  BeatFilter lo400_{true, BEAT_EDGE_2}, hi400_{false, BEAT_EDGE_2};
  BeatFilter lo1200_{true, BEAT_EDGE_3}, hi1200_{false, BEAT_EDGE_3};
  BeatFilter lo3500_{true, BEAT_EDGE_4}, hi3500_{false, BEAT_EDGE_4};
};

}  // namespace otb
