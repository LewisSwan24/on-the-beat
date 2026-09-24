// ON THE BEAT — the wristband's own logic, with no hardware in it.
//
// main.cpp is only the hardware round this file: the screen, the one button,
// Wi-Fi and the socket. Everything that decides something is here, in plain
// C++17, so it builds on a laptop as well as on the M5StickC.
// tests/firmware.test.js compiles it with the host's own compiler and holds it
// against the real relay: the frames it sends are frames the relay takes, and
// every frame the relay sends is read back the way the relay meant it.
//
// It speaks exactly what the stand-in at /band speaks (app/screens/Band.jsx),
// on the same clock: a press wakes it for three seconds, a one-second hold is
// NOT NOW, and it asks the relay every two seconds and takes six seconds of
// silence as a dead socket.
//
// What it shows is never decided here. The relay decides that, in
// relay/band.js, from the same view its person's phone is sent; this only
// draws it, and goes dark when it can no longer trust what it was told.

#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <functional>
#include <string>
#include <vector>

namespace otb {

constexpr uint32_t HOLD_MS = 1000;            // held this long: NOT NOW
constexpr uint32_t WAKE_MS = 3000;            // a press shows what it is doing for this long
constexpr uint32_t PING_EVERY_MS = 2000;      // ask the relay this often...
constexpr uint32_t DEAF_MS = 6000;            // ...and take this much silence as a dead socket
constexpr uint32_t RETRY_MS = 1500;           // between tries to reach the relay
constexpr uint32_t STALE_MS = 10000;          // out of reach this long, what the relay last said is not shown
constexpr uint32_t QUIET_CONFIRM_MS = 3000;   // NOT NOW from the wrist stays dark at least until the relay answers, or this long
constexpr uint32_t BATTERY_EVERY_MS = 30000;  // at most one battery report this often
constexpr uint32_t BATTERY_DRIFT_MS = 300000; // a one-point change is only worth a report after this long
constexpr const char* WS_PATH = "/api/ws";

constexpr uint8_t LIGHT_FULL = 255;   // a card, from across a dark room
constexpr uint8_t LIGHT_DIM = 128;    // the relay says the battery is low: half, as the canvas has it
constexpr uint8_t LIGHT_PAIR = 160;   // bright enough to scan, not so bright the camera blooms
constexpr uint8_t LIGHT_AWAKE = 110;  // READY, for three seconds
constexpr uint8_t LIGHT_OFF = 0;

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
  bool away = false;  // paired, but its person is not in a room
  bool operator==(const Show& o) const {
    return kind == o.kind && intent == o.intent && big == o.big && small == o.small && code == o.code &&
           dim == o.dim && quiet == o.quiet && away == o.away;
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

/** A frame from the relay: its type, and the show or the reason it carries. */
struct Frame {
  std::string t;
  bool hasShow = false;
  Show show;
  std::string why;
  std::string secret;  // {t:'paired'}: the pairing's secret, kept in RAM only
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
    if (key == "secret") return text_(f.secret, 32);
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
      return r.skip();
    });
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
  if (lit(s)) return {fold(s.big), upper(fold(s.small))};
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

// ---------- the one button ----------

/** A press wakes the face; held for HOLD_MS it is NOT NOW, once, while it is still held — as /band does. */
class Button {
 public:
  enum Event { NONE, WAKE, HOLD };

  Event update(bool down, uint32_t now) {
    if (down && !down_) {
      down_ = true;
      held_ = false;
      since_ = now;
      return NONE;
    }
    if (down && !held_ && now - since_ >= HOLD_MS) {
      held_ = true;
      return HOLD;
    }
    if (!down && down_) {
      down_ = false;
      return held_ ? NONE : WAKE;
    }
    return NONE;
  }

 private:
  bool down_ = false;
  bool held_ = false;
  uint32_t since_ = 0;
};

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

/**
 * The first thing a wristband says on every connection: who it is, the key
 * that proves it, the protocol, and — when it has them — the secret its
 * pairing gave it, a NOT NOW still waiting to be sent, and its battery.
 */
inline std::string helloFrame(const std::string& id, const std::string& key, int battery,
                              const std::string& secret = "", bool quiet = false) {
  std::string f = "{\"t\":\"wristband\",\"id\":\"" + id + "\",\"key\":\"" + key + "\",\"v\":2";
  if (!secret.empty()) f += ",\"secret\":\"" + secret + "\"";
  if (quiet) f += ",\"quiet\":true";
  if (battery >= 0) f += ",\"battery\":" + std::to_string(battery);
  return f + "}";
}

inline std::string batteryFrame(int level) { return "{\"t\":\"battery\",\"level\":" + std::to_string(level) + "}"; }

constexpr const char* HOLD_FRAME = "{\"t\":\"hold\"}";
constexpr const char* PING_FRAME = "{\"t\":\"ping\"}";

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

}  // namespace otb
