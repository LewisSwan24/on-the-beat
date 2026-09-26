// ON THE BEAT — the wristband's own logic, with no hardware in it.
//
// main.cpp is only the hardware round this file: the screen, the two
// buttons, Wi-Fi and the socket. Everything that decides something is here,
// in plain C++17, so it builds on a laptop as well as on the wristband.
// tests/firmware.test.js compiles it with the host's own compiler and holds it
// against the real relay: the frames it sends are frames the relay takes, and
// every frame the relay sends is read back the way the relay meant it.
//
// Its Wrist is the same machine as the stand-in at /band (app/lib/wrist.js),
// on the same named timings, and both are run against one table of cases
// (tests/fixtures/wrist-cases.json).
//
// What it shows is never decided here. The relay decides that, in
// relay/band.js, from the same view its person's phone is sent; this only
// draws it, and goes dark when it can no longer trust what it was told.

#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <functional>
#include <string>
#include <vector>

namespace otb {

constexpr uint32_t WAKE_MS = 6000;            // a KEY1 press shows the face this long
constexpr uint32_t HOLD_MS = 1500;            // held this long: NOT NOW on KEY1, "send now" on KEY2
constexpr uint32_t BAR_MS = 300;              // a KEY1 hold shows KEEP HOLDING from here
constexpr uint32_t CHOOSE_MS = 6000;          // longest wait for the next KEY2 press before a choice is dropped
constexpr uint32_t COMMIT_MS = 3000;          // after the last KEY2 step, the choice is sent (not from NOT NOW)
constexpr uint32_t CONFIRM_MS = 10000;        // longest wait for the relay to show a sent choice
constexpr uint32_t RESULT_MS = 3000;          // SET / NOT SENT / CHANGED stays on the face this long
constexpr uint32_t PING_EVERY_MS = 2000;      // ask the relay this often...
constexpr uint32_t DEAF_MS = 6000;            // ...and take this much silence as a dead socket
constexpr uint32_t RETRY_MS = 1500;           // between tries to reach the relay
constexpr uint32_t STALE_MS = 10000;          // out of reach this long, what the relay last said is not shown
constexpr uint32_t QUIET_CONFIRM_MS = 3000;   // NOT NOW from the wrist stays dark at least until the relay answers, or this long
constexpr uint32_t BLINK_MS = 500;            // a meeting that calls blinks: its face this long, then off this long
constexpr uint32_t HINT_MS = 3000;            // a press on the letters or the check says PAIR ON YOUR PHONE this long
constexpr uint32_t PAIR_AWAKE_MS = 120000;    // new letters, or the waiting face, stay lit this long; so does a press on them
constexpr uint32_t BATTERY_EVERY_MS = 30000;  // at most one battery report this often
constexpr uint32_t BATTERY_DRIFT_MS = 300000; // a one-point change is only worth a report after this long
constexpr uint32_t REJOIN_MS = 15000;         // without Wi-Fi this long, the radio is asked to join again
constexpr const char* WS_PATH = "/api/ws";

constexpr uint8_t LIGHT_FULL = 255;   // a card, from across a dark room
constexpr uint8_t LIGHT_DIM = 128;    // the relay says the battery is low: half, as the canvas has it
constexpr uint8_t LIGHT_PAIR = 160;   // bright enough to scan, not so bright the camera blooms
constexpr uint8_t LIGHT_AWAKE = 110;  // a woken face, and every face read up close
constexpr uint8_t LIGHT_OFF = 0;

// ---------- what the wrist plays ----------
//
// The same tables as app/lib/wrist.js SOUNDS and FLASHES; tests/firmware.test.js
// holds them equal. A note is Hz and ms, 0 Hz a rest.

struct Note {
  uint16_t hz, ms;
};
struct Sound {
  const char* name;
  const Note* notes;
  size_t count;
};

namespace detail {
constexpr Note TICK[] = {{1800, 25}};
constexpr Note DOUBLE[] = {{1800, 25}, {0, 60}, {1800, 25}};
constexpr Note DOWN[] = {{1047, 90}, {784, 180}};
constexpr Note UP[] = {{1047, 70}, {1319, 70}, {1568, 70}, {2093, 140}};
constexpr Note FALL[] = {{1568, 100}, {1047, 200}};
constexpr Note LOW_TONE[] = {{784, 120}, {523, 220}};  // not LOW: Arduino.h makes LOW a macro
constexpr Note ASK[] = {{1319, 80}, {0, 50}, {1760, 160}};
constexpr Note JINGLE[] = {{1319, 80}, {1568, 80}, {2637, 80}, {2093, 80}, {2349, 80}, {3136, 200}};
constexpr Note WARN[] = {{880, 150}, {698, 150}, {880, 150}, {698, 150}};
constexpr Note HELLO[] = {{1568, 60}, {2093, 120}};
constexpr Note FOUND[] = {{1568, 70}, {2093, 70}, {2637, 70}, {0, 40}, {2637, 70}, {3136, 220}};
template <size_t N>
constexpr Sound sound(const char* name, const Note (&notes)[N]) { return {name, notes, N}; }
}  // namespace detail

constexpr Sound SOUNDS[] = {
    detail::sound("tick", detail::TICK),     detail::sound("double", detail::DOUBLE), detail::sound("down", detail::DOWN),
    detail::sound("up", detail::UP),         detail::sound("fall", detail::FALL),     detail::sound("low", detail::LOW_TONE),
    detail::sound("ask", detail::ASK),       detail::sound("jingle", detail::JINGLE), detail::sound("warn", detail::WARN),
    detail::sound("hello", detail::HELLO),   detail::sound("found", detail::FOUND),
};

inline const Sound* soundFor(const std::string& name) {
  for (const Sound& s : SOUNDS)
    if (name == s.name) return &s;
  return nullptr;
}

// The band's compiler takes C++11, where a constexpr function is one return
// statement: so these sums recurse rather than loop.

/** How long `count` notes last, in ms. */
constexpr uint32_t notesMs(const Note* notes, size_t count) {
  return count ? notes->ms + notesMs(notes + 1, count - 1) : 0;
}

inline uint32_t soundMs(const char* name) {
  const Sound* s = name ? soundFor(name) : nullptr;
  return s ? notesMs(s->notes, s->count) : 0;
}

// A sound is played as one buffer of samples, so painting the face, which holds
// the loop for tens of milliseconds, cannot bend a tune's rhythm.

constexpr uint32_t SOUND_RATE = 16000;  // samples a second

constexpr uint32_t longerOf(uint32_t a, uint32_t b) { return a > b ? a : b; }

/** The longest sound in the table from the i-th on, in ms: from 0, what one buffer must hold. */
constexpr uint32_t longestSoundMs(size_t i = 0) {
  return i == sizeof(SOUNDS) / sizeof(SOUNDS[0]) ? 0
                                                 : longerOf(notesMs(SOUNDS[i].notes, SOUNDS[i].count), longestSoundMs(i + 1));
}

constexpr size_t SOUND_SAMPLES = longestSoundMs() * (SOUND_RATE / 1000);  // one buffer

// A buzzer is not a speaker. The StickC Plus's, swept a semitone at a time
// beside a microphone, is loud from about 2.8 kHz to 4.7 kHz, where the sweep
// ended, and weak under 2.6 kHz: played through it, down, low and warn, every
// note under 1.1 kHz, did not rise over the room at all. So on a buzzer a sound
// goes up whole octaves, which keeps its tune and every note's length, as far
// as its highest note stays within BUZZER_TOP_HZ.

constexpr uint32_t BUZZER_TOP_HZ = 4700;

/** The highest of `count` notes, in Hz. */
constexpr uint32_t highestHz(const Note* notes, size_t count, uint32_t high = 0) {
  return count ? highestHz(notes + 1, count - 1, notes->hz > high ? notes->hz : high) : high;
}

/** What notes that reach `top` Hz are multiplied by on a buzzer: 1, 2, 4... */
constexpr uint32_t buzzerFactor(uint32_t top, uint32_t factor = 1) {
  return top && top * factor * 2 <= BUZZER_TOP_HZ ? buzzerFactor(top, factor * 2) : factor;
}

inline uint32_t buzzerFactor(const Sound& s) { return buzzerFactor(highestHz(s.notes, s.count)); }

// Octaves alone would make two sounds one. NOT SENT falls the same fifth as
// CHANGED, an octave under it; two octaves up and one, they land on the same
// notes, and under 2.6 kHz there is no room to keep it lower. So on a buzzer
// it falls that fifth from the top of the loud range instead, above CHANGED:
// every note as long, the same way down.

namespace detail {
constexpr Note BUZZER_LOW[] = {{4699, 120}, {3136, 220}};
}  // namespace detail

constexpr Sound BUZZER_OWN[] = {detail::sound("low", detail::BUZZER_LOW)};

/** A sound's own notes on a buzzer, where it has them. */
inline const Sound* buzzerOwn(const std::string& name) {
  for (const Sound& s : BUZZER_OWN)
    if (name == s.name) return &s;
  return nullptr;
}

/** The k-th note of `s` as a buzzer plays it: its own, or up by buzzerFactor(). */
inline Note buzzerNote(const Sound& s, size_t k) {
  if (const Sound* own = buzzerOwn(s.name)) return own->notes[k];
  return {static_cast<uint16_t>(s.notes[k].hz * buzzerFactor(s)), s.notes[k].ms};
}

/**
 * A sound's notes as one triangle wave, 8 bits unsigned at SOUND_RATE, as
 * M5.Speaker.playRaw() takes it: 128 is silence, and a rest is silence. Each
 * note starts at the middle of its wave, so it does not click in. On a
 * `buzzer`, each note is buzzerNote()'s. Writes at most `cap` samples;
 * returns how many.
 */
inline size_t render(const std::string& name, uint8_t* out, size_t cap, bool buzzer = false) {
  const Sound* s = soundFor(name);
  size_t n = 0;
  if (!s) return 0;
  for (size_t k = 0; k < s->count; ++k) {
    const Note note = buzzer ? buzzerNote(*s, k) : s->notes[k];
    const size_t samples = size_t(note.ms) * (SOUND_RATE / 1000);
    for (size_t i = 0; i < samples && n < cap; ++i) {
      if (!note.hz) {
        out[n++] = 128;
        continue;
      }
      // Where in its wave this sample is, from 0 to SOUND_RATE; a quarter in, the wave crosses the middle going up.
      const int64_t phase = static_cast<int64_t>((uint64_t(i) * note.hz + SOUND_RATE / 4) % SOUND_RATE);
      const int64_t v = phase < SOUND_RATE / 2 ? 4 * phase - SOUND_RATE : 3 * int64_t(SOUND_RATE) - 4 * phase;
      out[n++] = static_cast<uint8_t>(128 + v * 127 / int64_t(SOUND_RATE));
    }
  }
  return n;
}

/** A flash: its colour, then count × on / off ms. "card" is the card chosen, or the meeting's for found; white for none. */
struct Flash {
  const char* name;
  const char* colour;
  uint8_t count;
  uint16_t on, off;
};

constexpr Flash FLASHES[] = {
    {"set", "card", 2, 150, 100},       {"changed", "red", 3, 120, 90}, {"notsent", "orange", 2, 350, 250},
    {"warn", "orange", 2, 350, 250},    {"check", "white", 2, 150, 100},   {"wave", "hi", 3, 500, 500},
    {"found", "card", 3, 200, 150},
};

inline const Flash* flashFor(const std::string& name) {
  for (const Flash& f : FLASHES)
    if (name == f.name) return &f;
  return nullptr;
}

inline uint32_t flashMs(const Flash* f) { return f ? uint32_t(f->count) * (f->on + f->off) : 0; }

// ---------- colour ----------

struct Rgb {
  uint8_t r, g, b;
  bool operator==(const Rgb& o) const { return r == o.r && g == o.g && b == o.b; }
};

/** The canvas's hues (app/copy.js): the light colour, and the deeper one it falls to. */
struct Hue {
  const char* id;
  Rgb c;
  Rgb g;
};

constexpr Hue HUES[] = {
  {"hi", {0x4E, 0xD7, 0xF1}, {0x0C, 0x9D, 0xE2}},
  {"song", {0xF2, 0xD6, 0x5E}, {0xC7, 0x9A, 0x1E}},
  {"dance", {0xDA, 0x8C, 0xF2}, {0xA9, 0x3F, 0xD9}},
};

constexpr Rgb INK = {0x04, 0x14, 0x18};     // words on a lit face
constexpr Rgb TEXT_2 = {0x9A, 0x99, 0xA4};  // words on a dark one

// A flash's own colours (app/lib/wrist.js FLASH_COLOURS). Red is the phone's
// --stop. Orange is not its --warn, which on this screen reads as FIRST SONG's yellow.
constexpr Rgb RED = {0xFF, 0x6B, 0x6B};
constexpr Rgb ORANGE = {0xFF, 0x8A, 0x00};

/** A field that is one flat colour, or nullptr: black, white and the cards' glow are drawn another way. */
inline const Rgb* plainField(const std::string& field) {
  if (field == "red") return &RED;
  if (field == "orange") return &ORANGE;
  return nullptr;
}

inline const Hue* hueFor(const std::string& intent) {
  for (const Hue& h : HUES)
    if (intent == h.id) return &h;
  return nullptr;
}

/** The screen's own colour format: five bits of red, six of green, five of blue. */
inline uint16_t rgb565(Rgb c) {
  return static_cast<uint16_t>(((c.r & 0xF8) << 8) | ((c.g & 0xFC) << 3) | (c.b >> 3));
}

inline Rgb mix(Rgb a, Rgb b, float t) {
  auto one = [t](uint8_t x, uint8_t y) { return static_cast<uint8_t>(std::lround(x + (y - x) * t)); };
  return {one(a.r, b.r), one(a.g, b.g), one(a.b, b.b)};
}

/**
 * The canvas's radial-gradient(120% 90% at 50% 38%, c 0%, g 100%) at pixel
 * (x, y) of a w x h face: brightest a little above the middle, falling to the
 * deeper hue at the edges.
 */
inline Rgb glow(const Hue& hue, int x, int y, int w, int h) {
  const float dx = (x + 0.5f - 0.5f * w) / (1.2f * w);
  const float dy = (y + 0.5f - 0.38f * h) / (0.9f * h);
  const float t = std::sqrt(dx * dx + dy * dy);
  return mix(hue.c, hue.g, t > 1.0f ? 1.0f : t);
}

// ---------- what the relay says to show ----------

/** One `show` from the relay: relay/band.js bandShow(), as it was sent. */
struct Show {
  std::string kind = "off";  // pairing | check | waiting | test | hi | song | dance | meet | off
  std::string intent, big, small, code;
  bool dim = false;
  bool quiet = false;
  bool away = false;      // paired, but its person is not in a room
  bool hasArmed = false;  // a show about the person says what is armed, even when that is nothing
  std::string armed;      // hi | song | dance, or empty for none
  int64_t rev = 0;        // the state it was made from: a choice names it back as its basis
  bool operator==(const Show& o) const {
    return kind == o.kind && intent == o.intent && big == o.big && small == o.small && code == o.code &&
           dim == o.dim && quiet == o.quiet && away == o.away && hasArmed == o.hasArmed && armed == o.armed &&
           rev == o.rev;
  }
  bool operator!=(const Show& o) const { return !(*this == o); }
};

/** A face in one of the card colours, as the stand-in's BandFace decides it. */
inline bool lit(const Show& s) {
  return hueFor(s.intent) && (s.kind == "hi" || s.kind == "song" || s.kind == "dance" || s.kind == "meet");
}

// ---------- UTF-8 ----------

/** One code point from UTF-8 at `i`, and how many bytes it took. A bad byte is U+FFFD, one byte at a time. */
inline size_t decodeUtf8(const std::string& s, size_t i, uint32_t& cp) {
  const unsigned char c = static_cast<unsigned char>(s[i]);
  size_t n;
  uint32_t least;
  if (c < 0x80) { cp = c; return 1; }
  if ((c & 0xE0) == 0xC0) { n = 2; cp = c & 0x1F; least = 0x80; }
  else if ((c & 0xF0) == 0xE0) { n = 3; cp = c & 0x0F; least = 0x800; }
  else if ((c & 0xF8) == 0xF0) { n = 4; cp = c & 0x07; least = 0x10000; }
  else { cp = 0xFFFD; return 1; }
  if (i + n > s.size()) { cp = 0xFFFD; return 1; }
  for (size_t k = 1; k < n; ++k) {
    const unsigned char d = static_cast<unsigned char>(s[i + k]);
    if ((d & 0xC0) != 0x80) { cp = 0xFFFD; return 1; }
    cp = (cp << 6) | (d & 0x3F);
  }
  if (cp < least || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) { cp = 0xFFFD; return 1; }
  return n;
}

inline void encodeUtf8(std::string& out, uint32_t cp) {
  if (cp < 0x80) {
    out += static_cast<char>(cp);
  } else if (cp < 0x800) {
    out += static_cast<char>(0xC0 | (cp >> 6));
    out += static_cast<char>(0x80 | (cp & 0x3F));
  } else if (cp < 0x10000) {
    out += static_cast<char>(0xE0 | (cp >> 12));
    out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
    out += static_cast<char>(0x80 | (cp & 0x3F));
  } else {
    out += static_cast<char>(0xF0 | (cp >> 18));
    out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
    out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
    out += static_cast<char>(0x80 | (cp & 0x3F));
  }
}

// ---------- reading a frame ----------
//
// The relay's frames are small and flat, so this reads just enough JSON for
// them rather than carrying a library: objects, strings with every escape,
// and anything else skipped. It never reads past the text it was given, and
// nesting deeper than any frame the relay sends is refused, not recursed.

namespace json {

class Reader {
 public:
  explicit Reader(const std::string& text) : s_(text) {}

