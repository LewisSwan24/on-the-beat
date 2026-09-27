// ON THE BEAT — the wristband's logic, run on a laptop.
//
//   logic_test            every check below; exits non-zero on the first that fails
//   logic_test wrist      the wrist's table of cases (tests/wrist-table.js), one answer a line
//   logic_test speak      reads commands on stdin, one per line, and answers each
//                         with one line: how tests/firmware.test.js puts this code
//                         in front of the real relay
//
// Built and run by tests/firmware.test.js. By hand:
//   c++ -std=c++17 -Wall -Wextra -o /tmp/logic firmware/host/logic_test.cpp && /tmp/logic

#include <cstdio>
#include <iostream>
#include <memory>
#include <random>
#include <sstream>
#include <string>
#include <utility>

// On the wristband, Arduino.h comes first and defines these as macros, so a
// name in band_logic.h that matches one breaks the device build (HEX did).
// Defined here too, the laptop build breaks the same way.
#define PI 3.14159
#define HALF_PI 1.5708
#define TWO_PI 6.28319
#define DEG_TO_RAD 0.0174533
#define RAD_TO_DEG 57.2958
#define EULER 2.71828
#define SERIAL 0x0
#define DISPLAY 0x1
#define LSBFIRST 0
#define MSBFIRST 1
#define RISING 0x01
#define FALLING 0x02
#define CHANGE 0x03
#define DEFAULT 1
#define EXTERNAL 0
#define DEC 10
#define HEX 16
#define OCT 8
#define BIN 2
#define constrain(amt, low, high) ((amt) < (low) ? (low) : ((amt) > (high) ? (high) : (amt)))
#define radians(deg) ((deg) * DEG_TO_RAD)
#define degrees(rad) ((rad) * RAD_TO_DEG)
#define sq(x) ((x) * (x))
#define lowByte(w) ((uint8_t)((w) & 0xff))
#define highByte(w) ((uint8_t)((w) >> 8))
#define bit(b) (1UL << (b))
#define word(...) makeWord(__VA_ARGS__)

#include "../src/band_logic.h"

using namespace otb;

namespace {

int checks = 0;

#define CHECK(cond)                                                               \
  do {                                                                            \
    ++checks;                                                                     \
    if (!(cond)) {                                                                \
      std::fprintf(stderr, "%s:%d: failed: %s\n", __FILE__, __LINE__, #cond);     \
      std::exit(1);                                                               \
    }                                                                             \
  } while (0)

Show parsed(const std::string& text) {
  Frame f;
  CHECK(readFrame(text, f));
  CHECK(f.hasShow);
  return f.show;
}

bool reads(const std::string& text) {
  Frame f;
  return readFrame(text, f);
}

void wrist() {
  // The table of cases (tests/fixtures/wrist-cases.json) runs through `logic_test wrist`.
  // Here, only what a table in milliseconds cannot reach: the counter wrapping after 49 days.
  Wrist w("000102030405060708090a0b0c0d0e0f");
  CHECK(w.id() == idFor("000102030405060708090a0b0c0d0e0f"));
  const uint32_t t0 = 0xFFFFFE00u;
  w.linkUp(t0);
  w.frame("{\"t\":\"show\",\"show\":{\"kind\":\"off\",\"armed\":null,\"rev\":1}}", t0);
  w.take();
  w.keyDown(1, t0);
  w.tick(t0 + HOLD_MS - 1);
  CHECK(w.take().empty() && w.face(t0 + HOLD_MS - 1).small == "KEEP HOLDING");
  w.tick(t0 + HOLD_MS);  // past zero
  const std::vector<std::string> sent = w.take();
  CHECK(sent.size() == 1 && sent[0] == HOLD_FRAME);
  // A press just before the counter wraps keeps the face awake across it, and no longer.
  Wrist v("000102030405060708090a0b0c0d0e0f");
  const uint32_t t1 = 0xFFFFFFFFu - 1000;
  v.keyDown(1, t1);
  v.keyUp(1, t1 + 100);
  CHECK(v.face(t1 + 200).light == LIGHT_AWAKE);
  CHECK(v.face(t1 + 100 + WAKE_MS).light == LIGHT_OFF);  // past zero
}

void link() {
  Link l;
  CHECK(l.stale(0));  // never reached: nothing it said is believed
  CHECK(l.tick(0) == Link::WAIT);
  l.opened(1000);
  CHECK(!l.stale(1000));
  CHECK(l.tick(2999) == Link::WAIT);
  CHECK(l.tick(3000) == Link::PING);  // every two seconds
  CHECK(l.tick(3001) == Link::WAIT);
  CHECK(l.tick(5000) == Link::PING);
  l.heard(5500);
  CHECK(l.tick(11500) == Link::PING);
  CHECK(l.tick(11501) == Link::DROP);  // six seconds of nothing at all
  l.closed(11501);
  CHECK(!l.stale(21500));  // a blip is not believed to be the end
  CHECK(l.stale(21501));   // ten seconds is
  l.closed(30000);         // closing twice does not move when it was lost
  CHECK(l.stale(21501));
}

void quiet() {
  Show blue;
  blue.kind = "hi";
  blue.intent = "hi";
  Show off;
  off.quiet = true;
  Show pairing;
  pairing.kind = "pairing";
  pairing.code = "KXRT";

  Quiet q;
  CHECK(!q.dark());
  q.held();  // held with no relay in reach
  CHECK(q.dark());
  CHECK(!q.due(false));
  CHECK(q.due(true));
  q.sent(100);
  CHECK(!q.due(true));
  q.shown(blue);  // a card that was already on its way is not shown
  CHECK(q.dark());
  q.closed();  // dropped before the relay answered: say it again
  CHECK(q.due(true));
  q.sent(200);
  q.shown(off);
  CHECK(!q.dark());

  q.held();
  q.sent(1000);
  q.tick(3999);
  CHECK(q.dark());
  q.tick(4000);  // no answer that settles it: the relay's word stands
  CHECK(!q.dark());

  q.held();
  q.sent(5000);
  q.shown(pairing);  // not paired to anyone: nothing to hide
  CHECK(!q.dark());
}

void battery() {
  BatteryReport r;
  CHECK(!r.due(-1, 0));
  CHECK(r.due(62, 0));
  r.sent(62, 0);
  CHECK(!r.due(62, 999999));
  CHECK(!r.due(55, 29999));  // at most one report in thirty seconds
  CHECK(r.due(55, 30000));
  r.sent(55, 30000);
  CHECK(!r.due(54, 60000));  // one point is noise for a while
  CHECK(r.due(54, 330000));
  r.reset();
  CHECK(r.due(54, 330001));  // a new connection hears it again
}

void frames() {
  // The relay's frames, exactly as JSON.stringify writes them.
  Show s = parsed(R"j({"t":"show","show":{"kind":"hi","intent":"hi","big":"HI :)","small":"blue means hello","dim":false}})j");
  CHECK(s.kind == "hi" && s.intent == "hi" && s.big == "HI :)" && s.small == "blue means hello" && !s.dim);
  CHECK(lit(s));
  s = parsed(R"j({"t":"show","show":{"kind":"pairing","code":"KXRT"}})j");
  CHECK(s.kind == "pairing" && s.code == "KXRT" && !lit(s));
  s = parsed(R"j({"t":"show","show":{"kind":"off","battery":null,"quiet":true}})j");
  CHECK(s.kind == "off" && s.quiet);
  s = parsed(R"j({"t":"show","show":{"kind":"meet","intent":"song","big":"27","small":"MEET","dim":true}})j");
  CHECK(s.kind == "meet" && s.big == "27" && s.dim && lit(s));
  // Order, spacing and fields it does not know are all fine.
  s = parsed(" { \"show\" : { \"x\" : [1, -2.5e3, {\"y\": [true, null]}], \"kind\" : \"dance\", \"intent\":\"dance\" } , \"t\" : \"show\" } ");
  CHECK(s.kind == "dance");
  // Escapes, and every way a surrogate can arrive.
  s = parsed(R"j({"t":"show","show":{"kind":"song","intent":"song","small":"a\"b\\c\/d\u00e9\u6674\ud83c\udfb8\ud83c!\udfb8"}})j");
  CHECK(s.small == "a\"b\\c/d\xC3\xA9\xE6\x99\xB4\xF0\x9F\x8E\xB8\xEF\xBF\xBD!\xEF\xBF\xBD");
  s = parsed(R"j({"t":"show","show":{"small":"\ud83c\ue000"}})j");  // a high surrogate, then not a low one
  CHECK(s.small == "\xEF\xBF\xBD\xEE\x80\x80");
  // A field of the wrong type is its default, not a refused frame.
  s = parsed(R"j({"t":"show","show":{"kind":"hi","intent":"hi","big":27,"dim":"yes"}})j");
  CHECK(s.kind == "hi" && s.big.empty() && !s.dim);
  // Other frames.
  Frame f;
  CHECK(readFrame(R"j({"t":"pong"})j", f) && f.t == "pong" && !f.hasShow);
  CHECK(readFrame(R"j({"t":"error","why":"bad band"})j", f) && f.why == "bad band");
  Frame p;
  CHECK(readFrame("{\"t\":\"paired\",\"secret\":\"00112233445566778899aabbccddeeff\"}", p) && p.t == "paired" &&
        p.secret == "00112233445566778899aabbccddeeff" && !p.hasShow);
  Frame a;
  CHECK(readFrame("{\"t\":\"show\",\"show\":{\"kind\":\"off\",\"battery\":40,\"away\":true}}", a) && a.show.away);
  // What the wrist chooses from: what is armed (null is not the same as nothing said) and the rev.
  s = parsed(R"j({"t":"show","show":{"kind":"off","battery":62,"armed":null,"rev":41}})j");
  CHECK(s.hasArmed && s.armed.empty() && s.rev == 41);
  s = parsed(R"j({"t":"show","show":{"kind":"hi","intent":"hi","armed":"hi","rev":9007199254740991}})j");
  CHECK(s.hasArmed && s.armed == "hi" && s.rev == 9007199254740991LL);
  s = parsed(R"j({"t":"show","show":{"kind":"pairing","code":"KXRT"}})j");
  CHECK(!s.hasArmed && s.rev == 0);
  s = parsed(R"j({"t":"show","show":{"armed":7,"rev":"3","kind":""}})j");
  CHECK(!s.hasArmed && s.rev == 0 && s.kind == "off");
  s = parsed(R"j({"t":"show","show":{"armed":"hi","rev":2.5}})j");
  CHECK(s.rev == 0);
  Frame no;
  CHECK(readFrame(R"j({"t":"set","ok":false,"why":"changed"})j", no) && no.hasOk && !no.ok && no.why == "changed");
  // Not one whole object: refused.
  for (const char* bad : {"", "{", "}", "[]", "\"show\"", "{\"t\":}", "{\"t\":\"show\"", "{\"t\":\"show\"} x",
                          "{\"t\":\"sh\nw\"}", "{\"t\":\"\\x\"}", "{\"t\":\"\\u12\"}", "{t:1}", "{\"a\":01x}",
                          "{\"a\":-}", "{\"a\":1.}", "{\"a\":1e}", "{\"a\":tru}", "{\"a\":[1,]}"})
    CHECK(!reads(bad));
  // Nesting past anything the relay sends is refused, not followed down —
  // closed or not. The wristband's loop has a few kilobytes of stack.
  std::string deep = "{\"a\":";
  for (int i = 0; i < 5000; ++i) deep += "[";
  CHECK(!reads(deep));
  CHECK(reads("{\"a\":[[[[[[[[]]]]]]]]}"));
  CHECK(!reads("{\"a\":[[[[[[[[[[]]]]]]]]]]}"));
  // A long string is kept only so far.
  s = parsed("{\"t\":\"show\",\"show\":{\"kind\":\"song\",\"small\":\"" + std::string(5000, 'x') + "\"}}");
  CHECK(s.small.size() == 128);
  // Whatever arrives, it reads inside the text it was given (the test builds with sanitizers).
  std::mt19937 rng(7);
  const std::string seed = R"j({"t":"show","show":{"kind":"song","intent":"song","big":"FIRST SONG?","small":"a\u00e9\ud83c","dim":true}})j";
  for (int i = 0; i < 20000; ++i) {
    std::string t = seed;
    const int cuts = 1 + static_cast<int>(rng() % 4);
    for (int k = 0; k < cuts; ++k) {
      const size_t at = rng() % t.size();
      switch (rng() % 3) {
        case 0: t[at] = static_cast<char>(rng() % 256); break;
        case 1: t.erase(at, 1 + rng() % 8); break;
        default: t.insert(at, 1, "{}[]\",:\\u"[rng() % 9]); break;
      }
      if (t.empty()) t = "{";
    }
    reads(t);
    reads(t.substr(0, rng() % (t.size() + 1)));
  }
}

