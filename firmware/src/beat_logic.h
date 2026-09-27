// ON THE BEAT — the beat on the wristband, with no hardware in it
// (docs/superpowers/specs/2026-09-26-wrist-beat-design.md §2).
//
// What the microphone's samples become, five levels a block, and the tracker
// that follows the beat in them and says where to pulse. Their twins are in
// app/lib/beat.js, which the stand-in at /band runs; tests/firmware.test.js
// holds them to each other on the same samples and the same blocks.
//
// Levels works in float, as the band's FPU does, and the stand-in in double,
// so the two are held to within a small tolerance. BeatTracker keeps the
// levels, the onset strength and the tempo's sums in float and the rest in
// double, and the stand-in rounds the same values the same way, so the two
// trackers agree to the bit and no threshold can tip differently.
//
// band_logic.h includes this, so it builds as the band's compiler takes it
// (C++11, after Arduino's macros) as well as on a laptop.

#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <vector>

namespace otb {

constexpr uint32_t BEAT_RATE = 16000;         // the microphone's samples a second
constexpr size_t BEAT_BLOCK = 128;            // samples in one block: 8 ms of sound
constexpr size_t BEAT_BANDS = 5;              // below 150 Hz, up to 400, 1200, 3500, and above

// Where the five bands meet, in Hz.
constexpr float BEAT_EDGE_1 = 150;
constexpr float BEAT_EDGE_2 = 400;
constexpr float BEAT_EDGE_3 = 1200;
constexpr float BEAT_EDGE_4 = 3500;

// A lit card's light on the beat (§1): its full light on the beat, falling in a straight line to half of that over
// the first two thirds of the beat, and half until the next. `since` is the time from the pulse, in ms.
inline int pulseLight(int full, double since, double period) {
  return full - static_cast<int>(std::floor((full / 2.0) * std::min(1.0, since / ((2 * period) / 3))));
}

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


// The tracker's named values (§2's table), all a guess until worn. app/lib/beat.js BEAT_CONSTS has the same.
constexpr double BEAT_ONSET = 2.5;            // a heard beat's rise, against the window's mean onset strength...
constexpr double BEAT_ONSET_MIN = 6;          // ...and never below this, in dB
constexpr uint32_t BEAT_WINDOW_MS = 6000;     // the onset strength the tempo is read from
constexpr uint32_t BEAT_LOOK_MS = 128;        // how often the tempo is read
constexpr uint32_t BEAT_SHORTEST_MS = 336;    // the periods read: 178 BPM...
constexpr uint32_t BEAT_LONGEST_MS = 752;     // ...to 80
constexpr double BEAT_PRIOR_MS = 500;         // the tempo a listener would tap...
constexpr double BEAT_PRIOR_OCT = 0.7;        // ...and how firmly, in octaves
constexpr double BEAT_LOCK_CONF = 4;          // how far the best period must stand out, in standard deviations
constexpr double BEAT_LOCK_CONTRAST = 4.5;    // how far the beat must stand out of its own period
constexpr size_t BEAT_LOCK_LOOKS = 6;         // looks in a row with the same period...
constexpr double BEAT_STEADY = 0.02;          // ...within this much of it
constexpr uint32_t BEAT_PHASE_MS = 2000;      // the stretch folded to place the grid
constexpr double BEAT_NEAR = 0.12;            // of a period, either side of a beat
constexpr float BEAT_RISE = 0.25f;            // a rise is traced back while it is at least this much of its peak
constexpr double BEAT_TIGHT_MS = 30;          // how near its beat a drum must start for the beat to be heard
constexpr double BEAT_PULL_PHASE = 0.3;       // how far a heard beat pulls the next beat...
constexpr double BEAT_PULL_PERIOD = 0.05;     // ...and the period
constexpr double BEAT_CHANGE = 0.05;          // the most the period moves from its lock; more is another song
constexpr size_t BEAT_START = 4;              // a new grid pulses once this many...
constexpr size_t BEAT_START_OF = 5;           // ...of the last this many were heard, looking back from where it was laid...
constexpr size_t BEAT_CONFIRM = 2;            // ...and keeps pulsing while this many...
constexpr size_t BEAT_OF = 3;                 // ...of the last this many were
constexpr double BEAT_HOLD = 4;               // or one was, with the fold on the grid peaking this far above its mean
constexpr int BEAT_OTHER_LOOKS = 8;           // looks before a heard grid gives way
constexpr uint32_t BEAT_LOSE_MS = 4000;       // nothing heard this long, and the grid is dropped
constexpr double BEAT_CREEP = 0.125;          // ms a block the microphone's count may creep later, following millis()
constexpr uint32_t BEAT_SETTLE = 16;          // blocks timed but not heard once the microphone opens, while its filters settle

constexpr double BEAT_BLOCK_MS = BEAT_BLOCK * 1000.0 / BEAT_RATE;  // one block, in ms

// A pulse the tracker decided: when it is due, and the period of the grid it was laid on, in ms.
struct BeatPulse {
  double at;
  double period;
};

// Follows the beat in the five levels, block by block, and says where to pulse (app/lib/beat.js createTracker).
// Each block is handed in with the time it ends, counted in samples; the pulses come out a block ahead, at each
// beat less the microphone's delay. In doubt it does not pulse.
class BeatTracker {
 public:
  BeatTracker() {
    for (size_t L = SHORTEST; L <= LONGEST; ++L) {
      const double q = std::log2((static_cast<double>(L) * BEAT_BLOCK_MS) / BEAT_PRIOR_MS) / BEAT_PRIOR_OCT;
      prior_[L - SHORTEST] = std::exp(-0.5 * q * q);
    }
    reset();
  }