  size_t at() const { return i_; }

  void space() {
    while (i_ < s_.size() && (s_[i_] == ' ' || s_[i_] == '\t' || s_[i_] == '\n' || s_[i_] == '\r')) ++i_;
  }

  bool peek(char c) {
    space();
    return i_ < s_.size() && s_[i_] == c;
  }

  bool eat(char c) {
    if (!peek(c)) return false;
    ++i_;
    return true;
  }

  /** A string, into `out` if given, up to `cap` bytes of it kept. */
  bool string(std::string* out, size_t cap = 256) {
    if (!eat('"')) return false;
    while (i_ < s_.size()) {
      const unsigned char c = static_cast<unsigned char>(s_[i_++]);
      if (c == '"') return true;
      if (c < 0x20) return false;
      if (c != '\\') {
        if (out && out->size() < cap) *out += static_cast<char>(c);
        continue;
      }
      if (i_ >= s_.size()) return false;
      uint32_t cp;
      switch (s_[i_++]) {
        case '"': cp = '"'; break;
        case '\\': cp = '\\'; break;
        case '/': cp = '/'; break;
        case 'b': cp = 0x08; break;
        case 'f': cp = 0x0C; break;
        case 'n': cp = 0x0A; break;
        case 'r': cp = 0x0D; break;
        case 't': cp = 0x09; break;
        case 'u':
          if (!hex4(cp)) return false;
          if (cp >= 0xD800 && cp <= 0xDBFF) {
            // A high surrogate wants a low one straight after; alone, it is U+FFFD.
            const size_t back = i_;
            uint32_t lo = 0;
            if (i_ + 1 < s_.size() && s_[i_] == '\\' && s_[i_ + 1] == 'u' && (i_ += 2, hex4(lo)) && lo >= 0xDC00 &&
                lo <= 0xDFFF) {
              cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
            } else {
              i_ = back;
              cp = 0xFFFD;
            }
          } else if (cp >= 0xDC00 && cp <= 0xDFFF) {
            cp = 0xFFFD;
          }
          break;
        default:
          return false;
      }
      if (out && out->size() < cap) encodeUtf8(*out, cp);
    }
    return false;
  }

  /** null. */
  bool null() { return literal("null"); }

  /**
   * A number, read. `whole` says whether it was a whole number small enough
   * to keep, and only then is `out` set.
   */
  bool integer(int64_t& out, bool& whole) {
    space();
    const size_t from = i_;
    if (!number()) return false;
    const std::string text = s_.substr(from, i_ - from);
    whole = text.find_first_of(".eE") == std::string::npos && text.size() <= 16;
    if (whole) out = std::strtoll(text.c_str(), nullptr, 10);
    return true;
  }

  /** true or false; anything else is not a boolean. */
  bool boolean(bool& out) {
    if (literal("true")) { out = true; return true; }
    if (literal("false")) { out = false; return true; }
    return false;
  }

  /** Any value at all, read past and not kept. */
  bool skip(int depth = 0) {
    if (depth > 8) return false;
    space();
    if (i_ >= s_.size()) return false;
    const char c = s_[i_];
    if (c == '"') return string(nullptr);
    if (c == '{') return object([&](const std::string&) { return skip(depth + 1); });
    if (c == '[') {
      ++i_;
      if (eat(']')) return true;
      do {
        if (!skip(depth + 1)) return false;
      } while (eat(','));
      return eat(']');
    }
    if (c == 't' || c == 'f') { bool b; return boolean(b); }
    if (c == 'n') return literal("null");
    return number();
  }

  /** An object, calling `field(key)` for each key, which must read that key's value. */
  template <class Field>
  bool object(Field&& field) {
    if (!eat('{')) return false;
    if (eat('}')) return true;
    do {
      std::string key;
      if (!string(&key, 32) || !eat(':') || !field(key)) return false;
    } while (eat(','));
    return eat('}');
  }

 private:
  bool literal(const char* w) {
    space();
    size_t n = 0;
    while (w[n]) {
      if (i_ + n >= s_.size() || s_[i_ + n] != w[n]) return false;
      ++n;
    }
    i_ += n;
    return true;
  }