void text() {
  CHECK(fold("Just the Way Yo\xE2\x80\xA6") == "Just the Way Yo...");
  CHECK(fold("Don\xE2\x80\x99t Stop \xE2\x80\x9CMe\xE2\x80\x9D \xE2\x80\x94 live") == "Don't Stop \"Me\" - live");
  CHECK(fold("Beyonc\xC3\xA9 \xC5\x81\xC3\xB3" "d\xC5\xBA M\xC3\xB6tley Cr\xC3\xBC" "e \xC5\x92uvre") == "Beyonce Lodz Motley Crue OEuvre");
  CHECK(fold("\xE6\x99\xB4\xE5\xA4\xA9") == "");         // a script the fonts cannot draw: nothing, not boxes
  CHECK(fold("\xE6\x99\xB4 x  \xF0\x9F\x8E\xB8 y ") == "x y");  // and the spaces it leaves are tidied
  CHECK(fold("a\xFF\xC3(b\xED\xA0\x80" "c") == "a(bc");    // bytes that are not UTF-8 are dropped
  CHECK(upper(fold("blue means hello")) == "BLUE MEANS HELLO");

  auto chars = [](const std::string& s) { return static_cast<int>(s.size()); };
  CHECK((wrap("FIRST SONG?", 8, chars) == std::vector<std::string>{"FIRST", "SONG?"}));
  CHECK((wrap("HI :)", 8, chars) == std::vector<std::string>{"HI :)"}));
  CHECK((wrap("  a  b ", 8, chars) == std::vector<std::string>{"a b"}));
  CHECK((wrap("SUPERCALIFRAGILISTIC x", 8, chars) == std::vector<std::string>{"SUPERCALIFRAGILISTIC", "x"}));
  CHECK(wrap("", 8, chars).empty());

  // Three fonts, 3, 2 and 1 wide per letter, 30, 20 and 10 tall.
  auto width = [](int font, const std::string& s) { return static_cast<int>(s.size()) * (3 - font); };
  auto tall = [](int font) { return 30 - 10 * font; };
  Fit f = fit("LET'S DANCE!", 3, 20, 50, width, tall);  // two lines of the largest stand too tall
  CHECK(f.font == 1 && (f.lines == std::vector<std::string>{"LET'S", "DANCE!"}));
  f = fit("HI :)", 3, 20, 50, width, tall);
  CHECK(f.font == 0 && f.lines.size() == 1);
  f = fit("a b c d e f g h", 3, 2, 15, width, tall);  // nothing fits: the smallest, wrapped
  CHECK(f.font == 2);
}

void face() {
  Show song;
  song.kind = "song";
  song.intent = "song";
  song.big = "FIRST SONG?";
  song.small = "Just the Way Yo\xE2\x80\xA6";

  Face f = faceFor(&song, false, false);
  CHECK(f.show == song && !f.offline);
  Words w = wordsFor(f, false, 62, Signal::LIVE);
  CHECK(w.big == "FIRST SONG?" && w.small == "JUST THE WAY YO...");
  CHECK(lightFor(f, false) == LIGHT_FULL);
  song.dim = true;
  CHECK(lightFor(faceFor(&song, false, false), false) == LIGHT_DIM);

  f = faceFor(&song, false, true);  // NOT NOW from the wrist: dark before the relay hears it
  CHECK(f.show.kind == "off" && f.show.quiet && !f.offline && lightFor(f, false) == LIGHT_OFF);
  CHECK(wordsFor(f, true, 62, Signal::LIVE).big == "NOT NOW");
  f = faceFor(&song, true, true);  // and held with no relay in reach, a press says so
  CHECK(f.show.quiet && f.offline && wordsFor(f, true, 62, Signal::NO_RELAY).big == "NO SIGNAL");
  // With no Wi-Fi at all it says that, and what a SIDE hold does about it.
  CHECK(wordsFor(f, true, 62, Signal::NO_WIFI).big == "NO WI-FI" && wordsFor(f, true, 62, Signal::NO_WIFI).small == "HOLD SIDE: SET UP");
  f = faceFor(&song, true, false);  // the relay out of reach: not believed
  CHECK(f.show.kind == "off" && f.offline && lightFor(f, false) == LIGHT_OFF);
  CHECK(wordsFor(f, false, 62, Signal::NO_RELAY).big.empty());
  w = wordsFor(f, true, 62, Signal::NO_RELAY);
  CHECK(w.big == "NO SIGNAL" && w.small == "NO RELAY - 62%");
  CHECK(wordsFor(f, true, -1, Signal::NO_RELAY).small == "NO RELAY");
  CHECK(wordsFor(f, true, -1, Signal::NO_WIFI).small == "HOLD SIDE: SET UP");
  CHECK(lightFor(f, true) == LIGHT_AWAKE);

  f = faceFor(nullptr, false, false);
  w = wordsFor(f, true, 62, Signal::LIVE);
  CHECK(w.big == "READY" && w.small == "62%");

  Show pairing;
  pairing.kind = "pairing";
  pairing.code = "KXRT";
  f = faceFor(&pairing, false, false);
  CHECK(wordsFor(f, false, 62, Signal::LIVE).big == "KXRT" && lightFor(f, false) == LIGHT_PAIR);
  Show check;
  check.kind = "check";
  check.big = "27";
  f = faceFor(&check, false, false);
  w = wordsFor(f, false, 62, Signal::LIVE);
  CHECK(w.big == "27" && w.small == "ON YOUR PHONE?" && lightFor(f, false) == LIGHT_PAIR);
  Show waiting;
  waiting.kind = "waiting";
  f = faceFor(&waiting, false, false);
  w = wordsFor(f, false, 62, Signal::LIVE);
  CHECK(w.big == "OPEN YOUR PHONE" && w.small == "OR SWITCH ME OFF" && lightFor(f, false) == LIGHT_AWAKE);
  Show away;
  away.away = true;
  f = faceFor(&away, false, false);
  CHECK(wordsFor(f, false, 62, Signal::LIVE).big.empty() && lightFor(f, false) == LIGHT_OFF);
  w = wordsFor(f, true, 62, Signal::LIVE);
  CHECK(w.big == "OPEN YOUR PHONE" && w.small == "TO COME BACK" && lightFor(f, true) == LIGHT_AWAKE);
  Show dark;
  dark.quiet = true;
  f = faceFor(&dark, false, false);
  w = wordsFor(f, true, 62, Signal::LIVE);
  CHECK(w.big == "NOT NOW" && w.small == "62%");
  Show test;
  test.kind = "test";
  CHECK(lightFor(faceFor(&test, false, false), false) == LIGHT_FULL);

  // A card in a hue nobody defined is not a card.
  Show odd;
  odd.kind = "hi";
  odd.intent = "wave";
  CHECK(!lit(odd) && lightFor(faceFor(&odd, false, false), false) == LIGHT_OFF);
}

