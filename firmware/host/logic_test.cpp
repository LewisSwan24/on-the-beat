// ON THE BEAT — the wristband's logic, run on a laptop.
//
//   logic_test            every check below; exits non-zero on the first that fails
//   logic_test speak      reads commands on stdin, one per line, and answers each
//                         with one line: how tests/firmware.test.js puts this code
//                         in front of the real relay
//
// Built and run by tests/firmware.test.js. By hand:
//   c++ -std=c++17 -Wall -Wextra -o /tmp/logic firmware/host/logic_test.cpp && /tmp/logic

#include <cstdio>
#include <iostream>
#include <random>
#include <sstream>
#include <string>

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

void button() {
  Button b;
  CHECK(b.update(false, 0) == Button::NONE);
  CHECK(b.update(true, 100) == Button::NONE);
  CHECK(b.update(true, 1099) == Button::NONE);
  CHECK(b.update(false, 1099) == Button::WAKE);  // a press, let go before a second: wake
  CHECK(b.update(true, 2000) == Button::NONE);
  CHECK(b.update(true, 3000) == Button::HOLD);   // a second held: NOT NOW, while still held
  CHECK(b.update(true, 9000) == Button::NONE);   // once
  CHECK(b.update(false, 9001) == Button::NONE);  // and letting go is not also a wake
  // Across the millisecond counter wrapping, after 49 days on.
  CHECK(b.update(true, 0xFFFFFE00u) == Button::NONE);
  CHECK(b.update(true, 0x000002FFu) == Button::HOLD);
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
  CHECK(wordsFor(f, true, 62, Signal::LIVE).big == "READY");
  f = faceFor(&song, true, true);  // and held with no relay in reach, a press says so
  CHECK(f.show.quiet && f.offline && wordsFor(f, true, 62, Signal::NO_WIFI).big == "NO SIGNAL");
  f = faceFor(&song, true, false);  // the relay out of reach: not believed
  CHECK(f.show.kind == "off" && f.offline && lightFor(f, false) == LIGHT_OFF);
  CHECK(wordsFor(f, false, 62, Signal::NO_RELAY).big.empty());
  w = wordsFor(f, true, 62, Signal::NO_RELAY);
  CHECK(w.big == "NO SIGNAL" && w.small == "NO RELAY - 62%");
  CHECK(wordsFor(f, true, -1, Signal::NO_WIFI).small == "NO WI-FI");
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

  Command c = readCommand("  RELAY https://x.example\r\n");
  CHECK(c.verb == "relay" && c.arg == "https://x.example");
  c = readCommand("pass  two words ");  // a password keeps its spaces
  CHECK(c.verb == "pass" && c.arg == " two words ");
  c = readCommand("show");
  CHECK(c.verb == "show" && c.arg.empty());
  CHECK(readCommand("   ").verb.empty());
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
    // hello <key> <battery> [secret|-] [quiet]
    std::istringstream in(c.arg);
    std::string key, secret, quiet;
    int battery = -1;
    in >> key >> battery >> secret >> quiet;
    return helloFrame(idFor(key), key, battery, secret == "-" ? "" : secret, quiet == "quiet");
  }
  if (c.verb == "battery") return batteryFrame(std::atoi(c.arg.c_str()));
  if (c.verb == "hold") return HOLD_FRAME;
  if (c.verb == "ping") return PING_FRAME;
  if (c.verb == "hues") {
    std::string out = "{";
    for (const Hue& h : HUES)
      out += std::string(out.size() > 1 ? "," : "") + quote(h.id) + ":{\"c\":" + quote(hex(h.c)) + ",\"g\":" + quote(hex(h.g)) + "}";
    return out + "}";
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
           ",\"quiet\":" + (s.quiet ? "true" : "false") + ",\"lit\":" + (lit(s) ? "true" : "false") +
           ",\"light\":" + std::to_string(lightFor(face, false)) + ",\"words\":{\"big\":" + quote(w.big) +
           ",\"small\":" + quote(w.small) + "}}";
  }
  return "?";
}

}  // namespace

int main(int argc, char** argv) {
  if (argc > 1 && std::string(argv[1]) == "speak") {
    std::string line;
    while (std::getline(std::cin, line)) std::cout << answer(readCommand(line)) << "\n";
    return 0;
  }
  button();
  link();
  quiet();
  battery();
  frames();
  text();
  face();
  colour();
  pairing();
  relay();
  said();
  std::printf("ok: %d checks\n", checks);
  return 0;
}