  bool hex4(uint32_t& v) {
    if (i_ + 4 > s_.size()) return false;
    v = 0;
    for (int k = 0; k < 4; ++k) {
      const char c = s_[i_++];
      v <<= 4;
      if (c >= '0' && c <= '9') v |= static_cast<uint32_t>(c - '0');
      else if (c >= 'a' && c <= 'f') v |= static_cast<uint32_t>(c - 'a' + 10);
      else if (c >= 'A' && c <= 'F') v |= static_cast<uint32_t>(c - 'A' + 10);
      else return false;
    }
    return true;
  }

  bool number() {
    const size_t from = i_;
    auto digits = [&] {
      const size_t d = i_;
      while (i_ < s_.size() && s_[i_] >= '0' && s_[i_] <= '9') ++i_;
      return i_ > d;
    };
    if (i_ < s_.size() && s_[i_] == '-') ++i_;
    if (!digits()) { i_ = from; return false; }
    if (i_ < s_.size() && s_[i_] == '.') { ++i_; if (!digits()) return false; }
    if (i_ < s_.size() && (s_[i_] == 'e' || s_[i_] == 'E')) {
      ++i_;
      if (i_ < s_.size() && (s_[i_] == '+' || s_[i_] == '-')) ++i_;
      if (!digits()) return false;
    }
    return true;
  }

  const std::string& s_;
  size_t i_ = 0;
};

}  // namespace json

/** A frame from the relay: its type, and the show, the reason, the answer or the secret it carries. */
/** Who waved at the person and waits: the newest one's handle, how many, and the newest one's number. */
struct Waves {
  std::string ref;
  int64_t n = 0;
  int64_t seq = 0;  // the relay's clock in ms when the wave was made: past 32 bits
};

/** A meeting its person and their match both said they found: its number, and its card or none. */
struct Found {
  int64_t n = 0;
  std::string intent;
};

struct Frame {
  std::string t;
  bool hasShow = false;
  Show show;
  int sound = -1;          // the show's sound switch: 1 on, 0 off, -1 not said (so not part of the Show)
  Waves waves;             // the show's waves, nobody unless said (so not part of the Show either)
  Found found;             // the show's found, none unless said (nor this)
  std::string why;
  bool hasOk = false;      // {t:'set', ok:false, why}: the relay refused a choice
  bool ok = true;
  bool hasSecret = false;  // {t:'paired', secret}: given on YES, kept in RAM only
  std::string secret;
};

/**
 * Reads one frame. A field of the wrong type is left at its default rather
 * than refusing the frame; text that is not one whole JSON object is refused.
 */
inline bool readFrame(const std::string& text, Frame& f) {
  json::Reader r(text);
  auto text_ = [&r](std::string& out, size_t cap) {
    if (!r.peek('"')) return r.skip();
    std::string v;
    if (!r.string(&v, cap)) return false;
    out = v;
    return true;
  };
  auto flag = [&r](bool& out) { return (r.peek('t') || r.peek('f')) ? r.boolean(out) : r.skip(); };
  const bool ok = r.object([&](const std::string& key) {
    if (key == "t") return text_(f.t, 32);
    if (key == "why") return text_(f.why, 64);
    if (key == "ok") {
      if (!r.peek('t') && !r.peek('f')) return r.skip();
      f.hasOk = true;
      return r.boolean(f.ok);
    }
    if (key == "secret") {
      if (!r.peek('"')) return r.skip();
      f.hasSecret = true;
      return text_(f.secret, 32);
    }
    if (key != "show") return r.skip();
    if (!r.peek('{')) return r.skip();
    f.hasShow = true;
    Show s;
    const bool read = r.object([&](const std::string& k) {
      if (k == "kind") return text_(s.kind, 16);
      if (k == "intent") return text_(s.intent, 16);
      if (k == "big") return text_(s.big, 64);
      if (k == "small") return text_(s.small, 128);
      if (k == "code") return text_(s.code, 8);
      if (k == "dim") return flag(s.dim);
      if (k == "quiet") return flag(s.quiet);
      if (k == "away") return flag(s.away);
      if (k == "armed") {
        // null says "nothing armed", which is not the same as not saying.
        if (r.peek('n')) {
          s.hasArmed = true;
          s.armed.clear();
          return r.null();
        }
        if (!r.peek('"')) return r.skip();
        s.hasArmed = true;
        return text_(s.armed, 16);
      }
      if (k == "rev") {
        int64_t v = 0;
        bool whole = false;
        if (!r.integer(v, whole)) return r.skip();
        s.rev = whole ? v : 0;
        return true;
      }
      if (k == "sound") {
        // Only true or false says it; anything else leaves the band's switch as it was.
        if (!r.peek('t') && !r.peek('f')) return r.skip();
        bool on = false;
        if (!r.boolean(on)) return false;
        f.sound = on ? 1 : 0;
        return true;
      }
      if (k == "waves") {
        if (!r.peek('{')) return r.skip();
        return r.object([&](const std::string& w) {
          if (w == "ref") {
            if (!text_(f.waves.ref, 16)) return false;
            // A handle is ten lower-case hex: anything else is no one the band can answer.
            if (f.waves.ref.size() != 10 || f.waves.ref.find_first_not_of("0123456789abcdef") != std::string::npos)
              f.waves.ref.clear();
            return true;
          }
          if (w != "n" && w != "seq") return r.skip();
          int64_t v = 0;
          bool whole = false;
          if (!r.integer(v, whole)) return r.skip();
          (w == "n" ? f.waves.n : f.waves.seq) = whole ? v : 0;
          return true;
        });
      }
      if (k == "found") {
        if (!r.peek('{')) return r.skip();
        return r.object([&](const std::string& w) {
          if (w == "intent") {
            if (!text_(f.found.intent, 16)) return false;
            if (!hueFor(f.found.intent)) f.found.intent.clear();  // a card, or none: the flash is white
            return true;
          }
          if (w != "n") return r.skip();
          int64_t v = 0;
          bool whole = false;
          if (!r.integer(v, whole)) return r.skip();
          f.found.n = whole ? v : 0;
          return true;
        });
      }
      return r.skip();
    });
    if (s.kind.empty()) s.kind = "off";
    f.show = s;
    return read;
  });
  r.space();
  return ok && r.at() == text.size();
}

// ---------- text the screen can draw ----------

namespace detail {
// U+0100..U+017F, Latin Extended-A, each folded to its base letter.
constexpr char LATIN_A[] =
    "AaAaAa" "CcCcCcCc" "DdDd" "EeEeEeEeEe" "GgGgGgGg" "HhHh" "IiIiIiIiIi" "Ii" "Jj" "Kkk" "LlLlLlLlLl"
    "NnNnNnnNn" "OoOoOo" "Oo" "RrRrRr" "SsSsSsSs" "TtTtTt" "UuUuUuUuUuUu" "Ww" "YyY" "ZzZzZz" "s";
static_assert(sizeof(LATIN_A) - 1 == 0x80, "one letter for each of U+0100..U+017F");

// U+00C0..U+00FF, the accented half of Latin-1.
constexpr const char* LATIN_1[] = {
    "A", "A", "A", "A", "A", "A", "AE", "C", "E", "E", "E", "E", "I", "I", "I", "I",
    "D", "N", "O", "O", "O", "O", "O", "x", "O", "U", "U", "U", "U", "Y", "TH", "ss",
    "a", "a", "a", "a", "a", "a", "ae", "c", "e", "e", "e", "e", "i", "i", "i", "i",
    "d", "n", "o", "o", "o", "o", "o", "/", "o", "u", "u", "u", "u", "y", "th", "y",
};
static_assert(sizeof(LATIN_1) / sizeof(LATIN_1[0]) == 0x40, "one entry for each of U+00C0..U+00FF");

inline const char* fold1(uint32_t cp) {
  if (cp >= 0xC0 && cp <= 0xFF) return LATIN_1[cp - 0xC0];
  if (cp == 0x152) return "OE";
  if (cp == 0x153) return "oe";
  switch (cp) {
    case 0x00A0: return " ";
    case 0x00B4: case 0x2018: case 0x2019: case 0x201A: case 0x201B: case 0x2032: return "'";
    case 0x00AB: case 0x00BB: case 0x201C: case 0x201D: case 0x201E: case 0x201F: case 0x2033: return "\"";
    case 0x00B7: case 0x2010: case 0x2011: case 0x2012: case 0x2013: case 0x2014: case 0x2015: case 0x2022:
    case 0x2212: return "-";
    case 0x2026: return "...";
    default: return nullptr;
  }
}
}  // namespace detail

/**
 * Text in the screen fonts' alphabet, which is ASCII: curly quotes, dashes,
 * the ellipsis and Latin accents folded to it, anything else left out, and
 * the spaces that leaves tidied. A pick in a script the fonts cannot draw
 * comes out empty, and the face shows no second line rather than boxes.
 */
inline std::string fold(const std::string& in) {
  std::string raw;
  for (size_t i = 0; i < in.size();) {
    uint32_t cp;
    i += decodeUtf8(in, i, cp);
    if (cp >= 0x20 && cp < 0x7F) raw += static_cast<char>(cp);
    else if (const char* sub = detail::fold1(cp)) raw += sub;
    else if (cp >= 0x100 && cp <= 0x17F) raw += detail::LATIN_A[cp - 0x100];
  }
  std::string out;
  for (char c : raw) {
    if (c == ' ' && (out.empty() || out.back() == ' ')) continue;
    out += c;
  }
  while (!out.empty() && out.back() == ' ') out.pop_back();
  return out;
}

inline std::string upper(std::string s) {
  for (char& c : s)
    if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 'a' + 'A');
  return s;
}

/** Greedy word wrap. A word wider than the line keeps a line to itself; the fitting below notices. */
inline std::vector<std::string> wrap(const std::string& text, int maxWidth,
                                     const std::function<int(const std::string&)>& width) {
  std::vector<std::string> lines;
  std::string line, word;
  auto place = [&] {
    if (word.empty()) return;
    const std::string next = line.empty() ? word : line + " " + word;
    if (line.empty() || width(next) <= maxWidth) line = next;
    else { lines.push_back(line); line = word; }
    word.clear();
  };
  for (char c : text) {
    if (c == ' ') place();
    else word += c;
  }
  place();
  if (!line.empty()) lines.push_back(line);
  return lines;
}

struct Fit {
  int font = 0;
  std::vector<std::string> lines;
};

/**
 * The first of `fonts` fonts, largest first, at which `text` wraps into lines
 * that each fit `maxWidth` and together stand no taller than `maxHeight`. If
 * none does, the smallest.
 */
inline Fit fit(const std::string& text, int fonts, int maxWidth, int maxHeight,
               const std::function<int(int, const std::string&)>& width, const std::function<int(int)>& lineHeight) {
  Fit f;
  for (int i = 0; i < fonts; ++i) {
    f.font = i;
    f.lines = wrap(text, maxWidth, [&](const std::string& s) { return width(i, s); });
    bool fits = static_cast<int>(f.lines.size()) * lineHeight(i) <= maxHeight;
    for (const std::string& l : f.lines) fits = fits && width(i, l) <= maxWidth;
    if (fits) break;
  }
  return f;
}

// ---------- the face ----------

enum class Signal { LIVE, NO_WIFI, NO_RELAY };