void colour() {
  CHECK(rgb565({0xFF, 0xFF, 0xFF}) == 0xFFFF && rgb565({0, 0, 0}) == 0x0000);
  CHECK(rgb565({0xFF, 0, 0}) == 0xF800 && rgb565({0, 0xFF, 0}) == 0x07E0 && rgb565({0, 0, 0xFF}) == 0x001F);
  const Hue& hi = *hueFor("hi");
  CHECK(!hueFor("wave"));
  // At the gradient's centre, the light colour; far out, the deep one.
  CHECK(glow(hi, 67, 91, 135, 240) == (Rgb{0x4E, 0xD7, 0xF1}));
  CHECK(glow(hi, -500, -500, 135, 240) == (Rgb{0x0C, 0x9D, 0xE2}));
  // And it falls off steadily from the centre down.
  int prev = 1 << 30;
  for (int y = 92; y < 240; y += 8) {
    const Rgb c = glow(hi, 67, y, 135, 240);
    CHECK(c.r <= prev);
    prev = c.r;
  }
}

void sound() {
  static uint8_t buf[SOUND_SAMPLES];
  const size_t ms = SOUND_RATE / 1000;  // samples a millisecond
  // One buffer holds the longest sound, jingle and warn at 0.6 s, and so every sound.
  CHECK(SOUND_SAMPLES == 600 * ms);
  for (const Sound& s : SOUNDS) CHECK(soundMs(s.name) * ms <= SOUND_SAMPLES);
  // A sound is as long as its notes.
  CHECK(render("tick", buf, sizeof buf) == 25 * ms);
  CHECK(render("jingle", buf, sizeof buf) == SOUND_SAMPLES);
  // A rest is silence, the middle of the range.
  CHECK(render("double", buf, sizeof buf) == 110 * ms);
  bool rest = true;
  for (size_t i = 25 * ms; i < 85 * ms; ++i) rest = rest && buf[i] == 128;
  CHECK(rest);
  // A note is a triangle over the whole range, never 0, starting from the middle so it does not click in.
  render("tick", buf, sizeof buf);
  uint8_t lo = 255, hi = 0;
  int ups = 0;
  for (size_t i = 0; i < 25 * ms; ++i) {
    lo = std::min(lo, buf[i]);
    hi = std::max(hi, buf[i]);
    if (i > 0 && buf[i - 1] < 128 && buf[i] >= 128) ++ups;
  }
  CHECK(buf[0] == 128 && lo >= 1 && lo <= 8 && hi >= 247);
  CHECK(ups >= 44 && ups <= 45);  // 1800 Hz for 25 ms: 45 waves
  // No more than the room it is given, and nothing for a name it does not know.
  CHECK(render("jingle", buf, 100) == 100);
  CHECK(render("hum", buf, sizeof buf) == 0);
  // On a buzzer a sound goes up whole octaves, as far as its highest note stays within BUZZER_TOP_HZ...
  const std::pair<const char*, uint32_t> octaves[] = {{"tick", 2}, {"double", 2}, {"down", 4},   {"up", 2},
                                                      {"fall", 2}, {"ask", 2},    {"jingle", 1}, {"warn", 4},
                                                      {"hello", 2}, {"found", 1}, {"calledit", 1}};
  CHECK(sizeof octaves / sizeof octaves[0] + 1 == sizeof SOUNDS / sizeof SOUNDS[0]);  // and low, below
  for (const auto& o : octaves) CHECK(soundFor(o.first) && !buzzerOwn(o.first) && buzzerFactor(*soundFor(o.first)) == o.second);
  for (const Sound& s : SOUNDS) {
    const uint32_t top = highestHz(s.notes, s.count) * buzzerFactor(s);
    CHECK(top <= BUZZER_TOP_HZ && top * 2 > BUZZER_TOP_HZ);
  }
  // ...but low, NOT SENT, falls a fifth from 4699 Hz: two octaves up it would be CHANGED's own notes.
  CHECK(buzzerOwn("low") && buzzerNote(*soundFor("low"), 0).hz == 4699 && buzzerNote(*soundFor("low"), 1).hz == 3136);
  // Every note on a buzzer keeps its length, its rests and the way each step goes, within BUZZER_TOP_HZ.
  const auto dir = [](uint32_t a, uint32_t b) { return (b > a) - (b < a); };
  for (const Sound& s : SOUNDS)
    for (size_t k = 0; k < s.count; ++k) {
      const Note n = buzzerNote(s, k);
      CHECK(n.ms == s.notes[k].ms && !n.hz == !s.notes[k].hz && n.hz <= BUZZER_TOP_HZ);
      if (k && n.hz && s.notes[k - 1].hz)
        CHECK(dir(buzzerNote(s, k - 1).hz, n.hz) == dir(s.notes[k - 1].hz, s.notes[k].hz));
    }
  // And no two sounds are alike, on the speaker or the buzzer: as many notes, each within a semitone.
  const auto alike = [](const Sound& a, const Sound& b, bool buzzer) {
    if (a.count != b.count) return false;
    for (size_t k = 0; k < a.count; ++k) {
      const uint32_t x = buzzer ? buzzerNote(a, k).hz : a.notes[k].hz;
      const uint32_t y = buzzer ? buzzerNote(b, k).hz : b.notes[k].hz;
      if (!x != !y || (x && std::max(x, y) * 1000 >= std::min(x, y) * 1060)) return false;
    }
    return true;
  };
  for (const Sound& a : SOUNDS)
    for (const Sound& b : SOUNDS)
      if (&a != &b) CHECK(!alike(a, b, false) && !alike(a, b, true));
  // Its length stays, so the wrist's timings hold; only the pitch moves: 3600 Hz for 25 ms is 90 waves.
  static uint8_t plain[SOUND_SAMPLES];
  CHECK(render("tick", buf, sizeof buf, true) == 25 * ms);
  CHECK(render("double", buf, sizeof buf, true) == 110 * ms);
  CHECK(render("warn", buf, sizeof buf, true) == render("warn", plain, sizeof plain));
  render("tick", buf, sizeof buf, true);
  ups = 0;
  for (size_t i = 1; i < 25 * ms; ++i)
    if (buf[i - 1] < 128 && buf[i] >= 128) ++ups;
  CHECK(buf[0] == 128 && ups >= 89 && ups <= 90);
  // A sound already high enough is left as it is, sample for sample.
  const size_t n = render("found", buf, sizeof buf, true);
  CHECK(n == render("found", plain, sizeof plain) && std::equal(buf, buf + n, plain));
  // The flash colours: plain fills. Black, white and the cards are drawn another way.
  CHECK(plainField("red") && *plainField("red") == (Rgb{0xFF, 0x6B, 0x6B}));
  CHECK(plainField("orange") && *plainField("orange") == (Rgb{0xFF, 0x8A, 0x00}));
  CHECK(!plainField("black") && !plainField("white") && !plainField("hi"));
}

void pairing() {
  CHECK(pairUrl("https://a.example//", "KXRT") == "https://a.example/pair/KXRT");
  CHECK(qrVersion(17) == 1 && qrVersion(18) == 2 && qrVersion(53) == 3 && qrVersion(78) == 4);
  CHECK(qrVersion(271) == 10 && qrVersion(272) == 0);
  CHECK(qrSize(4) == 33);
  // A tunnel address is version 4; across the 135-pixel screen that is three pixels a module.
  const std::string url = pairUrl("https://consistent-quarterly-seo-wagon.trycloudflare.com", "KXRT");
  CHECK(qrVersion(url.size()) == 4 && qrModule(4, 127) == 3);
  CHECK(qrModule(0, 127) == 0 && qrModule(10, 20) == 0);
}

void relay() {
  Relay r = parseRelay("  https://Abc-Def.trycloudflare.com/  ");
  CHECK(r.ok && r.secure && r.host == "abc-def.trycloudflare.com" && r.port == 443);
  CHECK(r.origin == "https://abc-def.trycloudflare.com");
  r = parseRelay("ws://192.168.1.20:8790");
  CHECK(r.ok && !r.secure && r.port == 8790 && r.origin == "http://192.168.1.20:8790");
  r = parseRelay("wss://relay.example:443/api/ws");
  CHECK(r.ok && r.origin == "https://relay.example");
  r = parseRelay("http://relay.example:80");
  CHECK(r.ok && !r.secure && r.origin == "http://relay.example");
  r = parseRelay("relay.example");
  CHECK(r.ok && r.secure && r.port == 443);
  for (const char* bad : {"", "   ", "ftp://x.example", "https://", "https://user@x.example", "https://x.example:",
                          "https://x.example:0", "https://x.example:65536", "https://x.example:8o", "https://-x.example",
                          "https://x_y.example", "https://[::1]:8790"})
    CHECK(!parseRelay(bad).ok);
}

void rejoin() {
  Rejoin r;
  CHECK(!r.due(false, false, 0) && !r.due(false, false, 999999));  // no network set: nothing to join
  r.began(1000);                                    // setup began it
  CHECK(!r.due(true, false, 1000 + REJOIN_MS - 1));
  CHECK(r.due(true, false, 1000 + REJOIN_MS));      // no link for REJOIN_MS: begin again
  CHECK(!r.due(true, false, 1000 + REJOIN_MS + 1)); // and wait again
  CHECK(r.due(true, false, 1000 + 2 * REJOIN_MS));
  CHECK(!r.due(true, true, 90000));                 // joined: nothing to do...
  CHECK(!r.due(true, false, 90000 + REJOIN_MS - 1)); // ...and after a drop, the wait runs from the last time it was joined
  CHECK(r.due(true, false, 90000 + REJOIN_MS));
  r.began(200000);                                  // a console command began it
  CHECK(!r.due(true, false, 200000 + REJOIN_MS - 1));
  Rejoin w;                                         // across the wrap of millis()
  w.began(0xFFFFFFFFu - 1000);
  CHECK(!w.due(true, false, REJOIN_MS - 1002));
  CHECK(w.due(true, false, REJOIN_MS - 1001));
}