  // One block's five levels, and the time it ends.
  void hear(const BandLevels& levels, uint32_t now) {
    // Blocks not heard since the one before: the microphone was closed, and the clock ran on.
    const bool deaf = n_ > 0 && now - times_[n_ - 1] > 1.5 * BEAT_BLOCK_MS;
    const double deafFrom = deaf ? times_[n_ - 1] : 0;
    const double deafTo = deaf ? static_cast<double>(now) - BEAT_BLOCK_MS : 0;
    double f = 0;
    const size_t have = std::min<size_t>(histN_ + 1, 3);
    for (size_t k = 0; k < BEAT_BANDS; ++k) {
      double* h = hist_[k];
      const double db = 20 * std::log10(static_cast<double>(levels.v[k]) + 1);
      if (histN_ == 3) {
        h[0] = h[1];
        h[1] = h[2];
        h[2] = db;
      } else {
        h[histN_] = db;
      }
      if (have == 3) f += std::max(0.0, h[2] - std::max(h[1], h[0]));
    }
    histN_ = have;
    const float v = static_cast<float>(f);
    sum_ += v;
    if (n_ == WINDOW) {
      sum_ -= odf_[0];
      std::copy(odf_ + 1, odf_ + n_, odf_);
      std::copy(times_ + 1, times_ + n_, times_);
      --n_;
    }
    odf_[n_] = v;
    times_[n_] = now;
    ++n_;
    if (++blocks_ % LOOK == 0) evaluate(now);
    if (!locked_) return;
    while (next_ <= now) {
      push({next_, UNHEARD, false});
      next_ += period_;
      ++beat_;
    }
    if (deaf) {
      for (size_t i = 0; i < beatsN_; ++i) {
        if (std::fabs(beats_[i].t - (deafFrom + deafTo) / 2) < (deafTo - deafFrom) / 2 + BEAT_NEAR * period_) beats_[i].deaf = true;
      }
    }
    // Beats whose windows, and the half beat after, have closed.
    for (size_t i = 0; i < beatsN_; ++i) {
      if (beats_[i].h == UNHEARD && !beats_[i].deaf && now >= beats_[i].t + period_ / 2) close(beats_[i]);
    }
    if (now - lastHeard_ > BEAT_LOSE_MS) {
      locked_ = false;
      period_ = 0;
    } else if (decided_ != beat_ && next_ - latency_ <= now + BEAT_BLOCK_MS) {
      // The next beat's pulse, decided in the last block before it is due.
      decided_ = beat_;
      if (confirmed()) pulses_.push_back({next_ - latency_, period_});
    }
  }

  // Forget everything heard: the microphone has closed.
  void reset() {
    histN_ = 0;
    n_ = 0;
    sum_ = 0;
    blocks_ = 0;
    lagsN_ = 0;
    locked_ = false;
    period_ = 0;
    base_ = 0;
    next_ = 0;
    beat_ = 0;
    decided_ = 0;
    other_ = 0;
    lastHeard_ = -std::numeric_limits<double>::infinity();
    beatsN_ = 0;
    started_ = false;
    held_ = 0;
    pulses_.clear();
  }

  // The microphone's delay from a sound to the block that hears it, in ms.
  void setLatency(double ms) { latency_ = ms; }

  // The pulses decided since last asked.
  std::vector<BeatPulse> take() {
    std::vector<BeatPulse> out;
    out.swap(pulses_);
    return out;
  }