/** What the screen shows: the relay's show, unless the wrist or the signal overrules it. */
struct Face {
  Show show;
  bool offline = false;
};

/**
 * NOT NOW from the wrist is dark at once, before the relay has heard it. And
 * a relay out of reach for long enough is not believed: the person may have
 * gone invisible from their phone since, and a wrist left showing blue would
 * say otherwise.
 */
inline Face faceFor(const Show* last, bool stale, bool quietDark) {
  Face f;
  f.offline = stale;
  if (quietDark) { f.show.quiet = true; return f; }
  if (stale) return f;
  if (last) f.show = *last;
  return f;
}

struct Words {
  std::string big, small;
};

/** The words on the face, already in the screen's alphabet. */
inline Words wordsFor(const Face& f, bool awake, int battery, Signal signal) {
  const Show& s = f.show;
  const std::string pct = battery >= 0 ? std::to_string(battery) + "%" : "";
  if (s.kind == "pairing") return {s.code, ""};
  if (s.kind == "check") return {s.big, "ON YOUR PHONE?"};
  if (s.kind == "waiting") return {"OPEN YOUR PHONE", "OR SWITCH ME OFF"};
  // Woken, the meeting face says what a SIDE hold does there.
  if (lit(s))
    return {fold(s.big), s.kind == "meet" && awake && s.small == "MEET" ? "HOLD SIDE: FOUND" : upper(fold(s.small))};
  if (s.kind != "off" || !awake) return {};
  if (f.offline) {
    const std::string why = signal == Signal::NO_WIFI ? "NO WI-FI" : "NO RELAY";
    return {"NO SIGNAL", pct.empty() ? why : why + " - " + pct};
  }
  if (s.quiet) return {"NOT NOW", pct};
  if (s.away) return {"OPEN YOUR PHONE", "TO COME BACK"};
  return {"READY", pct};
}

/** How bright the backlight is: black is off, not a black picture lit from behind. */
inline uint8_t lightFor(const Face& f, bool awake) {
  const Show& s = f.show;
  if (s.kind == "test") return LIGHT_FULL;
  if (lit(s)) return s.dim ? LIGHT_DIM : LIGHT_FULL;
  if (s.kind == "pairing" || s.kind == "check") return LIGHT_PAIR;
  return s.kind == "waiting" || awake ? LIGHT_AWAKE : LIGHT_OFF;
}

// ---------- the pairing code ----------

/** The address a pairing code opens, exactly as app/lib/pairing.js pairUrl() makes it. */
inline std::string pairUrl(std::string origin, const std::string& code) {
  while (!origin.empty() && origin.back() == '/') origin.pop_back();
  return origin + "/pair/" + code;
}

/**
 * The smallest QR version that holds `bytes` in byte mode at error correction
 * L, which is what the screen library draws; 0 past version 10.
 */
inline int qrVersion(size_t bytes) {
  static const size_t HOLDS[] = {17, 32, 53, 78, 106, 134, 154, 192, 230, 271};
  for (int v = 0; v < 10; ++v)
    if (bytes <= HOLDS[v]) return v + 1;
  return 0;
}

inline int qrSize(int version) { return 17 + 4 * version; }

/** Pixels per module in a square `side` wide with four light modules all round it; 0 if it will not fit. */
inline int qrModule(int version, int side) { return version ? side / (qrSize(version) + 8) : 0; }

// ---------- the line to the relay ----------

/**
 * When to ask, when silence means the socket is dead (a socket can die
 * without ever closing), and when what the relay last said is too old to show.
 */
class Link {
 public:
  enum Act { WAIT, PING, DROP };

  void opened(uint32_t now) {
    up_ = true;
    ever_ = true;
    heard_ = asked_ = now;
  }
  void heard(uint32_t now) { heard_ = now; }
  void closed(uint32_t now) {
    if (up_) lost_ = now;
    up_ = false;
  }

  Act tick(uint32_t now) {
    if (!up_) return WAIT;
    if (now - heard_ > DEAF_MS) return DROP;
    if (now - asked_ >= PING_EVERY_MS) {
      asked_ = now;
      return PING;
    }
    return WAIT;
  }

  bool up() const { return up_; }
  /** Out of reach for STALE_MS, or never reached at all. */
  bool stale(uint32_t now) const { return !up_ && (!ever_ || now - lost_ >= STALE_MS); }

 private:
  bool up_ = false;
  bool ever_ = false;
  uint32_t heard_ = 0, asked_ = 0, lost_ = 0;
};

/**
 * NOT NOW from the wrist. The face goes dark at once; the hold is sent as soon
 * as there is a relay to send it to — again, if the socket drops before the
 * relay answers — and the face stays dark until the relay shows something
 * that is not a card, or QUIET_CONFIRM_MS passes. A card the relay was
 * already sending when the hold went out is not shown.
 */
class Quiet {
 public:
  void held() {
    pending_ = true;
    sent_ = false;
  }
  bool due(bool up) const { return pending_ && !sent_ && up; }
  void sent(uint32_t now) {
    sent_ = true;
    at_ = now;
  }
  void closed() { sent_ = false; }
  void shown(const Show& s) {
    if (pending_ && sent_ && !lit(s)) pending_ = false;
  }
  void tick(uint32_t now) {
    if (pending_ && sent_ && now - at_ >= QUIET_CONFIRM_MS) pending_ = false;
  }
  bool dark() const { return pending_; }

 private:
  bool pending_ = false;
  bool sent_ = false;
  uint32_t at_ = 0;
};

/**
 * When the battery is worth telling the relay about. A reading on a battery
 * wanders a point either way, and the relay dims the light at 15%, so a
 * one-point change waits BATTERY_DRIFT_MS; two points go at the next chance.
 */
class BatteryReport {
 public:
  bool due(int level, uint32_t now) const {
    if (level < 0) return false;
    if (last_ < 0) return true;
    if (level == last_ || now - at_ < BATTERY_EVERY_MS) return false;
    return std::abs(level - last_) >= 2 || now - at_ >= BATTERY_DRIFT_MS;
  }
  void sent(int level, uint32_t now) {
    last_ = level;
    at_ = now;
  }
  void reset() { last_ = -1; }

 private:
  int last_ = -1;
  uint32_t at_ = 0;
};

/**
 * When to ask the radio to join the Wi-Fi again. The core's own reconnect is
 * not enough: a StickS3 that booted while its hotspot was off never joined it
 * once it came on, and one WiFi.begin() then joined in 12 s (25 Sep 2026).
 * So while a network is set and not joined, the loop begins again every
 * REJOIN_MS, counted from the last time it was joined or begun.
 */
class Rejoin {
 public:
  /** `set`: a network name is saved; `joined`: the radio is on it. True when it is time to begin again. */
  bool due(bool set, bool joined, uint32_t now) {
    if (!set || joined) {
      since_ = now;
      return false;
    }
    if (now - since_ < REJOIN_MS) return false;
    since_ = now;
    return true;
  }
  /** WiFi.begin() was just called for another reason: the wait starts again. */
  void began(uint32_t now) { since_ = now; }

 private:
  uint32_t since_ = 0;
};

// ---------- where the relay is ----------

struct Relay {
  bool ok = false;
  bool secure = true;
  std::string host;
  uint16_t port = 0;
  std::string origin;  // the app's address, which the pairing code opens
};

inline std::string trim(const std::string& s) {
  const size_t a = s.find_first_not_of(" \t\r\n");
  if (a == std::string::npos) return "";
  return s.substr(a, s.find_last_not_of(" \t\r\n") - a + 1);
}

/**
 * The relay from what someone typed: wss://host, https://host (the address
 * `npm run tunnel` prints), ws://host:port or http://host:port on a LAN, or a
 * bare host, taken as wss. Any path is dropped — the socket is always at
 * /api/ws, as the app's own is.
 */
inline Relay parseRelay(const std::string& typed) {
  Relay r;
  std::string s = trim(typed);
  for (char& c : s)
    if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
  size_t at = 0;
  auto scheme = [&](const char* p, bool secure) {
    const std::string pre(p);
    if (s.compare(0, pre.size(), pre) != 0) return false;
    at = pre.size();
    r.secure = secure;
    return true;
  };
  if (!scheme("wss://", true) && !scheme("https://", true) && !scheme("ws://", false) && !scheme("http://", false)) {
    if (s.find("://") != std::string::npos) return r;
    r.secure = true;
  }
  const size_t end = s.find_first_of("/?#", at);
  const std::string authority = s.substr(at, end == std::string::npos ? std::string::npos : end - at);
  if (authority.empty() || authority.find('@') != std::string::npos) return r;
  std::string host = authority;
  long port = r.secure ? 443 : 80;
  const size_t colon = authority.rfind(':');
  if (colon != std::string::npos) {
    host = authority.substr(0, colon);
    const std::string p = authority.substr(colon + 1);
    if (p.empty() || p.size() > 5 || p.find_first_not_of("0123456789") != std::string::npos) return r;
    port = std::strtol(p.c_str(), nullptr, 10);
    if (port < 1 || port > 65535) return r;
  }
  if (host.empty() || host.size() > 253 || host.front() == '.' || host.front() == '-') return r;
  if (host.find_first_not_of("abcdefghijklmnopqrstuvwxyz0123456789.-") != std::string::npos) return r;
  r.host = host;
  r.port = static_cast<uint16_t>(port);
  r.ok = true;
  const bool usual = port == (r.secure ? 443 : 80);
  r.origin = std::string(r.secure ? "https://" : "http://") + host + (usual ? "" : ":" + std::to_string(port));
  return r;
}

// ---------- what it says ----------

/** The relay's own test for an id (relay/server.js): lower-case hex, 16 to 64 of it. */
inline bool validId(const std::string& id) {
  if (id.size() < 16 || id.size() > 64) return false;
  return id.find_first_not_of("0123456789abcdef") == std::string::npos;
}

// ---------- who it is ----------
//
// A key made at every boot and kept only in RAM, and an id that is its hash.
// The relay recomputes the id from the key in every hello, so knowing an id —
// every phone that ever paired it was told it — is not enough to speak as it.
// Switching it off and on makes it a new wristband.

namespace detail {
constexpr uint32_t SHA_K[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};
inline uint32_t rotr(uint32_t x, int n) { return (x >> n) | (x << (32 - n)); }
}  // namespace detail