void console() {
  const std::string key = "0123456712345678234567893456789a", id = idFor(key);
  const std::string secret = "5ec2e75ec2e75ec2e75ec2e75ec2e75e";
  CHECK(saidLine("DROP") == "the relay went quiet; trying again");
  CHECK(saidLine(HOLD_FRAME) == "NOT NOW, from the wrist");
  CHECK(saidLine(PING_FRAME).empty() && saidLine(batteryFrame(40)).empty());
  CHECK(saidLine(helloFrame(id, key, 62)) == "hello to the relay, as a new wristband");
  CHECK(saidLine(helloFrame(id, key, 62, secret, true)) == "hello to the relay, with its secret");
  CHECK(saidLine("{\"t\":\"set\",\"intent\":\"hi\",\"basis\":7}") == "a choice from the wrist: HI :)");
  CHECK(saidLine("{\"t\":\"set\",\"intent\":null,\"basis\":7}") == "a choice from the wrist: OFF");
  CHECK(saidLine("{\"t\":\"wave\",\"ref\":\"a1b2c3d4e5\",\"basis\":7}") == "a wave back from the wrist");
  CHECK(saidLine("{\"t\":\"found\",\"number\":\"27\"}") == "found, from the wrist");
  CHECK(saidLine("{\"t\":\"refuse\",\"number\":\"27\"}") == "the check turned away, from the wrist");

  std::string shown;
  const auto heard = [&shown](const std::string& text) {
    Frame f;
    CHECK(readFrame(text, f));
    return heardLine(f, shown);
  };
  CHECK(heard("{\"t\":\"error\",\"why\":\"bad band\"}") == "the relay says: bad band");
  CHECK(heard("{\"t\":\"set\",\"ok\":false,\"why\":\"changed\"}") == "the relay did not take the choice: changed");
  const std::string paired = heard("{\"t\":\"paired\",\"secret\":\"" + secret + "\"}");
  CHECK(paired == "paired: the relay gave it a secret" && paired.find("5ec2") == std::string::npos);  // never the secret
  CHECK(heard("{\"t\":\"show\",\"show\":{\"kind\":\"pairing\",\"code\":\"MHJJ\"}}") == "the relay shows: pairing MHJJ");
  CHECK(heard("{\"t\":\"show\",\"show\":{\"kind\":\"pairing\",\"code\":\"MHJJ\"}}").empty());  // only a change is said
  CHECK(heard("{\"t\":\"show\",\"show\":{\"kind\":\"check\",\"big\":\"27\"}}") == "the relay shows: check 27");
  CHECK(heard("{\"t\":\"show\",\"show\":{\"kind\":\"test\"}}") == "the relay shows: test");
  CHECK(heard("{\"t\":\"show\",\"show\":{\"kind\":\"off\",\"armed\":null,\"rev\":3}}") == "the relay shows: off");
  CHECK(heard("{\"t\":\"show\",\"show\":{\"kind\":\"hi\",\"intent\":\"hi\",\"big\":\"HI :)\",\"armed\":\"hi\",\"rev\":4}}") == "the relay shows: hi");
  CHECK(heard("{\"t\":\"show\",\"show\":{\"kind\":\"hi\",\"intent\":\"hi\",\"big\":\"HI :)\",\"armed\":\"hi\",\"rev\":5}}").empty());
  CHECK(heard("{\"t\":\"show\",\"show\":{\"kind\":\"off\",\"quiet\":true,\"armed\":\"hi\",\"rev\":6}}") == "the relay shows: off (NOT NOW)");
  CHECK(heard("{\"t\":\"show\",\"show\":{\"kind\":\"off\",\"away\":true}}") == "the relay shows: off (away)");
  CHECK(heard("{\"t\":\"show\",\"show\":{\"kind\":\"meet\",\"intent\":\"hi\",\"big\":\"42\",\"small\":\"MEET\"}}") == "the relay shows: meet 42");
  CHECK(heard("{\"t\":\"show\",\"show\":{\"kind\":\"waiting\"}}") == "the relay shows: waiting");
  CHECK(heard("{\"t\":\"ping\"}").empty());
  // Who waits is part of what it shows, as a count; never the handle.
  const std::string hi = "{\"t\":\"show\",\"show\":{\"kind\":\"hi\",\"intent\":\"hi\",\"armed\":\"hi\",\"rev\":7";
  CHECK(heard(hi + "}}") == "the relay shows: hi");
  const std::string two = heard(hi + ",\"waves\":{\"ref\":\"a1b2c3d4e5\",\"n\":2,\"seq\":1790337603000}}}");
  CHECK(two == "the relay shows: hi (2 waiting)" && two.find("a1b2") == std::string::npos);
  CHECK(heard(hi + ",\"waves\":{\"ref\":\"f6a7b8c9d0\",\"n\":2,\"seq\":1790337603005}}}").empty());
  // Found each other: said on this side, the meeting waits; said by both, the show names the number it found.
  CHECK(heard("{\"t\":\"show\",\"show\":{\"kind\":\"meet\",\"intent\":\"hi\",\"big\":\"42\",\"small\":\"FOUND: WAITING\"}}") ==
        "the relay shows: meet 42 (found: waiting)");
  CHECK(heard(hi + ",\"found\":{\"n\":42,\"intent\":\"song\"}}}") == "the relay shows: hi (found 42)");
  CHECK(heard(hi + ",\"found\":{\"n\":42,\"intent\":\"song\"}}}").empty());
  CHECK(heard("{\"t\":\"found\",\"ok\":true}") == "the relay took the found");
  CHECK(heard("{\"t\":\"found\",\"ok\":false,\"why\":\"gone\"}") == "the relay did not take the found: gone");
  CHECK(heard("{\"t\":\"wave\",\"ok\":true}") == "the relay took the wave back");
  CHECK(heard("{\"t\":\"wave\",\"ok\":false,\"why\":\"gone\"}") == "the relay did not take the wave back: gone");

  // Keys typed at the USB console are the presses a finger makes: a press shows no bar, a hold is past the hold.
  CHECK(PRESS_MS < BAR_MS && PRESS_HOLD_MS > HOLD_MS);
  KeyPress p = pressFor(readCommand("press face"));
  CHECK(p.key == 1 && p.ms == PRESS_MS);
  p = pressFor(readCommand("HOLD Side "));
  CHECK(p.key == 2 && p.ms == PRESS_HOLD_MS);
  CHECK(pressFor(readCommand("press")).key == 0 && pressFor(readCommand("press elbow")).key == 0);
  CHECK(pressFor(readCommand("show")).key == 0 && pressFor(readCommand("face")).key == 0);
  CHECK(pressFor(readCommand("ssid side")).key == 0);  // a network called "side" is not a press

  // And the console can say what the screen shows: the words, the field and the light.
  Screen waves;
  waves.big = "SOMEONE WAVED";
  waves.small = "2 WAITING - HOLD SIDE";
  waves.light = LIGHT_AWAKE;
  CHECK(faceLine(waves) == "face: SOMEONE WAVED / 2 WAITING - HOLD SIDE (black, light 110)");
  Screen flash;
  flash.field = "hi";
  flash.light = LIGHT_FULL;
  CHECK(faceLine(flash) == "face: no words (hi, light 255)");
  Screen held;
  held.big = "KEEP HOLDING";
  held.light = LIGHT_AWAKE;
  held.bar = 40;
  CHECK(faceLine(held) == "face: KEEP HOLDING (black, light 110, bar 40)");
  Wrist w("000102030405060708090a0b0c0d0e0f");
  w.linkUp(1000);
  w.frame("{\"t\":\"show\",\"show\":{\"kind\":\"pairing\",\"code\":\"UDXE\"}}", 1000);
  CHECK(faceLine(w.face(1000)) == "face: UDXE (black, light 160)");  // the letters, read without eyes on it
}