  bool locked() const { return locked_; }
  double period() const { return period_; }

 private:
  // The named values in blocks: the window kept, how often it is read, and the periods read.
  enum : size_t {
    WINDOW = BEAT_WINDOW_MS * BEAT_RATE / 1000 / BEAT_BLOCK,
    LOOK = BEAT_LOOK_MS * BEAT_RATE / 1000 / BEAT_BLOCK,
    SHORTEST = BEAT_SHORTEST_MS * BEAT_RATE / 1000 / BEAT_BLOCK,
    LONGEST = BEAT_LONGEST_MS * BEAT_RATE / 1000 / BEAT_BLOCK,
    PERIODS = LONGEST - SHORTEST + 1,
  };
  enum : int8_t { UNHEARD = -1 };  // a beat whose window has not closed

  struct Beat {
    double t;
    int8_t h;   // UNHEARD, 0 or 1
    bool deaf;  // the microphone was closed for it: neither heard nor missed
  };

  double floorOf() const { return std::max(BEAT_ONSET_MIN, BEAT_ONSET * (n_ ? sum_ / n_ : 0)); }
  // The strongest rise in [a, b): its index, or -1.
  long argPeak(double a, double b) const {
    long k = -1;
    for (long i = static_cast<long>(n_) - 1; i >= 0 && times_[i] >= a; --i) {
      if (times_[i] < b && (k < 0 || odf_[i] > odf_[k])) k = i;
    }
    return k;
  }
  double val(long k) const { return k < 0 ? 0 : odf_[k]; }

  void push(const Beat& b) {
    beats_[beatsN_++] = b;
    if (beatsN_ > 8) {
      std::copy(beats_ + 1, beats_ + beatsN_, beats_);
      --beatsN_;
    }
  }

  // A beat whose window has closed: was it heard, and where did its drum start?
  void close(Beat& b) {
    const double w = BEAT_NEAR * period_;
    const long k = argPeak(b.t - w, b.t + w);
    const double off = std::max(val(argPeak(b.t - period_ / 2, b.t - w)), val(argPeak(b.t + w, b.t + period_ / 2)));
    b.h = val(k) >= floorOf() && val(k) >= off;
    if (!b.h) return;
    long s = k;
    while (s > 0 && times_[s - 1] >= b.t - w && odf_[s - 1] >= BEAT_RISE * odf_[k]) --s;
    const double e = times_[s] - b.t;
    // A drum that started well off the beat is another grid's, not this one's.
    if (std::fabs(e) > BEAT_TIGHT_MS) {
      b.h = 0;
      return;
    }
    lastHeard_ = std::max(lastHeard_, b.t);
    // The loop: phase and period pulled a part of the way to the drum.
    next_ += BEAT_PULL_PHASE * e;
    period_ = std::min(base_ * (1 + BEAT_CHANGE), std::max(base_ * (1 - BEAT_CHANGE), period_ + BEAT_PULL_PERIOD * e));
  }

  // Of the last n beats the microphone was open for, how many were heard.
  size_t heard(size_t n) const {
    size_t seen = 0, h = 0;
    for (size_t i = beatsN_; i-- > 0 && seen < n;) {
      if (beats_[i].deaf) continue;
      ++seen;
      if (beats_[i].h == 1) ++h;
    }
    return h;
  }

  // A new grid pulses once BEAT_START of its last BEAT_START_OF beats were heard; then BEAT_CONFIRM of the last
  // BEAT_OF keep it, or one, while something rose near the last beat and the fold on the grid stands out by BEAT_HOLD.
  bool confirmed() {
    if (!started_ && heard(BEAT_START_OF) >= BEAT_START) started_ = true;
    const size_t h = heard(BEAT_OF);
    return started_ && (h >= BEAT_CONFIRM || (h >= 1 && rose() && held_ >= BEAT_HOLD));
  }

  // Something near the last beat rose as far as a heard beat must: the room has not gone quiet, nor the song moved.
  bool rose() const {
    for (size_t i = beatsN_; i-- > 0;) {
      if (beats_[i].deaf) continue;
      const double w = BEAT_NEAR * period_;
      return val(argPeak(beats_[i].t - w, beats_[i].t + w)) >= floorOf();
    }
    return false;
  }

  // The fold's bin for a time, at period P.
  static size_t bin(double t, double P, size_t bins) {
    return static_cast<size_t>(std::floor(std::fmod(std::fmod(t, P) + P, P) / BEAT_BLOCK_MS)) % bins;
  }