/** SHA-256 of `n` bytes, as 64 lower-case hex digits. */
inline std::string sha256Hex(const uint8_t* data, size_t n) {
  uint32_t h[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  std::vector<uint8_t> m;
  if (n) m.assign(data, data + n);
  m.push_back(0x80);
  while (m.size() % 64 != 56) m.push_back(0);
  const uint64_t bits = static_cast<uint64_t>(n) * 8;
  for (int i = 7; i >= 0; --i) m.push_back(static_cast<uint8_t>(bits >> (8 * i)));
  for (size_t off = 0; off < m.size(); off += 64) {
    uint32_t w[64];
    for (int i = 0; i < 16; ++i)
      w[i] = (static_cast<uint32_t>(m[off + 4 * i]) << 24) | (static_cast<uint32_t>(m[off + 4 * i + 1]) << 16) |
             (static_cast<uint32_t>(m[off + 4 * i + 2]) << 8) | static_cast<uint32_t>(m[off + 4 * i + 3]);
    for (int i = 16; i < 64; ++i) {
      const uint32_t s0 = detail::rotr(w[i - 15], 7) ^ detail::rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
      const uint32_t s1 = detail::rotr(w[i - 2], 17) ^ detail::rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    uint32_t a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
    for (int i = 0; i < 64; ++i) {
      const uint32_t t1 = k + (detail::rotr(e, 6) ^ detail::rotr(e, 11) ^ detail::rotr(e, 25)) + ((e & f) ^ (~e & g)) +
                          detail::SHA_K[i] + w[i];
      const uint32_t t2 = (detail::rotr(a, 2) ^ detail::rotr(a, 13) ^ detail::rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
      k = g;
      g = f;
      f = e;
      e = d + t1;
      d = c;
      c = b;
      b = a;
      a = t1 + t2;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += k;
  }
  static const char DIGITS[] = "0123456789abcdef";
  std::string out;
  for (uint32_t x : h)
    for (int s = 28; s >= 0; s -= 4) out += DIGITS[(x >> s) & 0xF];
  return out;
}

/** Lower-case hex to bytes, two digits a byte; anything else, and nothing comes back. */
inline std::vector<uint8_t> hexBytes(const std::string& hex) {
  auto nibble = [](char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1; };
  std::vector<uint8_t> out;
  if (hex.size() % 2) return out;
  for (size_t i = 0; i < hex.size(); i += 2) {
    const int hi = nibble(hex[i]), lo = nibble(hex[i + 1]);
    if (hi < 0 || lo < 0) return {};
    out.push_back(static_cast<uint8_t>((hi << 4) | lo));
  }
  return out;
}

/** A band key: 128 random bits as 32 hex, made at every boot and kept only in RAM. Never the chip's MAC. */
inline std::string makeKey(const std::function<uint32_t()>& random32) {
  static const char DIGITS[] = "0123456789abcdef";
  std::string key;
  for (int w = 0; w < 4; ++w) {
    const uint32_t v = random32();
    for (int k = 28; k >= 0; k -= 4) key += DIGITS[(v >> k) & 0xF];
  }
  return key;
}

/** A wristband's id: the first 32 hex of SHA-256 over its key's 16 bytes, as the relay recomputes it. */
inline std::string idFor(const std::string& keyHex) {
  const std::vector<uint8_t> bytes = hexBytes(keyHex);
  const uint8_t none[1] = {0};
  return sha256Hex(bytes.empty() ? none : bytes.data(), bytes.size()).substr(0, 32);
}

// ---------- near: what a band hears of the others ----------
//
// While it is on the relay, paired and not in NOT NOW, a band beacons four
// bytes over ESP-NOW under an address new at every boot, and now and then
// listens for the others' beacons. What it heard goes to the relay, which
// alone decides who is near (relay/room.js): the band shows none of it, and
// no phone is ever sent a number. main.cpp holds the radio; this holds what
// a listen keeps and the report it becomes.

constexpr uint32_t BEACON_MS = 500;        // a beacon this often
constexpr uint32_t LISTEN_MS = 1000;       // a listen lasts this long...
constexpr uint32_t HEAR_EVERY_MS = 10000;  // ...once in this long, and is reported as soon as it ends
constexpr size_t HEARD_MAX = 12;           // a report names the strongest this many bands
constexpr size_t FRAME_MAX = 320;          // the longest frame a band sends, its ending 0 counted: a full report is 294
constexpr uint8_t BEACON[4] = {'O', 'T', 'B', '1'};  // all a beacon says; the address it comes from says whose

/** Six address bytes as twelve lower-case hex digits, as the hello's air and a report write them. */
inline std::string airHex(const uint8_t* mac) {
  static const char DIGITS[] = "0123456789abcdef";
  std::string s;
  for (int i = 0; i < 6; ++i) {
    s += DIGITS[mac[i] >> 4];
    s += DIGITS[mac[i] & 0xF];
  }
  return s;
}

/** This boot's address on the air, from the band's own noise: locally administered and unicast, so never the chip's. */
inline void makeAir(uint8_t* out, const std::function<uint32_t()>& random32) {
  const uint32_t a = random32(), b = random32();
  out[0] = static_cast<uint8_t>((a & 0xFC) | 0x02);
  out[1] = static_cast<uint8_t>(a >> 8);
  out[2] = static_cast<uint8_t>(a >> 16);
  out[3] = static_cast<uint8_t>(a >> 24);
  out[4] = static_cast<uint8_t>(b);
  out[5] = static_cast<uint8_t>(b >> 8);
}

/** One listen: each band heard, at the strongest of its beacons, and only the strongest HEARD_MAX bands. */
class Hearing {
 public:
  struct Heard {
    uint8_t mac[6];
    int rssi;
  };

  /** A beacon from `mac` at `rssi` dBm, brought into -100..0, the range the relay takes. */
  void heard(const uint8_t* mac, int rssi) {
    rssi = rssi < -100 ? -100 : rssi > 0 ? 0 : rssi;
    for (Heard& h : heard_) {
      if (std::equal(h.mac, h.mac + 6, mac)) {
        if (rssi > h.rssi) h.rssi = rssi;
        return;
      }
    }
    Heard h;
    std::copy(mac, mac + 6, h.mac);
    h.rssi = rssi;
    if (heard_.size() < HEARD_MAX) {
      heard_.push_back(h);
      return;
    }
    // Full: a stronger band takes the place of the weakest.
    auto weakest = std::min_element(heard_.begin(), heard_.end(), [](const Heard& x, const Heard& y) { return x.rssi < y.rssi; });
    if (rssi > weakest->rssi) *weakest = h;
  }

  size_t size() const { return heard_.size(); }
  void clear() { heard_.clear(); }

  /** Everyone heard, the strongest first. */
  std::vector<Heard> strongest() const {
    std::vector<Heard> s = heard_;
    std::stable_sort(s.begin(), s.end(), [](const Heard& x, const Heard& y) { return x.rssi > y.rssi; });
    return s;
  }

  /** The report the relay reads: {"t":"heard","ch":6,"near":[["02abcdef0123",-48],...]}. Heard nobody, near is []. */
  std::string frame(int ch) const {
    std::string f = "{\"t\":\"heard\",\"ch\":" + std::to_string(ch) + ",\"near\":[";
    bool first = true;
    for (const Heard& h : strongest()) {
      f += std::string(first ? "" : ",") + "[\"" + airHex(h.mac) + "\"," + std::to_string(h.rssi) + "]";
      first = false;
    }
    return f + "]}";
  }

 private:
  std::vector<Heard> heard_;
};

/**
 * The first thing a wristband says on every connection: who it is, the key
 * that proves it, the protocol, and — when it has them — the secret its
 * pairing gave it, a NOT NOW still waiting to be sent, its battery, and the
 * address it beacons under this boot.
 */
inline std::string helloFrame(const std::string& id, const std::string& key, int battery,
                              const std::string& secret = "", bool quiet = false, const std::string& air = "") {
  std::string f = "{\"t\":\"wristband\",\"id\":\"" + id + "\",\"key\":\"" + key + "\",\"v\":2";
  if (!secret.empty()) f += ",\"secret\":\"" + secret + "\"";
  if (quiet) f += ",\"quiet\":true";
  if (battery >= 0) f += ",\"battery\":" + std::to_string(battery);
  if (!air.empty()) f += ",\"air\":\"" + air + "\"";
  return f + "}";
}

inline std::string batteryFrame(int level) { return "{\"t\":\"battery\",\"level\":" + std::to_string(level) + "}"; }

constexpr const char* HOLD_FRAME = "{\"t\":\"hold\"}";
constexpr const char* PING_FRAME = "{\"t\":\"ping\"}";

// ---------- the wrist: both buttons, the chooser, and the line to the relay ----------
//
// The same machine as app/lib/wrist.js, line for line, and held to the same
// table of cases (tests/fixtures/wrist-cases.json). It takes key downs and
// ups, the link coming and going, the relay's frames and the time, and gives
// back the frames to send and the screen to draw. main.cpp only feeds it.

/** The words each card shows, as relay/band.js bandShow() sends them. A preview draws these. */
inline const char* cardWords(const std::string& intent) {
  if (intent == "hi") return "HI :)";
  if (intent == "song") return "FIRST SONG?";
  if (intent == "dance") return "LET'S DANCE!";
  return "";
}

/** What the screen shows: two lines on one field, the backlight, the KEEP HOLDING bar, and letters to draw with their QR. */
struct Screen {
  std::string big, small;
  std::string field = "black";  // black | white | hi | song | dance | red | orange
  std::string ink = "text2";    // ink | text2 | white | hi | song | dance
  uint8_t light = LIGHT_OFF;
  int bar = -1;                 // 0..99 while KEY1 is held past BAR_MS; -1 otherwise
  std::string code;             // the pairing letters
};

class Wrist {
 public:
  explicit Wrist(const std::string& key) : key_(key), id_(idFor(key)) {}

  const std::string& id() const { return id_; }
  const std::string& secret() const { return secret_; }
  bool up() const { return link_.up(); }

  /** This boot's address on the air: the hello says it, so the relay knows whose beacons they are. */
  void setAir(const std::string& air) { air_ = air; }
  /** Whether to beacon and listen: on the relay, paired, and not in NOT NOW. */
  bool nearOn() const { return link_.up() && !secret_.empty() && current() != "notnow"; }

  /** A battery reading. Low at 15% or below, again only after 20%; very low at 5% or below, again only after 10%. */
  void setBattery(int level, uint32_t now) {
    advance(now);
    battery_ = level >= 0 && level <= 100 ? level : -1;
    // Past both at once is still one warning: a moment plays one.
    if (battery_ >= 0) {
      if (battery_ <= 15 && armedLow_) {
        armedLow_ = false;
        warn(BATTERY);
      } else if (battery_ >= 20) {
        armedLow_ = true;
      }
      if (battery_ <= 5 && armedEmpty_) {
        armedEmpty_ = false;
        warn(BATTERY);
      } else if (battery_ >= 10) {
        armedEmpty_ = true;
      }
    }
    settle(now);
  }
  void setWifi(bool on) { wifi_ = on; }
  /** The relay answered a ping, or anything else was heard. */
  void heard(uint32_t now) { link_.heard(now); }

  /** Everything to send since the last take: frame text, or "DROP" to drop the socket. */
  std::vector<std::string> take() {
    std::vector<std::string> o;
    o.swap(out_);
    return o;
  }

  /** The names of the sounds due to start since the last ask: the player plays the newest. */
  std::vector<std::string> sounds() {
    std::vector<std::string> d;
    d.swap(due_);
    return d;
  }

  void keyDown(int k, uint32_t now) {
    advance(now);
    Key& s = k == 1 ? k1_ : k2_;
    if (s.down) return;
    s.down = true;
    s.since = now;
    s.fired = false;
    // Any KEY1 press-down freezes a choice at once: no commit can fire.
    if (k == 1 && (mode_ == LOOK || mode_ == CHOOSING)) frozen_ = true;
    // During a wave's flashes a key only ticks: a meeting calling underneath is answered after them.
    const bool whole = waveFlashing(now);
    // The key that answers a call only answers: letting it go, or holding it, does nothing more.
    if (blinking(now) && !whole) {
      calling_ = false;
      s.fired = true;
    } else if (pairingFace(now)) {
      // On the letters or the check a key says where to go, and lights the letters again; nothing more.
      s.fired = true;
      hintUntil_ = now + HINT_MS;
      if (show_.kind == "pairing") litUntil_ = now + PAIR_AWAKE_MS;
    }
    // Every press is heard as it goes down; NOT NOW is silent. A tick does not end a wave's flashes.
    if (!silent_) {
      if (!whole) react("tick");
      else if (soundOn_) due_.push_back("tick");
    }
    settle(now);
  }

  void keyUp(int k, uint32_t now) {
    advance(now);
    Key& s = k == 1 ? k1_ : k2_;
    if (!s.down) return;
    s.down = false;
    if (!s.fired && !waveFlashing(now)) {
      if (mode_ == WAVES) {
        rest();  // in the wave face a press of either key closes it; SIDE never starts the chooser there
      } else if (k == 2) {
        step(now);
      } else if (opensWaves()) {
        mode_ = WAVES;
        stepAt_ = now;
      } else {
        if (frozen_) rest();
        wake(now);
      }
    }
    settle(now);
  }

  void linkUp(uint32_t now) {
    advance(now);
    if (link_.stale(now)) haveShow_ = false;
    link_.opened(now);
    warnedReach_ = false;  // it has the relay again
    // A hold not yet heard rides on the hello: the relay applies it before anything else.
    const bool quiet = quiet_.dark();
    if (quiet) quiet_.sent(now);
    out_.push_back(helloFrame(id_, key_, battery_, secret_, quiet, air_));
    settle(now);
  }

  void linkDown(uint32_t now) {
    advance(now);
    closed(now);
    settle(now);
  }

  void frame(const std::string& text, uint32_t now) {
    advance(now);
    heardFrame(text, now);
    settle(now);
  }

  void tick(uint32_t now) {
    advance(now);
    ticked(now);
    settle(now);
  }

 private:
  void heardFrame(const std::string& text, uint32_t now) {
    link_.heard(now);
    Frame f;
    if (!readFrame(text, f)) return;
    if (f.t == "paired" && f.hasSecret) {
      secret_ = f.secret;
      return;
    }
    if (f.t == "set" && f.hasOk && !f.ok) {
      if (mode_ == SENDING) result(now, f.why == "changed" ? "CHANGED" : "NOT SENT");
      return;
    }
    // The relay's answer to a wave back. Landed: the face rests, and the meeting, if it made one, comes as a show.
    if (f.t == "wave" && f.hasOk) {
      if (mode_ == WAVEBACK) {
        if (f.ok) rest();
        else result(now, f.why == "changed" ? "CHANGED" : "NOT SENT");
      }
      return;
    }
    // The relay's answer to a found. Taken: the face rests, and FOUND: WAITING, or the found itself, comes as a show.
    if (f.t == "found" && f.hasOk) {
      if (mode_ == FOUND) {
        if (f.ok) rest();
        else result(now, "NOT SENT");
      }
      return;
    }
    if (f.t != "show" || !f.hasShow) return;
    // Reactions come from changes; a show that differs only in its sound switch is no change.
    const bool same = haveShow_ && show_ == f.show;
    const bool wasCheck = haveShow_ && show_.kind == "check";
    const bool wasSilent = silent_;
    show_ = f.show;
    haveShow_ = true;
    waves_ = f.waves;
    // A show's own switch counts for what it causes.
    if (f.sound >= 0) soundOn_ = f.sound == 1;
    if (show_.kind == "pairing") {
      // Unpaired, or nobody came for it: the band is nobody's, so NOT NOW is over and no meeting is anyone's.
      const bool wasPaired = !secret_.empty();
      secret_.clear();
      silent_ = false;
      called_.clear();
      calling_ = false;
      waveSeq_ = 0;
      waveOwed_ = false;
      if (wasCheck) react("fall", nullptr, 1);    // the check ended without YES
      if (wasPaired) playWarn();                  // unpaired; the letters end any choice, so at once
      soundOn_ = true;                            // after the letters' own reactions
      // New letters light for PAIR_AWAKE_MS; the same letters again (a reconnect) do not.
      if (show_.code != pairCode_) {
        pairCode_ = show_.code;
        litUntil_ = now + PAIR_AWAKE_MS;
      }
    } else {
      pairCode_.clear();
    }
    // The waiting face lights when waiting starts. Losing the relay does not end it; any other show does.
    if (show_.kind != "waiting") {
      waiting_ = false;
      warnedWait_ = false;
    } else if (!waiting_) {
      waiting_ = true;
      waitAt_ = now;
      litUntil_ = now + PAIR_AWAKE_MS;
    }
    quiet_.shown(show_);
    // NOT NOW's silence starts and ends only with a show about the person (rule 1).
    if (personal()) {
      if (show_.quiet) silent_ = true;
      else if (!quiet_.dark()) silent_ = false;
      // A show about the person that is not a meeting ends a call and forgets its number.
      if (show_.kind != "meet") {
        called_.clear();
        calling_ = false;
      }
    }
    if (mode_ == LOOK || mode_ == CHOOSING) {
      // A show not about the person, or one whose rev moved, cancels the choice.
      if (!personal() || show_.rev != basis_) rest();
    } else if (mode_ == SENDING && personal() && show_.rev > basis_ && show_.armed == choice_ && !show_.quiet) {
      result(now, "SET");
    } else if (mode_ == WAVES && !waiting()) {
      rest();  // the wave face follows the shows: nobody left waiting, off SAY HI, or not about the person
    }
    // Away starts at an away show and ends at one that is not; the same again after a reconnect is no change.
    if (!show_.away) {
      warnedAway_ = false;
    } else if (!warnedAway_) {
      warnedAway_ = true;
      warn(AWAY);
    }
    // NOT NOW is over: what came up in it plays once, after this moment's own reactions (rule 1).
    if (wasSilent && !silent_) payOwed();
    // A wave newer than any called for calls; either way the number moves up (waves §3).
    const bool newer = waves_.seq > waveSeq_;
    if (newer) waveSeq_ = waves_.seq;
    if (silent_) return;
    // A show that differs only in its sound or its waves is no change.
    if (!same) {
      if (show_.kind == "check") {
        react("ask", "check", 1);
      } else if (show_.kind == "test") {
        react("up", nullptr, 1);  // paired, or TEST THE LIGHT: the white face is its flash
      } else if (show_.kind == "meet" && show_.big != called_) {
        // A number not yet called for calls until it is answered (rule 4).
        react("jingle", nullptr, 1);
        called_ = show_.big;
        calling_ = true;
        callAt_ = now;
      }
    }
    // Found by both (found §2): a number not yet played for plays once, in the meeting's card. A show about the
    // person that names none is past FOUND_SHOW_MS, and the same number may then play for another meeting.
    if (f.found.n && f.found.n != foundPlayed_) {
      foundPlayed_ = f.found.n;
      react("found", "found", 1, f.found.intent);
    } else if (!f.found.n && personal()) {
      foundPlayed_ = 0;
    }
    // After a meeting's jingle. A wave call already under way takes the new wave in; the open wave face counts it.
    if (newer && !waveCalling() && mode_ != WAVES) callWave();
  }

  void ticked(uint32_t now) {
    if (calling_ && link_.stale(now)) calling_ = false;  // a show no longer believed calls no more
    // Out of reach: a paired band, STALE_MS without the relay. Waiting: STALE_MS after it began.
    if (!secret_.empty() && link_.stale(now) && !warnedReach_) {
      warnedReach_ = true;
      warn(REACH);
    }
    if (waiting_ && now - waitAt_ >= STALE_MS && !warnedWait_) {
      warnedWait_ = true;
      warn(WAIT);
    }
    switch (link_.tick(now)) {
      case Link::DROP:
        out_.push_back("DROP");
        closed(now);
        break;
      case Link::PING:
        out_.push_back(PING_FRAME);
        break;
      default:
        break;
    }
    if (k1_.down && !k1_.fired && now - k1_.since >= HOLD_MS) {
      k1_.fired = true;
      hold(now);
    }
    // A SIDE hold that comes due during a wave's flashes does nothing else.
    if (k2_.down && !k2_.fired && now - k2_.since >= HOLD_MS) {
      k2_.fired = true;
      if (!waveFlashing(now)) sideHeld(now);
    }
    if (quiet_.due(link_.up())) {
      out_.push_back(HOLD_FRAME);
      quiet_.sent(now);
    }
    quiet_.tick(now);
    if ((mode_ == LOOK || mode_ == WAVES) && now - stepAt_ >= CHOOSE_MS) {
      rest();
    } else if (mode_ == CHOOSING && !frozen_) {
      if (!fromQuiet_ && now - stepAt_ >= COMMIT_MS) commit(now);
      else if (fromQuiet_ && now - stepAt_ >= CHOOSE_MS) rest();
    } else if (mode_ == SENDING && now - sentAt_ >= CONFIRM_MS) {
      result(now, "NOT SENT");
      // Drop the socket: a set stuck in it can no longer land, and the next hello's show is the truth.
      if (link_.up()) {
        out_.push_back("DROP");
        closed(now);
      }
      // Hiding may arrive late; showing may not. Leaving NOT NOW failed, so hold it again.
      if (fromQuiet_) quiet_.held();
    } else if ((mode_ == WAVEBACK || mode_ == FOUND) && now - sentAt_ >= CONFIRM_MS) {
      // As for a choice: NOT SENT, and the socket dropped, so a wave or a found stuck in it can no longer land.
      result(now, "NOT SENT");
      if (link_.up()) {
        out_.push_back("DROP");
        closed(now);
      }
    } else if (mode_ == RESULT && static_cast<int32_t>(now - resultUntil_) >= 0) {
      rest();
    }
  }

 public:
  Screen face(uint32_t now) const {
    Screen f;
    if (mode_ == LOOK) {
      const std::string cur = current();
      if (!link_.up()) f = noSignal();
      else if (cur == "notnow") f = words("NOT NOW", "SIDE TO CHANGE", "black", "text2", LIGHT_AWAKE);
      else if (cur == "off") f = words("READY", "SIDE TO CHANGE", "black", "text2", LIGHT_AWAKE);
      else f = words(cardWords(cur), "SIDE TO CHANGE", cur, "ink", LIGHT_FULL);
    } else if (mode_ == CHOOSING || mode_ == SENDING) {
      const char* small = mode_ == SENDING ? "SENDING" : fromQuiet_ ? "HOLD SIDE TO SHOW" : "SIDE: NEXT";
      f = preview_ == "off" ? words("OFF", small, "black", "text2", LIGHT_AWAKE)
                            : words(cardWords(preview_), small, "black", preview_, LIGHT_AWAKE);
    } else if (mode_ == WAVES) {
      // As the chooser shows HI, in its own words: that someone waved, and how many wait. Never who.
      const std::string count = waves_.n > 9 ? "9+" : std::to_string(waves_.n);
      f = words("SOMEONE WAVED", waves_.n > 1 ? count + " WAITING - HOLD SIDE" : "HOLD SIDE: WAVE BACK", "black", "hi",
                LIGHT_AWAKE);
    } else if (mode_ == WAVEBACK) {
      f = words("WAVE BACK", "SENDING", "black", "hi", LIGHT_AWAKE);
    } else if (mode_ == FOUND) {
      f = restFace(now, true);  // the meeting face, while its found is on the way
      f.small = "SENDING";
    } else {
      f = restFace(now, static_cast<int32_t>(wakeUntil_ - now) > 0 || mode_ == RESULT);
      if (mode_ == RESULT) f.small = word_;
    }
    if (k1_.down && !k1_.fired && now - k1_.since >= BAR_MS) {
      f.small = "KEEP HOLDING";
      f.bar = std::min<int>(99, static_cast<int>((now - k1_.since) * 100 / HOLD_MS));
      if (f.light < LIGHT_AWAKE) f.light = LIGHT_AWAKE;
    }
    // A call blinks: the meeting face as it is, then off. A flash, while it lasts, is drawn over it.
    if (blinking(now) && (now - callAt_) % (2 * BLINK_MS) >= BLINK_MS) f.light = LIGHT_OFF;
    return flashOver(f, now);
  }

 private:
  /** A flash, step by step: on is its colour at full light and nothing else; off is the backlight off. */
  Screen flashOver(Screen f, uint32_t now) const {
    if (!playingOn_ || !playing_.flash) return f;
    const Flash& fl = *playing_.flash;
    const uint32_t t = now - playing_.at;
    if (static_cast<int32_t>(t) < 0 || t >= flashMs(&fl)) return f;
    if (t % (uint32_t(fl.on) + fl.off) < fl.on) {
      Screen on;
      on.field = playing_.colour;
      on.ink = "ink";
      on.light = LIGHT_FULL;
      return on;
    }
    f.light = LIGHT_OFF;
    return f;
  }

 private:
  enum Mode { REST, LOOK, CHOOSING, SENDING, RESULT, WAVES, WAVEBACK, FOUND };
  struct Key {
    bool down = false;
    bool fired = false;
    uint32_t since = 0;
  };
  /** One reaction. cls: 0 a key or a result, 1 a call, 2 a warning. `whole`: a wave's flashes, which no key ends. */
  struct Reaction {
    const char* sound = nullptr;
    const Flash* flash = nullptr;
    std::string colour;
    int cls = 0;
    bool audible = true;
    bool whole = false;
    uint32_t at = 0, until = 0;
  };

  /** A reaction of this moment. `card`: the colour a "set" or "found" flash takes. */
  void react(const char* sound, const char* flash = nullptr, int cls = 0, const std::string& card = "") {
    Reaction r;
    r.sound = sound;
    r.flash = flash ? flashFor(flash) : nullptr;
    if (r.flash) r.colour = std::string(r.flash->colour) == "card" ? (card.empty() ? "white" : card) : r.flash->colour;
    r.cls = cls;
    r.audible = soundOn_;
    r.whole = flash && std::string(flash) == "wave";
    moment_.push_back(r);
  }

  /** A wave's flashes are on the face: a key only ticks (waves decision 6). */
  bool waveFlashing(uint32_t now) const {
    return playingOn_ && playing_.whole && static_cast<int32_t>(now - (playing_.at + flashMs(playing_.flash))) < 0;
  }

  /** A wave call playing, waiting its turn, or owed: a new wave joins it. */
  bool waveCalling() const {
    if ((playingOn_ && playing_.whole) || waveOwed_) return true;
    for (const Reaction& r : queue_)
      if (r.whole) return true;
    for (const Reaction& r : moment_)
      if (r.whole) return true;
    return false;
  }

  /** A wave newer than any called for: hello, and its flashes now, or once the face rests (waves §1.2). */
  void callWave() {
    if (mode_ == REST) {
      react("hello", "wave", 1);
    } else {
      react("hello", nullptr, 1);
      waveOwed_ = true;
    }
  }

  void start(Reaction r, uint32_t at) {
    r.at = at;
    r.until = at + std::max(soundMs(r.sound), flashMs(r.flash));
    playing_ = r;
    playingOn_ = true;
    if (r.sound && r.audible) due_.push_back(r.sound);
  }

  /** A warning: orange twice with warn. One a moment, however many came up in it. */
  void playWarn() {
    for (const Reaction& r : moment_)
      if (r.cls == 2) return;
    react("warn", "warn", 2);
  }

  /** A warning came up. In NOT NOW, or while the face is not resting, it is owed (rules 1 and 6). */
  void warn(uint8_t w) {
    if (silent_ || mode_ != REST) owed_ |= w;
    else playWarn();
  }

  /** What is owed plays once, if any of it still holds. */
  void payOwed() {
    const bool holds = ((owed_ & REACH) && warnedReach_) || ((owed_ & WAIT) && warnedWait_) ||
                       ((owed_ & AWAY) && warnedAway_) || ((owed_ & BATTERY) && battery_ >= 0 && battery_ <= 15);
    if (holds) playWarn();
    owed_ = 0;
  }

  /** The end of a moment: its reactions go first, in order, and what was already waiting plays after them. */
  void settle(uint32_t now) {
    // A wave's flashes, or a warning, that waited for a choice play once the face rests.
    if (waveOwed_ && !silent_ && mode_ == REST) {
      waveOwed_ = false;
      react(nullptr, "wave", 1);
    }
    if (owed_ && !silent_ && mode_ == REST) payOwed();
    if (moment_.empty()) return;
    std::stable_sort(moment_.begin(), moment_.end(), [](const Reaction& a, const Reaction& b) { return a.cls < b.cls; });
    std::vector<Reaction> next(moment_.begin() + 1, moment_.end());
    next.insert(next.end(), queue_.begin(), queue_.end());
    queue_.swap(next);
    const Reaction first = moment_.front();
    moment_.clear();
    start(first, now);
  }

  /** Each reaction starts when the one before it ends. */
  void advance(uint32_t now) {
    while (playingOn_ && static_cast<int32_t>(now - playing_.until) >= 0) {
      const uint32_t at = playing_.until;
      playingOn_ = false;
      if (!queue_.empty()) {
        const Reaction next = queue_.front();
        queue_.erase(queue_.begin());
        start(next, at);
      }
    }
  }

  static Screen words(const std::string& big, const std::string& small, const std::string& field, const std::string& ink,
                      uint8_t light) {
    Screen s;
    s.big = big;
    s.small = small;
    s.field = field;
    s.ink = ink;
    s.light = light;
    return s;
  }

  bool personal() const { return haveShow_ && show_.hasArmed; }

  /** A call blinks on the resting face only: no look, choice, send or result on it. */
  bool blinking(uint32_t now) const {
    return calling_ && mode_ == REST && !link_.stale(now) && haveShow_ && show_.kind == "meet";
  }

  /** The letters or the check on the face: the band is nobody's yet, and a key only says where to go. */
  bool pairingFace(uint32_t now) const {
    return !link_.stale(now) && !quiet_.dark() && haveShow_ && (show_.kind == "pairing" || show_.kind == "check");
  }

  /** A meeting's number on the face, believed and not under NOT NOW: a SIDE hold there says found. A number is two digits. */
  bool meetingFace(uint32_t now) const {
    const std::string& n = show_.big;
    const bool number = n.size() == 2 && n[0] >= '1' && n[0] <= '9' && n[1] >= '0' && n[1] <= '9';
    return haveShow_ && show_.kind == "meet" && number && !link_.stale(now) && !quiet_.dark();
  }

  /** A press shows the face for WAKE_MS; the waiting face, which sleeps, stays lit PAIR_AWAKE_MS from it. */
  void wake(uint32_t now) {
    wakeUntil_ = now + WAKE_MS;
    if (haveShow_ && show_.kind == "waiting") litUntil_ = now + PAIR_AWAKE_MS;
  }

  /** NOT NOW (a hold not yet shown, or the relay's quiet), else what is armed, else "off". */
  std::string current() const {
    if (quiet_.dark() || (haveShow_ && show_.quiet)) return "notnow";
    return haveShow_ && !show_.armed.empty() ? show_.armed : "off";
  }

  std::string pct() const { return battery_ >= 0 ? std::to_string(battery_) + "%" : ""; }

  Screen noSignal() const {
    const std::string why = wifi_ ? "NO RELAY" : "NO WI-FI";
    return words("NO SIGNAL", pct().empty() ? why : why + " - " + pct(), "black", "text2", LIGHT_AWAKE);
  }

  /** The face at rest: faceFor(), wordsFor() and lightFor(), as the relay's show has it. */
  Screen restFace(uint32_t now, bool awake) const {
    const Face f = faceFor(haveShow_ ? &show_ : nullptr, link_.stale(now), quiet_.dark());
    const Signal signal = !wifi_ ? Signal::NO_WIFI : link_.up() ? Signal::LIVE : Signal::NO_RELAY;
    const Words w = wordsFor(f, awake, battery_, signal);
    const Show& s = f.show;
    Screen out;
    out.big = w.big;
    out.small = w.small;
    out.light = lightFor(f, awake);
    out.field = s.kind == "test" ? "white" : lit(s) ? s.intent : "black";
    out.ink = s.kind == "test" || lit(s) ? "ink" : s.kind == "pairing" || s.kind == "check" ? "white" : "text2";
    if (s.kind == "pairing") out.code = s.code;
    // Rule 5, over what the relay says: a press on the letters or the check says where to go, and the
    // letters and the waiting face sleep. Asleep, only the light goes: the picture stays for the next press.
    if ((s.kind == "pairing" || s.kind == "check") && static_cast<int32_t>(hintUntil_ - now) > 0)
      out.small = "PAIR ON YOUR PHONE";
    if ((s.kind == "pairing" || s.kind == "waiting") && static_cast<int32_t>(now - litUntil_) >= 0)
      out.light = LIGHT_OFF;
    return out;
  }

  void rest() {
    mode_ = REST;
    frozen_ = false;
    preview_.clear();
    word_.clear();
  }

  void closed(uint32_t now) {
    link_.closed(now);
    quiet_.closed();
    if (mode_ == WAVES) rest();  // the wave face follows the link
  }

  /** Someone waits on the person showing SAY HI, as the show says. */
  bool waiting() const {
    return personal() && show_.armed == "hi" && !show_.quiet && waves_.n > 0 && !waves_.ref.empty();
  }

  /** A FACE press on the resting HI or meeting face, with someone waiting and the link up, opens the wave face. */
  bool opensWaves() const { return mode_ == REST && link_.up() && !quiet_.dark() && waiting(); }

  void hold(uint32_t now) {
    quiet_.held();
    rest();
    wakeUntil_ = now;
    // Going into NOT NOW is the one sound it makes; a hold inside NOT NOW is silent.
    if (!silent_) react("down");
    silent_ = true;
    calling_ = false;  // NOT NOW ends a call
    waveOwed_ = false;
  }

  /** SET, CHANGED or NOT SENT on the face, with its sound and flash. In NOT NOW a failed try to come back is silent. */
  void result(uint32_t now, const char* w) {
    mode_ = RESULT;
    word_ = w;
    resultUntil_ = now + RESULT_MS;
    preview_.clear();
    frozen_ = false;
    if (silent_) return;
    const std::string word = w;
    if (word == "SET") react("up", "set", 0, choice_);
    else if (word == "CHANGED") react("fall", "changed");
    else react("low", "notsent");
  }

  /** `held`: a KEY2 hold sends it at once, and says so with a double tick, except from NOT NOW, which is silent. */
  void commit(uint32_t now, bool held = false) {
    if (frozen_) return;
    // "In force" is checked again: a preview equal to what is armed sends nothing.
    if (preview_ == current() || !link_.up()) {
      rest();
      return;
    }
    choice_ = preview_ == "off" ? "" : preview_;
    out_.push_back("{\"t\":\"set\",\"intent\":" + (choice_.empty() ? std::string("null") : "\"" + choice_ + "\"") +
                   ",\"basis\":" + std::to_string(basis_) + "}");
    mode_ = SENDING;
    sentAt_ = now;
    if (held && !silent_) react("double");
  }

  static std::string after(const std::string& card) {
    if (card == "hi") return "song";
    if (card == "song") return "dance";
    if (card == "dance") return "off";
    return "hi";
  }

  /** A SIDE hold in the wave face: wave back to the newest waiting, from the state its show carried. */
  void waveBack(uint32_t now) {
    out_.push_back("{\"t\":\"wave\",\"ref\":\"" + waves_.ref + "\",\"basis\":" + std::to_string(show_.rev) + "}");
    mode_ = WAVEBACK;
    sentAt_ = now;
    react("double");
  }

  /** A SIDE hold on the meeting face: the two of them found each other. Out of reach, NOT SENT at once. */
  void sayFound(uint32_t now) {
    if (!link_.up()) {
      result(now, "NOT SENT");
      return;
    }
    out_.push_back("{\"t\":\"found\",\"number\":\"" + show_.big + "\"}");
    mode_ = FOUND;
    sentAt_ = now;
    react("double");
  }

  /** A KEY2 press let go before HOLD_MS. */
  void step(uint32_t now) {
    if (k1_.down || frozen_ || mode_ == SENDING || mode_ == WAVEBACK) return;
    if (mode_ == RESULT) rest();
    if (mode_ == REST) {
      wake(now);
      if (!personal()) return;  // not about the person: KEY2 only wakes
      mode_ = LOOK;
      stepAt_ = now;
      basis_ = show_.rev;
      return;
    }
    if (!link_.up()) return;  // offline, KEY2 changes nothing
    if (mode_ == LOOK) {
      const std::string cur = current();
      fromQuiet_ = cur == "notnow";
      preview_ = fromQuiet_ ? "hi" : after(cur);
      mode_ = CHOOSING;
      stepAt_ = now;
      return;
    }
    preview_ = after(preview_);
    stepAt_ = now;
  }

  /** KEY2 held for HOLD_MS: send now in a choice; with no preview yet, only wake. */
  void sideHeld(uint32_t now) {
    if (k1_.down || frozen_) return;
    if (mode_ == CHOOSING) commit(now, true);
    else if (mode_ == WAVES) waveBack(now);
    else if (mode_ == LOOK) stepAt_ = now;
    else if ((mode_ == REST || mode_ == RESULT) && meetingFace(now)) sayFound(now);
    else if (mode_ == REST || mode_ == RESULT) step(now);
  }

  std::string key_, id_, secret_, air_;
  int battery_ = -1;
  bool wifi_ = true;
  Link link_;
  Quiet quiet_;
  Show show_;
  bool haveShow_ = false;
  Key k1_, k2_;
  Mode mode_ = REST;
  std::string preview_, choice_, word_;
  bool fromQuiet_ = false, frozen_ = false;
  uint32_t wakeUntil_ = 0, stepAt_ = 0, sentAt_ = 0, resultUntil_ = 0;
  int64_t basis_ = 0;
  std::vector<std::string> out_;
  // Reactions (rule 6): this input's, not yet in order; the one playing; those waiting their turn.
  std::vector<Reaction> moment_, queue_;
  Reaction playing_;
  bool playingOn_ = false;
  std::vector<std::string> due_;
  bool soundOn_ = true;  // the person's switch, as the last show that said it had it (rule 3)
  bool silent_ = false;  // NOT NOW, for the sake of silence (rule 1)
  // The meeting call (rule 4): the number last called for, whether it still calls, and since when.
  std::string called_;
  bool calling_ = false;
  uint32_t callAt_ = 0;
  // Waves: who waits, as the last show said; the newest wave number called for (the relay's clock, past 32
  // bits); and a call's flashes, owed until the face rests.
  Waves waves_;
  int64_t waveSeq_ = 0;
  bool waveOwed_ = false;
  // Found by both (found §2): the number last played for, until a show about the person names none.
  int64_t foundPlayed_ = 0;
  // Rule 5: the letters and the waiting face sleep. Until when they are lit, which letters lit them, when
  // waiting began, and until when a press says where to go.
  uint32_t litUntil_ = 0;
  std::string pairCode_;
  bool waiting_ = false;
  uint32_t waitAt_ = 0;
  uint32_t hintUntil_ = 0;
  // Rule 7: each warning plays once per change. Which have played (true while their condition holds), which
  // battery thresholds are armed, and which came up in NOT NOW or during a choice and are owed, by bit.
  enum Warning : uint8_t { REACH = 1, WAIT = 2, AWAY = 4, BATTERY = 8 };
  bool warnedReach_ = false, warnedWait_ = false, warnedAway_ = false;
  bool armedLow_ = true, armedEmpty_ = true;
  uint8_t owed_ = 0;
};

// ---------- the serial console ----------

/** A line typed at the serial console: its first word, lower-cased, and everything after the space that ends it. */
struct Command {
  std::string verb, arg;
};

inline Command readCommand(const std::string& line) {
  std::string s = line;
  while (!s.empty() && (s.back() == '\r' || s.back() == '\n')) s.pop_back();
  const size_t a = s.find_first_not_of(" \t");
  if (a == std::string::npos) return {};
  const size_t sp = s.find(' ', a);
  Command c;
  c.verb = s.substr(a, sp == std::string::npos ? std::string::npos : sp - a);
  for (char& ch : c.verb)
    if (ch >= 'A' && ch <= 'Z') ch = static_cast<char>(ch - 'A' + 'a');
  if (sp != std::string::npos) c.arg = s.substr(sp + 1);
  return c;
}

/**
 * A key pressed from the USB console, as a finger would: `press face` or
 * `press side` is let go before any bar shows, `hold face` or `hold side` just
 * after the hold. Only the cable reaches the console, and whoever holds the
 * cable holds the band: this is for testing on a real band without hands.
 */
constexpr uint32_t PRESS_MS = 120;
constexpr uint32_t PRESS_HOLD_MS = HOLD_MS + 200;

struct KeyPress {
  int key = 0;  // 1 the face, 2 the side; 0 when the line is not a press
  uint32_t ms = 0;
};

inline KeyPress pressFor(const Command& c) {
  KeyPress p;
  if (c.verb != "press" && c.verb != "hold") return p;
  const std::string which = upper(trim(c.arg));
  p.key = which == "FACE" ? 1 : which == "SIDE" ? 2 : 0;
  if (p.key) p.ms = c.verb == "hold" ? PRESS_HOLD_MS : PRESS_MS;
  return p;
}

/** What the screen shows, for the console: its words, its field and its light, and the bar while there is one. */
inline std::string faceLine(const Screen& s) {
  std::string words = s.big;
  if (!s.small.empty()) words += (words.empty() ? "" : " / ") + s.small;
  std::string line = "face: " + (words.empty() ? std::string("no words") : words) + " (" + s.field + ", light " +
                     std::to_string(s.light);
  if (s.bar >= 0) line += ", bar " + std::to_string(s.bar);
  return line + ")";
}

/**
 * What the console says about a frame the wrist sends, or "" for nothing: a
 * hello says whether it carries a secret, never the secret itself, a choice
 * says what was chosen, and a wave back or a found only that it was sent.
 */
inline std::string saidLine(const std::string& frame) {
  if (frame == "DROP") return "the relay went quiet; trying again";
  if (frame == HOLD_FRAME) return "NOT NOW, from the wrist";
  if (frame.rfind("{\"t\":\"wave\"", 0) == 0) return "a wave back from the wrist";
  if (frame.rfind("{\"t\":\"found\"", 0) == 0) return "found, from the wrist";
  if (frame.rfind("{\"t\":\"wristband\"", 0) == 0)
    return frame.find("\"secret\":") == std::string::npos ? "hello to the relay, as a new wristband"
                                                          : "hello to the relay, with its secret";
  if (frame.rfind("{\"t\":\"set\"", 0) == 0) {
    const std::string mark = "\"intent\":\"";
    const size_t a = frame.find(mark);
    const size_t b = a == std::string::npos ? a : frame.find('"', a + mark.size());
    const char* words = b == std::string::npos ? "" : cardWords(frame.substr(a + mark.size(), b - a - mark.size()));
    return std::string("a choice from the wrist: ") + (*words ? words : "OFF");
  }
  return "";
}

/**
 * What the console says about a frame from the relay, or "" for nothing:
 * what it refuses, a pairing, the answer to a wave back or a found, and each
 * change in what it shows, how many wait and a meeting found included.
 * `shown` is what was last said about a show, kept by the caller. Never a
 * secret, and never who waved.
 */
inline std::string heardLine(const Frame& f, std::string& shown) {
  if (f.t == "error") return "the relay says: " + f.why;
  if (f.t == "set" && f.hasOk && !f.ok) return "the relay did not take the choice: " + f.why;
  if (f.t == "wave" && f.hasOk) return f.ok ? "the relay took the wave back" : "the relay did not take the wave back: " + f.why;
  if (f.t == "found" && f.hasOk) return f.ok ? "the relay took the found" : "the relay did not take the found: " + f.why;
  if (f.t == "paired" && f.hasSecret) return "paired: the relay gave it a secret";
  if (f.t != "show" || !f.hasShow) return "";
  const Show& s = f.show;
  std::string what = s.kind;
  if (s.kind == "pairing") what += " " + s.code;
  else if (s.kind == "check" || s.kind == "meet") what += " " + s.big;
  else if (s.quiet) what += " (NOT NOW)";
  else if (s.away) what += " (away)";
  if (s.kind == "meet" && s.small == "FOUND: WAITING") what += " (found: waiting)";
  if (f.found.n > 0) what += " (found " + std::to_string(f.found.n) + ")";
  if (f.waves.n > 0) what += " (" + std::to_string(f.waves.n) + " waiting)";
  if (what == shown) return "";
  shown = what;
  return "the relay shows: " + what;
}

}  // namespace otb