void said() {
  CHECK(validId("0123456789abcdef") && !validId("0123456789abcde") && !validId("0123456789ABCDEF"));
  CHECK(!validId(std::string(65, 'a')) && validId(std::string(64, 'a')));
  // SHA-256 of "abc", and of nothing: the standard's own examples.
  const std::string abc = "abc";
  CHECK(sha256Hex(reinterpret_cast<const uint8_t*>(abc.data()), abc.size()) ==
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const uint8_t none[1] = {0};
  CHECK(sha256Hex(none, 0) == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  CHECK((hexBytes("00ff10") == std::vector<uint8_t>{0x00, 0xff, 0x10}) && hexBytes("0g").empty() && hexBytes("abc").empty());
  uint32_t n = 0;
  const std::string key = makeKey([&n] { return 0x01234567u + 0x11111111u * n++; });
  CHECK(key == "0123456712345678234567893456789a" && validId(key));
  const std::string id = idFor(key);
  CHECK(id.size() == 32 && validId(id) && id != key);
  CHECK(helloFrame(id, key, 62) == "{\"t\":\"wristband\",\"id\":\"" + id + "\",\"key\":\"" + key + "\",\"v\":2,\"battery\":62}");
  CHECK(helloFrame(id, key, -1, "5ec2", true) ==
        "{\"t\":\"wristband\",\"id\":\"" + id + "\",\"key\":\"" + key + "\",\"v\":2,\"secret\":\"5ec2\",\"quiet\":true}");
  CHECK(batteryFrame(12) == "{\"t\":\"battery\",\"level\":12}");
  CHECK(refuseFrame("27") == "{\"t\":\"refuse\",\"number\":\"27\"}");

  Command c = readCommand("  RELAY https://x.example\r\n");
  CHECK(c.verb == "relay" && c.arg == "https://x.example");
  c = readCommand("pass  two words ");  // a password keeps its spaces
  CHECK(c.verb == "pass" && c.arg == " two words ");
  c = readCommand("show");
  CHECK(c.verb == "show" && c.arg.empty());
  CHECK(readCommand("   ").verb.empty());
}

/** A band's address as a report writes it: 02 00 00 00 00 <i>. */
std::string airOf(int i) {
  const uint8_t mac[6] = {0x02, 0, 0, 0, 0, static_cast<uint8_t>(i)};
  return airHex(mac);
}

void hear(Hearing& h, int i, int rssi) {
  const uint8_t mac[6] = {0x02, 0, 0, 0, 0, static_cast<uint8_t>(i)};
  h.heard(mac, rssi);
}

void hearing() {
  const uint8_t written[6] = {0x02, 0xab, 0xcd, 0xef, 0x01, 0x23};
  CHECK(airHex(written) == "02abcdef0123");

  // A new address every boot, from the band's own noise: locally administered and unicast, never the chip's.
  uint8_t mac[6];
  uint32_t n = 0;
  makeAir(mac, [&n] { return n++ ? 0x00006655u : 0x44332211u; });
  CHECK(airHex(mac) == "122233445566");
  for (const uint32_t noise : {0x00000000u, 0xFFFFFFFFu, 0x000000FDu}) {
    makeAir(mac, [noise] { return noise; });
    CHECK((mac[0] & 0x01) == 0 && (mac[0] & 0x02) == 0x02);
  }

  // A listen that heard nobody still reports: a band that listened and heard nobody is evidence too.
  Hearing h;
  CHECK(h.size() == 0 && h.frame(6) == "{\"t\":\"heard\",\"ch\":6,\"near\":[]}");

  // Each band once, at the strongest of its beacons; the strongest band first.
  hear(h, 0x0a, -70);
  hear(h, 0x0b, -50);
  hear(h, 0x0a, -60);
  hear(h, 0x0a, -80);
  CHECK(h.size() == 2);
  CHECK(h.frame(11) == "{\"t\":\"heard\",\"ch\":11,\"near\":[[\"02000000000b\",-50],[\"02000000000a\",-60]]}");
  h.clear();
  CHECK(h.size() == 0 && h.frame(11) == "{\"t\":\"heard\",\"ch\":11,\"near\":[]}");

  // A reading the relay would not take is brought into its range, not dropped.
  hear(h, 1, -120);
  hear(h, 2, 3);
  CHECK(h.frame(1) == "{\"t\":\"heard\",\"ch\":1,\"near\":[[\"020000000002\",0],[\"020000000001\",-100]]}");
  CHECK(saidLine(h.frame(1)).empty());  // a report every ten seconds is not said on the console; `near` says it

  // More than HEARD_MAX: the strongest HEARD_MAX, in whatever order they were heard.
  auto strongest = [](int from, int to) {  // bands from..to, heard at -80 + i, strongest first
    std::string f = "{\"t\":\"heard\",\"ch\":6,\"near\":[";
    for (int i = to; i >= from; --i) f += std::string(i == to ? "" : ",") + "[\"" + airOf(i) + "\"," + std::to_string(-80 + i) + "]";
    return f + "]}";
  };
  Hearing up, down;
  for (int i = 0; i < 20; ++i) hear(up, i, -80 + i);
  for (int i = 19; i >= 0; --i) hear(down, i, -80 + i);
  CHECK(up.size() == HEARD_MAX && down.size() == HEARD_MAX);
  CHECK(up.frame(6) == strongest(8, 19) && down.frame(6) == strongest(8, 19));
  // One pushed out comes back when it is heard stronger, and the weakest goes.
  hear(down, 0, -10);
  CHECK(down.frame(6).rfind("{\"t\":\"heard\",\"ch\":6,\"near\":[[\"" + airOf(0) + "\",-10],[\"" + airOf(19) + "\",-61]", 0) == 0);
  CHECK(down.frame(6).find(airOf(8)) == std::string::npos && down.frame(6).find(airOf(9)) != std::string::npos);

  // The longest frames a band sends fit its outbox: a full report on channel 14, and the longest hello.
  Hearing full;
  for (int i = 0; i < 16; ++i) {
    const uint8_t weak[6] = {0xfe, 0xff, 0xff, 0xff, 0xff, static_cast<uint8_t>(i)};
    full.heard(weak, -100);
  }
  CHECK(full.frame(14).size() == 294 && full.frame(14).size() < FRAME_MAX);
  const std::string f32(32, 'f');
  CHECK(helloFrame(f32, f32, 100, f32, true, "feffffffffff").size() < FRAME_MAX);

  // The hello says the band's address only when it has one.
  const std::string key = "000102030405060708090a0b0c0d0e0f", id = idFor(key);
  CHECK(helloFrame(id, key, 62, "", false, "02abcdef0123") ==
        "{\"t\":\"wristband\",\"id\":\"" + id + "\",\"key\":\"" + key + "\",\"v\":2,\"battery\":62,\"air\":\"02abcdef0123\"}");
  Wrist w(key);
  w.setBattery(62, 1000);
  w.setAir("02abcdef0123");
  w.linkUp(1000);
  CHECK(w.take() == std::vector<std::string>{helloFrame(id, key, 62, "", false, "02abcdef0123")});

  // It beacons and listens only on the Wi-Fi, paired, and not in NOT NOW.
  CHECK(!w.nearOn());  // not paired
  w.frame("{\"t\":\"paired\",\"secret\":\"" + f32 + "\"}", 1000);
  CHECK(w.nearOn());
  w.frame("{\"t\":\"show\",\"show\":{\"kind\":\"off\",\"quiet\":true}}", 1000);
  CHECK(!w.nearOn());  // NOT NOW from the relay
  w.frame("{\"t\":\"show\",\"show\":{\"kind\":\"off\"}}", 1000);
  CHECK(w.nearOn());
  w.keyDown(1, 2000);
  w.tick(2000 + HOLD_MS);
  CHECK(!w.nearOn());  // NOT NOW from the wrist, before the relay has shown it
  w.keyUp(1, 2000 + HOLD_MS);
  w.frame("{\"t\":\"show\",\"show\":{\"kind\":\"off\"}}", 4000);
  CHECK(w.nearOn());
  w.linkDown(5000);
  CHECK(!w.nearOn());  // off the relay
  w.linkUp(6000);
  CHECK(w.nearOn());
  w.frame("{\"t\":\"show\",\"show\":{\"kind\":\"pairing\",\"code\":\"UDXE\"}}", 6000);
  CHECK(!w.nearOn());  // unpaired
}

void markers() {
  // Three areas, each a word on the console and in a report (relay/room.js MARKS has the same), and a letter on the air.
  CHECK(MARK_AREAS == 3);
  CHECK(markNamed("bar") == 0 && markNamed("stage") == 1 && markNamed("back") == 2);
  CHECK(markNamed("off") == -1 && markNamed("") == -1 && markNamed("BAR") == -1 && markNamed("bar ") == -1);
  CHECK(markLettered('b') == 0 && markLettered('s') == 1 && markLettered('o') == 2);
  CHECK(markLettered('x') == -1 && markLettered('B') == -1 && markLettered(0) == -1 && markLettered('1') == -1);

  // A marker beacons OTBM and its letter, never a band's OTB1, on every channel from 1 to 13 in turn.
  CHECK(Marker(0).beacon() == std::vector<uint8_t>({'O', 'T', 'B', 'M', 'b'}));
  CHECK(Marker(1).beacon() == std::vector<uint8_t>({'O', 'T', 'B', 'M', 's'}));
  CHECK(Marker(2).beacon() == std::vector<uint8_t>({'O', 'T', 'B', 'M', 'o'}));
  CHECK(!std::equal(BEACON, BEACON + 4, MARK_BEACON));
  CHECK(markSweep() == std::vector<int>({1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13}));
  CHECK(std::string(Marker(1).area()) == "stage");

  // `power <dBm>` on a marker's console, for tests: whole dBm from 2 to 20, in the radio's quarter-dBm steps.
  CHECK(markPower("20") == 80 && markPower("2") == 8 && markPower("8") == 32 && markPower("08") == 32);
  for (const char* no : {"1", "21", "0", "", "-5", "8.5", "x", "020", "8 "}) CHECK(markPower(no) == -1);

  // `channel <n>`: 1 to 13 joins only there, 0 any channel as before.
  CHECK(wifiChannel("0") == 0 && wifiChannel("1") == 1 && wifiChannel("6") == 6 && wifiChannel("13") == 13 && wifiChannel("06") == 6);
  for (const char* no : {"14", "", "-1", "6.0", "x", "006", "6 ", "99"}) CHECK(wifiChannel(no) == -1);
  // Pinned, a band joins the strongest point with its network's name on that channel, and no other.
  {
    const std::vector<SeenPoint> seen = {
        {"venue", -40, 1}, {"venue", -70, 6}, {"venue", -55, 6}, {"other", -30, 6}, {"venue", -60, 11}};
    CHECK(pickPinned(seen, "venue", 6) == 2);
    CHECK(pickPinned(seen, "venue", 1) == 0);
    CHECK(pickPinned(seen, "venue", 13) == -1);
    CHECK(pickPinned(seen, "nobody", 6) == -1);
    CHECK(pickPinned({}, "venue", 6) == -1);
  }

  // Its face is dark; a key lights it for WAKE_MS with what it is, in the screen's alphabet.
  Marker m(1);
  CHECK(!m.lit(0) && !m.lit(WAKE_MS));
  m.press(1000);
  CHECK(m.lit(1000) && m.lit(1000 + WAKE_MS - 1) && !m.lit(1000 + WAKE_MS));
  m.press(1000 + WAKE_MS + 5);
  CHECK(m.lit(1000 + 2 * WAKE_MS));
  CHECK(m.words().big == "MARKER" && m.words().small == "BY THE STAGE");
  CHECK(Marker(0).words().small == "NEAR THE BAR" && Marker(2).words().small == "OUT THE BACK");
  for (int i = 0; i < 3; ++i) CHECK(fold(Marker(i).words().small) == Marker(i).words().small);

  // A listen keeps each marker area once, at the strongest of its beacons, and a letter no marker has is nothing.
  Hearing h;
  h.heardMark('s', -80);
  h.heardMark('b', -60);
  h.heardMark('b', -52);
  h.heardMark('b', -70);
  h.heardMark('x', -10);
  h.heardMark('B', -10);
  CHECK(h.size() == 0);  // a marker is never a band
  CHECK(h.frame(6) == "{\"t\":\"heard\",\"ch\":6,\"near\":[],\"marks\":[[\"bar\",-52],[\"stage\",-80]]}");
  // Brought into -100..0, the range the relay takes, as a band's reading is; the strongest first.
  h.heardMark('o', -130);
  h.heardMark('s', 4);
  CHECK(h.frame(6) == "{\"t\":\"heard\",\"ch\":6,\"near\":[],\"marks\":[[\"stage\",0],[\"bar\",-52],[\"back\",-100]]}");
  CHECK(h.marks().size() == 3 && std::string(h.marks()[0].area) == "stage" && h.marks()[0].rssi == 0);
  // Heard no marker, a report says nothing of markers; cleared, a listen has heard none.
  h.clear();
  CHECK(h.marks().empty());
  hear(h, 1, -40);
  CHECK(h.frame(6) == "{\"t\":\"heard\",\"ch\":6,\"near\":[[\"020000000001\",-40]]}");
  hear(h, 2, -45);
  h.heardMark('b', -50);
  CHECK(h.frame(6) == "{\"t\":\"heard\",\"ch\":6,\"near\":[[\"020000000001\",-40],[\"020000000002\",-45]],\"marks\":[[\"bar\",-50]]}");

  // The longest report fits the outbox: HEARD_MAX bands and all three markers, on channel 14.
  Hearing full;
  for (int i = 0; i < 16; ++i) {
    const uint8_t weak[6] = {0xfe, 0xff, 0xff, 0xff, 0xff, static_cast<uint8_t>(i)};
    full.heard(weak, -100);
  }
  for (const char c : {'s', 'o', 'b'}) full.heardMark(c, -100);
  CHECK(full.frame(14).size() == 346 && full.frame(14).size() < FRAME_MAX);
}

// ---------- speak: this code, in front of the real relay ----------

std::string quote(const std::string& s) {
  std::string out = "\"";
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { out += '\\'; out += static_cast<char>(c); }
    else if (c < 0x20) { char u[8]; std::snprintf(u, sizeof u, "\\u%04x", c); out += u; }
    else out += static_cast<char>(c);
  }
  return out + "\"";
}

std::string hex(Rgb c) {
  char b[8];
  std::snprintf(b, sizeof b, "#%02X%02X%02X", c.r, c.g, c.b);
  return b;
}

std::string answer(const Command& c) {
  if (c.verb == "key") {
    std::random_device rd;
    return makeKey([&rd] { return static_cast<uint32_t>(rd()); });
  }
  if (c.verb == "idfor") return idFor(c.arg);
  if (c.verb == "sha256") {
    const std::vector<uint8_t> bytes = hexBytes(c.arg);
    const uint8_t none[1] = {0};
    return sha256Hex(bytes.empty() ? none : bytes.data(), bytes.size());
  }
  if (c.verb == "hello") {
    // hello <key> <battery> [secret|-] [quiet|-] [air]
    std::istringstream in(c.arg);
    std::string key, secret, quiet, air;
    int battery = -1;
    in >> key >> battery >> secret >> quiet >> air;
    return helloFrame(idFor(key), key, battery, secret == "-" ? "" : secret, quiet == "quiet", air);
  }
  if (c.verb == "heard") {
    // heard <ch> [<air>:<rssi> ...] [<letter>=<rssi> ...]: one listen, bands and markers, reported as the band reports it
    std::istringstream in(c.arg);
    int ch = 0;
    in >> ch;
    Hearing h;
    std::string one;
    while (in >> one) {
      if (one.size() > 2 && one[1] == '=') {
        h.heardMark(static_cast<uint8_t>(one[0]), std::atoi(one.c_str() + 2));
        continue;
      }
      const size_t colon = one.find(':');
      const std::vector<uint8_t> mac = hexBytes(one.substr(0, colon));
      if (colon == std::string::npos || mac.size() != 6) return "bad " + one;
      h.heard(mac.data(), std::atoi(one.c_str() + colon + 1));
    }
    return h.frame(ch);
  }
  if (c.verb == "levels") {
    // levels <s,s,...>: whole blocks of samples through one Levels, and each block's five levels
    std::vector<int16_t> s;
    std::istringstream in(c.arg);
    std::string one;
    while (std::getline(in, one, ',')) s.push_back(static_cast<int16_t>(std::atoi(one.c_str())));
    Levels lv;
    std::string out = "[";
    for (size_t b = 0; b + BEAT_BLOCK <= s.size(); b += BEAT_BLOCK) {
      const BandLevels l = lv.block(s.data() + b);
      out += b ? ",[" : "[";
      for (size_t k = 0; k < BEAT_BANDS; ++k) {
        char n[32];
        std::snprintf(n, sizeof n, "%s%.3f", k ? "," : "", static_cast<double>(l.v[k]));
        out += n;
      }
      out += "]";
    }
    return out + "]";
  }
  if (c.verb == "battery") return batteryFrame(std::atoi(c.arg.c_str()));
  if (c.verb == "hold") return HOLD_FRAME;
  if (c.verb == "refuse") return refuseFrame(c.arg);
  if (c.verb == "ping") return PING_FRAME;
  auto cardWordsJson = [] {
    std::string out = "{";
    for (const Hue& h : CARDS) out += std::string(out.size() > 1 ? "," : "") + quote(h.id) + ":" + quote(h.words);
    return out + "}";
  };
  if (c.verb == "consts") {
    // Every constant the table's times are written in, by name, as app/lib/wrist.js CONSTS has them.
    return "{\"WAKE_MS\":" + std::to_string(WAKE_MS) + ",\"HOLD_MS\":" + std::to_string(HOLD_MS) +
           ",\"BAR_MS\":" + std::to_string(BAR_MS) + ",\"CHOOSE_MS\":" + std::to_string(CHOOSE_MS) +
           ",\"COMMIT_MS\":" + std::to_string(COMMIT_MS) + ",\"CONFIRM_MS\":" + std::to_string(CONFIRM_MS) +
           ",\"RESULT_MS\":" + std::to_string(RESULT_MS) + ",\"PING_EVERY_MS\":" + std::to_string(PING_EVERY_MS) +
           ",\"DEAF_MS\":" + std::to_string(DEAF_MS) + ",\"STALE_MS\":" + std::to_string(STALE_MS) +
           ",\"QUIET_CONFIRM_MS\":" + std::to_string(QUIET_CONFIRM_MS) + ",\"BLINK_MS\":" + std::to_string(BLINK_MS) +
           ",\"HINT_MS\":" + std::to_string(HINT_MS) + ",\"PAIR_AWAKE_MS\":" + std::to_string(PAIR_AWAKE_MS) +
           ",\"LIGHT_FULL\":" + std::to_string(LIGHT_FULL) +
           ",\"LIGHT_DIM\":" + std::to_string(LIGHT_DIM) + ",\"LIGHT_PAIR\":" + std::to_string(LIGHT_PAIR) +
           ",\"LIGHT_AWAKE\":" + std::to_string(LIGHT_AWAKE) + ",\"LIGHT_OFF\":" + std::to_string(LIGHT_OFF) +
           ",\"CARD_WORDS\":" + cardWordsJson() + "}";
  }
  if (c.verb == "sounds") {
    // SOUNDS, as app/lib/wrist.js has it: {"tick":[[1800,25]],...}
    std::string out = "{";
    for (const Sound& s : SOUNDS) {
      out += std::string(out.size() > 1 ? "," : "") + quote(s.name) + ":[";
      for (size_t i = 0; i < s.count; ++i)
        out += std::string(i ? "," : "") + "[" + std::to_string(s.notes[i].hz) + "," + std::to_string(s.notes[i].ms) + "]";
      out += "]";
    }
    return out + "}";
  }
  if (c.verb == "flashes") {
    // FLASHES, as app/lib/wrist.js has it: {"set":{"colour":"card","count":2,"on":150,"off":100},...}
    std::string out = "{";
    for (const Flash& f : FLASHES)
      out += std::string(out.size() > 1 ? "," : "") + quote(f.name) + ":{\"colour\":" + quote(f.colour) +
             ",\"count\":" + std::to_string(f.count) + ",\"on\":" + std::to_string(f.on) + ",\"off\":" + std::to_string(f.off) + "}";
    return out + "}";
  }
  if (c.verb == "flashcolours") {
    // The flash fields, as app/lib/wrist.js FLASH_COLOURS has them.
    return "{\"red\":" + quote(hex(*plainField("red"))) + ",\"orange\":" + quote(hex(*plainField("orange"))) + "}";
  }
  if (c.verb == "hues") {
    std::string out = "{";
    for (const Hue& h : CARDS)
      out += std::string(out.size() > 1 ? "," : "") + quote(h.id) + ":{\"c\":" + quote(hex(h.c)) + ",\"g\":" + quote(hex(h.g)) + "}";
    return out + "}";
  }
  if (c.verb == "cards") {
    // CARDS in order, and where SIDE steps from each: ["hi","song","dance"] and {"hi":"song",...,"off":"hi"}. The arg
    // is a show's closed cards ("song,dance"), which SIDE steps over.
    std::string order = "[", steps = "{";
    for (const Hue& h : CARDS) {
      order += std::string(order.size() > 1 ? "," : "") + quote(h.id);
      steps += std::string(steps.size() > 1 ? "," : "") + quote(h.id) + ":" + quote(cardAfter(h.id, c.arg));
    }
    return "{\"order\":" + order + "],\"after\":" + steps + ",\"off\":" + quote(cardAfter("off", c.arg)) + "}}";
  }
  if (c.verb == "relay") {
    const Relay r = parseRelay(c.arg);
    return std::string("{\"ok\":") + (r.ok ? "true" : "false") + ",\"origin\":" + quote(r.origin) + "}";
  }
  if (c.verb == "pairurl") {
    const size_t sp = c.arg.find(' ');
    return pairUrl(c.arg.substr(0, sp), sp == std::string::npos ? "" : c.arg.substr(sp + 1));
  }
  if (c.verb == "show") {
    Frame f;
    if (!readFrame(c.arg, f) || !f.hasShow) return "null";
    const Show& s = f.show;
    const Face face = faceFor(&s, false, false);
    const Words w = wordsFor(face, false, -1, Signal::LIVE);
    return "{\"kind\":" + quote(s.kind) + ",\"intent\":" + quote(s.intent) + ",\"big\":" + quote(s.big) +
           ",\"small\":" + quote(s.small) + ",\"code\":" + quote(s.code) + ",\"dim\":" + (s.dim ? "true" : "false") +
           ",\"quiet\":" + (s.quiet ? "true" : "false") + ",\"away\":" + (s.away ? "true" : "false") +
           ",\"hasArmed\":" + (s.hasArmed ? "true" : "false") + ",\"armed\":" + quote(s.armed) +
           ",\"rev\":" + std::to_string(s.rev) + ",\"lit\":" + (lit(s) ? "true" : "false") +
           ",\"light\":" + std::to_string(lightFor(face, false)) + ",\"words\":{\"big\":" + quote(w.big) +
           ",\"small\":" + quote(w.small) + "}}";
  }
  return "?";
}

/**
 * `logic_test wrist`: the table's line protocol (tests/wrist-table.js). The
 * first line is `key <hex>`; every other line is `<t> <what>` and is answered
 * with one line: `{}` for `heard`, else what was sent and the screen.
 */
int runWrist() {
  std::unique_ptr<Wrist> w;
  std::string line;
  while (std::getline(std::cin, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    std::istringstream in(line);
    std::string first, verb, arg;
    in >> first;
    if (first == "key") {
      in >> arg;
      w.reset(new Wrist(arg));
      continue;
    }
    if (!w) return 2;
    const uint32_t t = static_cast<uint32_t>(std::stoul(first));
    in >> verb;
    std::getline(in, arg);
    if (!arg.empty() && arg[0] == ' ') arg.erase(0, 1);
    if (verb == "heard") {
      w->heard(t);
      std::cout << "{}\n";
      continue;
    }
    w->tick(t);
    if (verb == "up") w->linkUp(t);
    else if (verb == "down") w->linkDown(t);
    else if (verb == "key1" || verb == "key2") {
      const int k = verb == "key1" ? 1 : 2;
      if (arg == "down") w->keyDown(k, t);
      else w->keyUp(k, t);
    }
    else if (verb == "frame") w->frame(arg, t);
    else if (verb == "battery") w->setBattery(std::atoi(arg.c_str()), t);
    else if (verb == "wifi") w->setWifi(arg == "1");
    std::string sent, sounds;
    for (const std::string& f : w->take()) sent += (sent.empty() ? "" : ",") + (f == "DROP" || f == "SETUP" ? quote(f) : f);
    for (const std::string& n : w->sounds()) sounds += (sounds.empty() ? "" : ",") + quote(n);
    const Screen s = w->face(t);
    std::cout << "{\"sent\":[" << sent << "],\"sounds\":[" << sounds << "],\"face\":{\"big\":" << quote(s.big) << ",\"small\":" << quote(s.small)
              << ",\"field\":" << quote(s.field) << ",\"ink\":" << quote(s.ink) << ",\"light\":" << int(s.light)
              << ",\"bar\":" << s.bar << ",\"code\":" << quote(s.code) << ",\"corner\":" << quote(s.corner) << "}}\n";
  }
  return 0;
}

void turning() {
  // The two sides, as the console takes them and says them: USB left is 0, USB right is 1.
  CHECK(turnNamed("usb-left") == 0 && turnNamed("usb-right") == 1);
  // Anything else is refused, and so is the auto a build before 28 Sep 2026 kept: it is read as USB left.
  CHECK(turnNamed("auto") == -1 && turnNamed("") == -1 && turnNamed("left") == -1 && turnNamed("USB-LEFT") == -1);
  CHECK(std::string(turnName(false)) == "usb-left" && std::string(turnName(true)) == "usb-right");
  // A frame goes over the console in base64, padded as the standard says.
  const uint8_t man[] = {'M', 'a', 'n'};
  CHECK(toBase64(man, 3) == "TWFu" && toBase64(man, 2) == "TWE=" && toBase64(man, 1) == "TQ==" && toBase64(man, 0).empty());
  const uint8_t edge[] = {0xff, 0x00, 0x10, 0xfb, 0xef};
  CHECK(toBase64(edge, 5) == "/wAQ++8=");
}

void power() {
  // FACE and SIDE held together for OFF_HOLD_MS turn the band off; one key alone never does.
  CHECK(OFF_HOLD_MS > HOLD_MS && OFF_BAR_MS < OFF_HOLD_MS && OFF_SAY_MS < OFF_SHOW_MS);
  CHECK(offFrame() == "{\"t\":\"off\"}");
  PowerOff p;
  CHECK(!p.keys(true, false, 0) && !p.keys(false, true, 50) && !p.showing(50));
  CHECK(p.keys(true, true, 100));        // both down: the Wrist is told, once
  CHECK(!p.keys(true, true, 101));
  CHECK(!p.showing(100 + OFF_BAR_MS - 1) && p.showing(100 + OFF_BAR_MS));
  const Screen holding = p.face(100 + OFF_HOLD_MS / 2);
  CHECK(holding.big == "POWER OFF" && holding.small == "KEEP HOLDING" && holding.bar == 50 && holding.light == LIGHT_AWAKE);
  p.keys(true, true, 100 + OFF_HOLD_MS - 1);
  CHECK(!p.going());
  p.keys(true, true, 100 + OFF_HOLD_MS);
  CHECK(p.going() && !p.keys(true, true, 100 + OFF_HOLD_MS + 1));
  const Screen gone = p.face(100 + OFF_HOLD_MS);
  CHECK(gone.big == "POWER OFF" && gone.small == "POWER BUTTON: ON" && gone.bar == -1);
  // The relay is told once; the socket goes after OFF_SAY_MS, the power after OFF_SHOW_MS.
  const uint32_t at = 100 + OFF_HOLD_MS;
  CHECK(p.sayOff() && !p.sayOff());
  CHECK(!p.dropDue(at + OFF_SAY_MS - 1) && p.dropDue(at + OFF_SAY_MS));
  CHECK(!p.cutDue(at + OFF_SHOW_MS - 1) && p.cutDue(at + OFF_SHOW_MS));
  // Let go of either key before the end, and the hold starts again from nothing.
  PowerOff q;
  q.keys(true, true, 0);
  q.keys(true, false, OFF_HOLD_MS - 10);
  CHECK(!q.showing(OFF_HOLD_MS - 10));
  CHECK(q.keys(true, true, OFF_HOLD_MS));
  q.keys(true, true, 2 * OFF_HOLD_MS - 1);
  CHECK(!q.going() && !q.sayOff());
  // The power button's hold, or `off` on the console, starts it at once.
  PowerOff r;
  r.start(500);
  CHECK(r.going() && r.showing(500) && r.cutDue(500 + OFF_SHOW_MS));
  // Plugged in, the chip would turn itself straight back on: the face says to unplug, and the band stays on.
  PowerOff u;
  u.keys(true, true, 0, true);
  u.keys(true, true, OFF_HOLD_MS, true);
  CHECK(!u.going() && !u.sayOff() && u.showing(OFF_HOLD_MS));
  const Screen unplug = u.face(OFF_HOLD_MS);
  CHECK(unplug.big == "UNPLUG" && unplug.small == "TO TURN IT OFF" && unplug.bar == -1);
  // Still held, it does not ask again, and the face goes back to the wrist's once it has been read.
  u.keys(true, true, OFF_HOLD_MS + OFF_SHOW_MS, true);
  CHECK(!u.going() && !u.showing(OFF_HOLD_MS + OFF_SHOW_MS));
  // Let go and held again, unplugged now: off.
  u.keys(false, false, 10000);
  CHECK(u.keys(true, true, 10001));
  u.keys(true, true, 10001 + OFF_HOLD_MS);
  CHECK(u.going());
  PowerOff v;
  v.start(0, true);
  CHECK(!v.going() && v.showing(0) && v.face(0).big == "UNPLUG");

  // Both down on the wrist: FACE's own hold (NOT NOW) never fires, and letting go does nothing.
  Wrist w("000102030405060708090a0b0c0d0e0f");
  w.linkUp(0);
  w.frame("{\"t\":\"show\",\"show\":{\"kind\":\"off\",\"armed\":null,\"rev\":1}}", 0);
  w.take();
  // Pings go on whatever the keys do: what matters is that nothing else is said.
  const auto said = [&w]() {
    std::vector<std::string> v = w.take();
    v.erase(std::remove(v.begin(), v.end(), std::string(PING_FRAME)), v.end());
    return v;
  };
  w.keyDown(1, 1000);
  w.keyDown(2, 1200);
  w.bothDown(1200);
  w.tick(1000 + HOLD_MS + 500);
  CHECK(said().empty());
  CHECK(w.face(1000 + HOLD_MS + 500).bar == -1);
  w.heard(1000 + OFF_HOLD_MS);  // the relay still answers: a drop for silence is not what this is about
  w.keyUp(1, 1000 + OFF_HOLD_MS);
  w.keyUp(2, 1000 + OFF_HOLD_MS);
  w.tick(1000 + OFF_HOLD_MS + COMMIT_MS + 100);
  CHECK(said().empty());

  // Nobody's, unplugged and untouched for IDLE_OFF_MS, it turns itself off; any use starts the count again.
  CHECK(IDLE_OFF_MS == 30u * 60u * 1000u);
  PowerOff idle;
  CHECK(!idle.idleDue(IDLE_OFF_MS - 1) && idle.idleDue(IDLE_OFF_MS));
  idle.used(IDLE_OFF_MS - 1);
  CHECK(!idle.idleDue(2 * IDLE_OFF_MS - 2) && idle.idleDue(2 * IDLE_OFF_MS - 1));
  idle.start(2 * IDLE_OFF_MS);
  CHECK(!idle.idleDue(3 * IDLE_OFF_MS));  // once going, it is not asked again
  // The count is across the clock's wrap, as every other one is.
  PowerOff wrap;
  wrap.used(0xFFFFFFFFu - 1000);
  CHECK(!wrap.idleDue(IDLE_OFF_MS - 2000) && wrap.idleDue(IDLE_OFF_MS));
  // Paired, or on the check, is somebody's; a band showing only its letters is nobody's.
  Wrist mine("000102030405060708090a0b0c0d0e0f");
  mine.linkUp(0);
  CHECK(!mine.owned());
  mine.frame("{\"t\":\"show\",\"show\":{\"kind\":\"check\",\"big\":\"42\",\"rev\":1}}", 0);
  CHECK(mine.owned());
  mine.frame("{\"t\":\"paired\",\"secret\":\"" + std::string(32, 'a') + "\"}", 0);
  mine.frame("{\"t\":\"show\",\"show\":{\"kind\":\"off\",\"armed\":null,\"rev\":2}}", 0);
  CHECK(mine.owned());
  mine.frame("{\"t\":\"show\",\"show\":{\"kind\":\"pairing\",\"code\":\"ABCD\",\"rev\":3}}", 0);
  CHECK(!mine.owned());

  // `hold both` on the console holds both keys long enough to turn the band off.
  const KeyPress both = pressFor(readCommand("hold both"));
  CHECK(both.key == 3 && both.ms > OFF_HOLD_MS);
  CHECK(pressFor(readCommand("press both")).key == 3);
}

void wifiSetup() {
  // Letters off the pairing alphabet's rules, and a draw that would bias them is drawn again.
  uint32_t n = 0;
  const std::string pass = setupLetters(SETUP_PASS_LEN, [&n] { return n++ * 2654435761u; });
  CHECK(pass.size() == static_cast<size_t>(SETUP_PASS_LEN));
  CHECK(pass.find_first_not_of("ABCDEFGHJKMNPQRSTUVWXYZ23456789") == std::string::npos);
  std::vector<uint32_t> draws = {0xFFFFFFFFu, 0u, 30u};
  size_t d = 0;
  CHECK(setupLetters(2, [&] { return draws[d++]; }) == "A9" && d == 3);
  uint32_t m = 7;
  CHECK(setupLetters(SETUP_PASS_LEN, [&m] { return m = m * 1103515245u + 12345u; }) != pass);

  // The join code escapes what its format reserves.
  CHECK(wifiQr("OTB-ABCD", "K7Q2M9XPAB") == "WIFI:T:WPA;S:OTB-ABCD;P:K7Q2M9XPAB;;");
  const std::string bs(1, char(92));  // one backslash, spelled so no editor can fold it
  CHECK(wifiQr("a;b,c:d" + bs + "e\"f", "x") ==
        "WIFI:T:WPA;S:a" + bs + ";b" + bs + ",c" + bs + ":d" + bs + bs + "e" + bs + "\"f;P:x;;");

  // What can be kept.
  CHECK(setupCheck("Rae's phone", "hunter2hunter2").empty());
  CHECK(setupCheck("Open cafe", "").empty());
  CHECK(setupCheck("x", std::string(64, 'a')).empty());  // a 64-digit key
  CHECK(!setupCheck("", "hunter2hunter2").empty());
  CHECK(!setupCheck(std::string(33, 'x'), "hunter2hunter2").empty());
  CHECK(!setupCheck("x", "short").empty());
  CHECK(!setupCheck("x", std::string(64, 'z')).empty());
  CHECK(!setupCheck("x", std::string(65, 'a')).empty());
  CHECK(!setupCheck("bad\nname", "hunter2hunter2").empty());
  CHECK(!setupCheck("x", "tab\there12").empty());

  // A name heard over the air is only ever words in the page.
  const std::vector<SeenNet> heard = {
      {"<script>alert(1)</script>", -50, false}, {"Rae\"s \"phone\"", -80, true}, {"", -30, false}, {"Home", -70, false},
      {"Home", -55, false}};
  const std::string page = setupPage(heard, "Home", "<b>no</b>");
  CHECK(page.find("<script>") == std::string::npos && page.find("&lt;script&gt;alert(1)&lt;/script&gt;") != std::string::npos);
  CHECK(page.find("value=\"Rae&quot;s &quot;phone&quot;\"") != std::string::npos);
  CHECK(page.find("<b>no</b>") == std::string::npos && page.find("&lt;b&gt;no&lt;/b&gt;") != std::string::npos);
  CHECK(page.find("value=\"Home\" selected>Home - strong<") != std::string::npos);  // at its strongest, once
  CHECK(page.find("Home - fair") == std::string::npos);
  CHECK(page.find("phone&quot; - weak, open") != std::string::npos);
  CHECK(page.find("It joins Home now.") != std::string::npos);
  CHECK(savedPage("<x>").find("<x>") == std::string::npos);
  // It says the way back in that the band has: a SIDE hold on NO WI-FI, not a start-up hold it no longer has.
  CHECK(savedPage("x").find("hold its side button there") != std::string::npos);
  CHECK(savedPage("x").find("both buttons") == std::string::npos);

  const std::vector<SeenNet> listed = setupList(heard);
  CHECK(listed.size() == 3 && listed[0].ssid[0] == '<' && listed[1].ssid == "Home" && listed[1].rssi == -55);
  std::vector<SeenNet> many;
  for (int i = 0; i < 30; ++i) many.push_back({"n" + std::to_string(i), -90 + i, false});
  CHECK(setupList(many).size() == 20 && setupList(many)[0].ssid == "n29");

  CHECK(setupChosen("", "Home") == "Home" && setupChosen("Typed", "Home") == "Typed");

  // SIDE still held as it starts: a press leaves only after both are let go, and never once a network is kept.
  SetupMode s;
  s.begin(1000);
  CHECK(!s.keys(true, true) && !s.keys(true, false));
  CHECK(!s.keys(false, false));
  CHECK(s.keys(false, true));
  SetupMode t;
  t.begin(0);
  CHECK(!t.idleDue(SETUP_IDLE_MS - 1) && t.idleDue(SETUP_IDLE_MS));
  t.asked(5000);
  CHECK(!t.idleDue(SETUP_IDLE_MS) && t.idleDue(5000 + SETUP_IDLE_MS));
  t.keys(false, false);
  t.saved(6000);
  CHECK(t.isSaved() && !t.keys(true, false) && !t.idleDue(6000 + SETUP_IDLE_MS));
  CHECK(!t.restartDue(6000 + SETUP_SAVED_MS - 1) && t.restartDue(6000 + SETUP_SAVED_MS));
  // The page is asked for inside a turn of the loop, a moment after that turn read the time. Found on the
  // first real band: a laptop's captive check fetched the page, and the band at once called it ten minutes idle.
  SetupMode u;
  u.begin(1000);
  u.asked(1005);
  CHECK(!u.idleDue(1000) && !u.idleDue(1004));
  u.saved(2005);
  CHECK(!u.restartDue(2000));
  SetupMode v;  // and across the counter wrapping, as everything else here
  v.begin(0xFFFFFF00u);
  CHECK(!v.idleDue(0x00000100u) && v.idleDue(0xFFFFFF00u + SETUP_IDLE_MS));
}

}  // namespace

int main(int argc, char** argv) {
  if (argc > 1 && std::string(argv[1]) == "wrist") return runWrist();
  if (argc > 1 && std::string(argv[1]) == "speak") {
    std::string line;
    while (std::getline(std::cin, line)) std::cout << answer(readCommand(line)) << "\n";
    return 0;
  }
  wrist();
  link();
  quiet();
  battery();
  frames();
  text();
  face();
  colour();
  sound();
  pairing();
  relay();
  rejoin();
  console();
  said();
  hearing();
  markers();
  turning();
  power();
  wifiSetup();
  std::printf("ok: %d checks\n", checks);
  return 0;
}