  // The last BEAT_PHASE_MS folded on the grid: its beat (BEAT_NEAR either side) against the fold's mean.
  double holding(uint32_t now) const {
    const double P = period_;
    const size_t bins = static_cast<size_t>(std::round(P / BEAT_BLOCK_MS));
    double fold[LONGEST + 2] = {};
    for (long i = static_cast<long>(n_) - 1; i >= 0 && now - times_[i] <= BEAT_PHASE_MS; --i) {
      fold[bin(times_[i] - next_, P, bins)] += odf_[i];
    }
    double total = 0;
    for (size_t i = 0; i < bins; ++i) total += fold[i];
    const double fm = total / bins;
    const long w = std::lround((BEAT_NEAR * P) / BEAT_BLOCK_MS);
    const long n = static_cast<long>(bins);
    double best = 0;
    for (long j = -w; j <= w; ++j) best = std::max(best, fold[(j + n) % n]);
    return fm > 0 ? best / fm : 0;
  }

  struct Candidate {
    bool ok;
    double P;
    double phase;
  };

  // The tempo read from the window, and where its grid would go.
  bool candidate(uint32_t now, Candidate& out) {
    const size_t N = n_;
    if (N < 3 * LONGEST) return false;
    const float m = static_cast<float>(sum_ / N);
    auto r = [&](size_t L) {
      float s = 0;
      for (size_t i = L; i < N; ++i) s += (odf_[i] - m) * (odf_[i - L] - m);
      return s / static_cast<float>(N - L);
    };
    const float first = r(0);
    const double r0 = first != 0 ? first : 1;
    double score[PERIODS];
    for (size_t L = SHORTEST; L <= LONGEST; ++L) {
      score[L - SHORTEST] = prior_[L - SHORTEST] * (r(L) / r0 + (2 * L < N ? (0.5 * r(2 * L)) / r0 : 0));
    }
    size_t bi = 0;
    for (size_t i = 1; i < PERIODS; ++i) {
      if (score[i] > score[bi]) bi = i;
    }
    const size_t bestL = SHORTEST + bi;
    const auto rest = [bi](size_t i) { return i + 4 < bi || i > bi + 4; };
    double mu = 0;
    size_t count = 0;
    for (size_t i = 0; i < PERIODS; ++i) {
      if (rest(i)) mu += score[i], ++count;
    }
    mu /= count;
    double dev = 0;
    for (size_t i = 0; i < PERIODS; ++i) {
      if (rest(i)) dev += (score[i] - mu) * (score[i] - mu);
    }
    double sd = std::sqrt(dev / count);
    if (sd == 0) sd = 1e-9;
    const double conf = (score[bi] - mu) / sd;
    if (lagsN_ == BEAT_LOCK_LOOKS) {
      std::copy(lags_ + 1, lags_ + lagsN_, lags_);
      --lagsN_;
    }
    lags_[lagsN_++] = bestL;
    const size_t lo = *std::min_element(lags_, lags_ + lagsN_);
    const size_t hi = *std::max_element(lags_, lags_ + lagsN_);
    const bool steady = lagsN_ == BEAT_LOCK_LOOKS && hi - lo <= std::max(1.0, BEAT_STEADY * bestL);
    // A parabola through the peak: the period between blocks.
    const double a = bi > 0 ? score[bi - 1] : score[bi];
    const double b = score[bi];
    const double d = bi < PERIODS - 1 ? score[bi + 1] : score[bi];
    const double shift = a - 2 * b + d != 0 ? (0.5 * (a - d)) / (a - 2 * b + d) : 0;
    const double P = (bestL + std::max(-0.5, std::min(0.5, shift))) * BEAT_BLOCK_MS;
    const size_t bins = static_cast<size_t>(std::round(P / BEAT_BLOCK_MS));
    double fold[LONGEST + 2] = {};
    for (long i = static_cast<long>(N) - 1; i >= 0 && now - times_[i] <= BEAT_PHASE_MS; --i) fold[bin(times_[i], P, bins)] += odf_[i];
    size_t ph = 0;
    for (size_t i = 1; i < bins; ++i) {
      if (fold[i] > fold[ph]) ph = i;
    }
    double total = 0;
    for (size_t i = 0; i < bins; ++i) total += fold[i];
    const double fm = total / bins;
    const double contrast = fm > 0 ? (fold[ph] + (fold[(ph + 1) % bins] + fold[(ph + bins - 1) % bins]) / 2) / (2 * fm) : 0;
    out.ok = conf >= BEAT_LOCK_CONF && contrast >= BEAT_LOCK_CONTRAST && steady;
    out.P = P;
    out.phase = (ph + 0.5) * BEAT_BLOCK_MS;
    return true;
  }

  void grid(double P, double phase, uint32_t now) {
    locked_ = true;
    period_ = P;
    base_ = P;
    other_ = 0;
    lastHeard_ = now;
    started_ = false;
    held_ = 0;
    next_ = std::ceil((now - phase) / P) * P + phase;
    ++beat_;
    beatsN_ = 0;
    // The beats just gone, heard or not by what is already in the window.
    for (size_t j = BEAT_START_OF; j >= 1; --j) {
      Beat b = {next_ - j * P, UNHEARD, false};
      if (b.t + BEAT_NEAR * P <= now && b.t + P / 2 <= now) close(b);
      push(b);
    }
  }

  void evaluate(uint32_t now) {
    Candidate cand;
    if (!candidate(now, cand)) return;
    if (!locked_) {
      if (cand.ok) grid(cand.P, cand.phase, now);
      return;
    }
    held_ = holding(now);
    if (!cand.ok) {
      other_ = 0;
      return;
    }
    const double d = std::fmod(std::fmod(cand.phase - next_, cand.P) + cand.P, cand.P);
    const bool differs = std::fabs(cand.P - period_) > BEAT_CHANGE * period_ || std::min(d, cand.P - d) > BEAT_NEAR * period_;
    if (differs && !confirmed()) return grid(cand.P, cand.phase, now);
    other_ = differs ? other_ + 1 : 0;
    if (other_ >= BEAT_OTHER_LOOKS) grid(cand.P, cand.phase, now);
  }

  double prior_[PERIODS];         // the tempo a listener would tap, as a weight for each period
  double latency_ = 0;
  double hist_[BEAT_BANDS][3];    // per band, its last three levels in dB
  size_t histN_ = 0;
  float odf_[WINDOW];             // onset strength, one a block...
  uint32_t times_[WINDOW];        // ...and when
  size_t n_ = 0;
  double sum_ = 0;                // of odf_
  uint32_t blocks_ = 0;
  size_t lags_[BEAT_LOCK_LOOKS];  // the best period of the last looks, in blocks
  size_t lagsN_ = 0;
  bool locked_ = false;
  double period_ = 0;
  double base_ = 0;               // the period locked
  double next_ = 0;               // the next beat...
  uint32_t beat_ = 0;             // ...and its number
  uint32_t decided_ = 0;          // the number of the last beat whose pulse was decided
  int other_ = 0;                 // looks in a row at another grid
  double lastHeard_ = 0;
  Beat beats_[9];                 // the grid's recent beats
  size_t beatsN_ = 0;
  bool started_ = false;
  double held_ = 0;
  std::vector<BeatPulse> pulses_;
};

// When each of the microphone's blocks ended, by millis() (app/lib/beat.js createBlockClock). The blocks are
// counted, a block apart, as the microphone hands them over two at a time. Its samples run 382 ppm fast of
// millis() on both bands (measured 27 Sep 2026), which counting alone would carry into the pulses at 23 ms a
// minute, so the count is held to millis(): a block is never timed after it was handed over, and the count creeps
// later by at most BEAT_CREEP a block while blocks come later than it says. Blocks the band could not keep are
// counted over. The first BEAT_SETTLE blocks after the microphone opens are timed but not heard.
class BlockClock {
 public:
  // The microphone has opened: count afresh, and let it settle.
  void reset() {
    started_ = false;
    settle_ = BEAT_SETTLE;
  }

  // A block handed over at `arrival`, `lost` blocks after the last. False while it settles; else `t` is when it ended.
  bool at(uint32_t arrival, uint32_t lost, uint32_t& t) {
    if (!started_) {
      started_ = true;
      base_ = arrival;
      off_ = 0;
    } else {
      off_ += BEAT_BLOCK_MS * (1 + static_cast<double>(lost));
      const double late = static_cast<double>(arrival - base_) - off_;
      off_ += late < 0 ? late : std::min(late, BEAT_CREEP);
    }
    if (settle_ > 0) {
      --settle_;
      return false;
    }
    t = base_ + static_cast<uint32_t>(std::floor(off_ + 0.5));
    return true;
  }

 private:
  bool started_ = false;
  uint32_t base_ = 0;  // when the first block since the microphone opened was handed over
  double off_ = 0;     // when the last block ended, from base_, in ms
  uint32_t settle_ = BEAT_SETTLE;
};

}  // namespace otb
