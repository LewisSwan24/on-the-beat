// ON THE BEAT — the wristband: an M5StickC Plus, Plus2 or StickS3 on a strap.
//
// A light first and words second, with a chirp unless its person has switched
// that off. It joins the relay exactly as /band does, shows whatever the relay
// tells it to, and has two buttons. The face button (KEY1): a press wakes it,
// a hold is NOT NOW. The side button (KEY2): a press shows the card that is
// armed, more presses choose another, and the relay decides. What it shows is
// decided by the relay (relay/band.js), from the same view its person's phone
// is sent, so it can never show more than the phone could.
//
// Everything that decides anything is in band_logic.h, which the tests build
// and run on a laptop. This file is only the hardware round it: the screen,
// the speaker, the two buttons, the battery, Wi-Fi, the socket, and a serial
// console to say which Wi-Fi and which relay. The socket has a task of its
// own, so nothing the network does can hold up the button or the screen.

#include <M5Unified.h>
#include <Preferences.h>
#include <WebSocketsClient.h>
#include <WiFi.h>

#include <algorithm>
#include <atomic>
#include <cstring>
#include <mutex>
#include <string>
#include <vector>

#include "band_logic.h"

// Wi-Fi and the relay can be built in (copy secrets.example.h to secrets.h),
// or typed at the serial console, which keeps them across restarts.
#if __has_include("secrets.h")
#include "secrets.h"
#endif
#ifndef OTB_WIFI_SSID
#define OTB_WIFI_SSID ""
#endif
#ifndef OTB_WIFI_PASS
#define OTB_WIFI_PASS ""
#endif
#ifndef OTB_RELAY
#define OTB_RELAY ""
#endif

using namespace otb;

namespace {

Preferences prefs;
WebSocketsClient socket_;
M5Canvas face(&M5.Display);  // drawn off-screen, then pushed whole: no half-drawn frames on the wrist

std::string ssid, pass, relayText;
Relay relay;

Wrist* wrist = nullptr;  // made in setup(), once the radio is on and the key is truly random
bool keyA = false, keyB = false;  // KEY1 (BtnA, the face) and KEY2 (BtnB, the side), as last read
uint32_t consoleKeyUntil[3] = {0, 0, 0};  // KEY1 and KEY2 pressed from the console: down until then; 0 is up
BatteryReport batteryReport;
Rejoin rejoin;
std::atomic<uint8_t> wifiWhy{0};  // why the radio last dropped, as the Wi-Fi task heard it; 0 until it has
bool onWifi = false;              // joined, as the console last said
std::string shown;                // what the console last said about a show

int battery = -1;       // percent, or -1 while it will not say
uint32_t batteryAt = 0;
std::string drawn;      // what is on the screen now, so it is drawn again only when that changes
int lit = -1;           // the backlight as last set
std::string typed;      // the console line so far

// Sounds play from buffers of their own, on the speaker's own task. playRaw()
// reads a buffer for as long as it plays, so there are two, used in turn, and
// one is written again only once the speaker has let it go.
constexpr int SOUND_CHANNEL = 0;
bool speaker = false;                   // the first M5StickC has none: it only lights up
uint8_t soundBuf[2][SOUND_SAMPLES];
std::atomic<bool> soundHeld[2];         // a sound on this buffer the speaker has not let go of yet
int soundNext = 0;                      // the buffer the next sound goes in
std::string soundDue;                   // the newest sound not started yet

constexpr uint16_t BLACK = 0x0000;
constexpr uint16_t WHITE = 0xFFFF;

const lgfx::IFont* const BIG[] = {&lgfx::fonts::FreeSansBold18pt7b, &lgfx::fonts::FreeSansBold12pt7b,
                                  &lgfx::fonts::FreeSansBold9pt7b};
const lgfx::IFont* const SMALL[] = {&lgfx::fonts::FreeSansBold9pt7b, &lgfx::fonts::Font2, &lgfx::fonts::Font0};
const lgfx::IFont* const CODE[] = {&lgfx::fonts::FreeMonoBold18pt7b, &lgfx::fonts::FreeMonoBold12pt7b,
                                   &lgfx::fonts::FreeMonoBold9pt7b};
const lgfx::IFont* const NUMBER = &lgfx::fonts::FreeSansBold24pt7b;

// ---------- settings ----------

std::string setting(const char* key, const char* fallback) {
  if (!prefs.isKey(key)) return fallback;
  return prefs.getString(key, fallback).c_str();
}

void loadSettings() {
  ssid =setting("ssid", OTB_WIFI_SSID);
  pass = setting("pass", OTB_WIFI_PASS);
  relayText = setting("relay", OTB_RELAY);
}

// ---------- the socket, on a task of its own ----------
//
// Connecting can block: five seconds for TCP, and up to two minutes for a TLS
// handshake that a captive portal never finishes. On the loop, that would
// freeze the button and the screen — a hold would not go dark, and a face the
// relay can no longer vouch for would not either. So the socket lives on its
// own task, and the two talk only through queues: the loop never waits on the
// network, and only the socket task ever touches the socket.

enum : uint8_t { EV_OPENED, EV_CLOSED, EV_TEXT, EV_HEARD };
struct Event {
  uint8_t kind;
  uint16_t length;  // EV_TEXT: its length; a frame longer than text[] is heard, not read
  char text[480];
};

enum : uint8_t { OUT_SEND, OUT_DROP };
struct Out {
  uint8_t kind;
  char text[256];  // a hello with its key, secret and quiet is about 190 bytes
};

QueueHandle_t events = nullptr;  // socket task -> loop
QueueHandle_t outbox = nullptr;  // loop -> socket task
std::mutex relayLock;            // the loop writes `relay`; the socket task copies it under this
std::atomic<bool> relayChanged{false};

void post(uint8_t kind, const uint8_t* text = nullptr, size_t length = 0) {
  Event e;
  e.kind = kind;
  e.length = static_cast<uint16_t>(std::min<size_t>(length, 0xFFFF));
  if (text && length <= sizeof e.text) memcpy(e.text, text, length);
  // Waits rather than drops: a show that never arrived would leave the wrist wrong until the next.
  xQueueSend(events, &e, portMAX_DELAY);
}

/** Hands the socket task a frame to send, or the socket to drop. False if it could not take it. */
bool toSocket(uint8_t kind, const std::string& text = "") {
  Out o;
  o.kind = kind;
  const size_t n = std::min(text.size(), sizeof o.text - 1);
  memcpy(o.text, text.data(), n);
  o.text[n] = 0;
  return xQueueSend(outbox, &o, 0) == pdTRUE;
}

std::vector<std::string> waitingOut;  // what the Wrist said to send, and the outbox could not take yet, oldest first

/**
 * Hands the socket task what is waiting, oldest first, until it cannot take
 * more. Called every time round the loop, not only when there is something
 * new: after a drop the Wrist says nothing until the next hello, so a drop the
 * outbox could not take would otherwise wait for good.
 */
void flushOut() {
  while (!waitingOut.empty()) {
    const std::string& next = waitingOut.front();
    const bool taken = next == "DROP" ? toSocket(OUT_DROP) : toSocket(OUT_SEND, next);
    if (!taken) return;
    const std::string line = saidLine(next);
    if (!line.empty()) Serial.println(line.c_str());
    waitingOut.erase(waitingOut.begin());
  }
}

/** A frame to send, or "DROP" to drop the socket, in the order the Wrist said them. */
void sendFrame(const std::string& text) {
  waitingOut.push_back(text);
  flushOut();
}

// Runs on the socket task, inside socket_.loop().
void onSocket(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      // Nothing queued for the last socket goes to this one. The loop sends the hello first.
      xQueueReset(outbox);
      post(EV_OPENED);
      break;
    case WStype_DISCONNECTED:
      post(EV_CLOSED);
      break;
    case WStype_TEXT:
      post(EV_TEXT, payload, length);
      break;
    case WStype_PING:
    case WStype_PONG:
      post(EV_HEARD);
      break;
    default:
      break;
  }
}

void socketTask(void*) {
  Relay mine;
  for (;;) {
    if (relayChanged.exchange(false)) {
      socket_.disconnect();
      {
        std::lock_guard<std::mutex> hold(relayLock);
        mine = relay;
      }
      if (mine.ok) {
        if (mine.secure) {
#ifdef OTB_RELAY_CA
          socket_.beginSslWithCA(mine.host.c_str(), mine.port, WS_PATH, OTB_RELAY_CA);
#else
          // Encrypted, but the relay's certificate is not checked: set OTB_RELAY_CA in secrets.h for that.
          socket_.beginSSL(mine.host.c_str(), mine.port, WS_PATH);
#endif
        } else {
          socket_.begin(mine.host.c_str(), mine.port, WS_PATH);
        }
        socket_.onEvent(onSocket);
        socket_.setReconnectInterval(RETRY_MS);
      }
    }
    if (mine.ok && WiFi.status() == WL_CONNECTED) socket_.loop();
    else if (socket_.isConnected()) socket_.disconnect();
    Out o;
    while (xQueueReceive(outbox, &o, 0) == pdTRUE) {
      if (o.kind == OUT_DROP) socket_.disconnect();
      else if (socket_.isConnected()) socket_.sendTXT(o.text);
    }
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

/** What the socket task has heard since the loop last looked. */
void drain(uint32_t now) {
  Event e;
  while (xQueueReceive(events, &e, 0) == pdTRUE) {
    switch (e.kind) {
      case EV_OPENED:
        waitingOut.clear();
        wrist->linkUp(now);  // the hello is first in what the Wrist says next
        batteryReport.reset();
        if (battery >= 0) batteryReport.sent(battery, now);  // the hello carried it
        Serial.printf("on the relay: %s\n", relay.origin.c_str());
        break;
      case EV_CLOSED:
        if (wrist->up()) Serial.println("lost the relay");
        waitingOut.clear();
        wrist->linkDown(now);
        break;
      case EV_TEXT: {
        if (e.length > sizeof e.text) { wrist->heard(now); break; }  // too long to read, but heard
        const std::string text(e.text, e.length);
        wrist->frame(text, now);
        Frame f;
        if (readFrame(text, f)) {
          const std::string line = heardLine(f, shown);
          if (!line.empty()) Serial.println(line.c_str());
        }
        break;
      }
      case EV_HEARD:
        wrist->heard(now);
        break;
      default:
        break;
    }
  }
}

void startRelay() {
  const Relay next = parseRelay(relayText);
  {
    std::lock_guard<std::mutex> hold(relayLock);
    relay = next;
  }
  relayChanged = true;
  if (wrist) wrist->linkDown(millis());
  if (!relay.ok) Serial.println("no relay yet. Type:  relay https://<the address npm run tunnel printed>");
}

void startWifi() {
  WiFi.disconnect();
  if (ssid.empty()) {
    Serial.println("no wi-fi yet. Type:  ssid <network name>  then  pass <password>");
    return;
  }
  WiFi.begin(ssid.c_str(), pass.empty() ? nullptr : pass.c_str());
  rejoin.began(millis());
}

/** Why the radio last dropped, as the console says it: its number and, when the core has one, its name. */
std::string wifiReason() {
  const uint8_t why = wifiWhy.load();
  if (!why) return "no reason given yet";
  const char* name = WiFi.disconnectReasonName(static_cast<wifi_err_reason_t>(why));
  return "reason " + std::to_string(why) + (*name ? std::string(" ") + name : std::string());
}

/** Says when the Wi-Fi comes and goes, and begins again while a network is set and not joined (see Rejoin). */
void watchWifi(uint32_t now) {
  const bool joined = WiFi.status() == WL_CONNECTED;
  if (joined != onWifi) {
    onWifi = joined;
    if (joined) Serial.printf("on the wi-fi: %s\n", WiFi.localIP().toString().c_str());
    else Serial.printf("lost the wi-fi (%s)\n", wifiReason().c_str());
  }
  if (rejoin.due(!ssid.empty(), joined, now)) {
    Serial.printf("no wi-fi (%s); trying %s again\n", wifiReason().c_str(), ssid.c_str());
    startWifi();
  }
}

// ---------- the screen ----------

int px(float v, float k) { return static_cast<int>(v * k + 0.5f); }

int widthIn(const lgfx::IFont* font, const std::string& s, float size = 1) {
  face.setFont(font);
  face.setTextSize(size);
  return face.textWidth(s.c_str());
}

int heightOf(const lgfx::IFont* font, float size = 1) {
  face.setFont(font);
  face.setTextSize(size);
  return face.fontHeight();
}

// The free fonts leave a generous line: three quarters of it is enough between capitals.
int bigStep(int i) { return heightOf(BIG[i]) * 3 / 4; }
int smallStep(int i) { return heightOf(SMALL[i]); }

void drawLines(const std::vector<std::string>& lines, const lgfx::IFont* font, int step, int& y) {
  face.setFont(font);
  face.setTextSize(1);
  for (const std::string& l : lines) {
    face.drawString(l.c_str(), face.width() / 2, y);
    y += step;
  }
}

/** A small line wrapped to the width, in the largest of the small fonts it fits; none if it is empty. */
Fit fitSmall(const std::string& text, int maxW, int maxH) {
  if (text.empty()) return Fit{};
  return fit(text, 3, maxW, maxH, [](int i, const std::string& s) { return widthIn(SMALL[i], s); }, smallStep);
}

/** How tall fitted small lines stand. */
int linesHeight(const Fit& f) { return static_cast<int>(f.lines.size()) * smallStep(f.font); }

/** One or two short lines, big over small, in the middle of the face. */
void drawWords(const Words& w, uint16_t ink, float k) {
  const int W = face.width(), H = face.height();
  const int maxW = W - 2 * px(10, k);
  const Fit big = fit(w.big, 3, maxW, H * 3 / 5, [](int i, const std::string& s) { return widthIn(BIG[i], s); }, bigStep);
  const Fit small = fitSmall(w.small, maxW, H / 4);
  const int gap = small.lines.empty() ? 0 : px(6, k);
  int y = (H - (static_cast<int>(big.lines.size()) * bigStep(big.font) + gap + linesHeight(small))) / 2;
  face.setTextColor(ink);
  face.setTextDatum(lgfx::textdatum_t::top_center);
  drawLines(big.lines, BIG[big.font], bigStep(big.font), y);
  y += gap;
  drawLines(small.lines, SMALL[small.font], smallStep(small.font), y);
}

/**
 * A number under its word: MEET after a mutual yes, or the pairing check's ON
 * YOUR PHONE?, which is wider than the face and so is wrapped, as the hint is.
 */
void drawMeet(const Words& w, uint16_t ink, float k) {
  const int W = face.width(), H = face.height();
  const int maxW = W - 2 * px(10, k);
  const float size = std::min(2.0f * k, static_cast<float>(maxW) / std::max(1, widthIn(NUMBER, w.big)));
  const Fit small = fitSmall(w.small, maxW, H / 4);
  const int numH = heightOf(NUMBER, size) * 3 / 4;
  const int gap = px(6, k);
  int y = (H - (linesHeight(small) + gap + numH)) / 2;
  face.setTextColor(ink);
  face.setTextDatum(lgfx::textdatum_t::top_center);
  drawLines(small.lines, SMALL[small.font], smallStep(small.font), y);
  y += gap;
  face.setFont(NUMBER);
  face.setTextSize(size);
  face.drawString(w.big.c_str(), W / 2, y);
  face.setTextSize(1);
}

/**
 * Pairing: a code to scan over the four letters to type. The code is as wide
 * as the screen allows, with four light modules round it — a tunnel address
 * is a version 4 code, and the canvas's 115 pixels would make each module two
 * pixels, too small for a phone to read off a screen this size. A press puts
 * the hint, PAIR ON YOUR PHONE, under the letters, in what height is left.
 */
void drawPairing(const std::string& code, const std::string& hint, float k) {
  const int W = face.width(), H = face.height();
  const std::string url = relay.ok ? pairUrl(relay.origin, code) : "";
  const int version = url.empty() ? 0 : qrVersion(url.size());
  const int module = qrModule(version, W - px(8, k));
  const int box = module * (qrSize(version) + 8);
  int font = 0;
  while (font < 2 && 4 * widthIn(CODE[font], "W") * 112 / 100 > W - px(10, k)) ++font;
  const int advance = widthIn(CODE[font], "W");
  const int track = advance * 12 / 100;  // the canvas spaces the letters .12em apart
  const int codeH = heightOf(CODE[font]);
  const int gap = box ? px(16, k) : 0;
  const int hintGap = hint.empty() ? 0 : px(6, k);
  const Fit words = fitSmall(hint, W - 2 * px(10, k), H - (box + gap + codeH + hintGap) - 2 * px(4, k));
  int y = (H - (box + gap + codeH + hintGap + linesHeight(words))) / 2;
  if (box) {
    const int x = (W - box) / 2;
    face.fillRect(x, y, box, box, WHITE);
    face.qrcode(url.c_str(), x + 4 * module, y + 4 * module, module * qrSize(version), version);
    y += box + gap;
  }
  face.setTextColor(WHITE);
  face.setTextDatum(lgfx::textdatum_t::top_center);
  face.setFont(CODE[font]);
  face.setTextSize(1);
  const int n = static_cast<int>(code.size());
  int x = (W - (n * advance + (n - 1) * track)) / 2 + advance / 2;
  for (char c : code) {
    const char one[2] = {c, 0};
    face.drawString(one, x, y);
    x += advance + track;
  }
  y += codeH + hintGap;
  drawLines(words.lines, SMALL[words.font], smallStep(words.font), y);
}

uint16_t inkOf(const std::string& ink) {
  if (ink == "ink") return rgb565(INK);
  if (ink == "white") return WHITE;
  if (const Hue* h = hueFor(ink)) return rgb565(h->c);  // a preview: the card's words in its colour, on black
  return rgb565(TEXT_2);
}

void paint(const Screen& s) {
  const int W = face.width(), H = face.height();
  const float k = std::min(W / 135.0f, H / 240.0f);  // the canvas draws the wristband 135 x 240
  if (s.field == "white") {
    face.fillScreen(WHITE);
  } else if (const Rgb* c = plainField(s.field)) {  // a flash's on step: one flat colour
    face.fillScreen(rgb565(*c));
  } else if (const Hue* hue = hueFor(s.field)) {
    for (int y = 0; y < H; ++y)
      for (int x = 0; x < W; ++x) face.drawPixel(x, y, rgb565(glow(*hue, x, y, W, H)));
  } else {
    face.fillScreen(BLACK);
  }
  const uint16_t ink = inkOf(s.ink);
  const Words w{s.big, s.small};
  // A number — the meeting number, or the pairing check — stands large under its word.
  const bool number = !s.big.empty() && s.big.find_first_not_of("0123456789") == std::string::npos;
  if (!s.code.empty()) drawPairing(s.code, s.small, k);
  else if (number) drawMeet(w, ink, k);
  else if (!s.big.empty() || !s.small.empty()) drawWords(w, ink, k);
  if (s.bar >= 0) {  // KEEP HOLDING: how far to NOT NOW
    const int x = px(12, k), width = W - 2 * x, y = H - px(22, k), h = px(6, k);
    face.drawRect(x, y, width, h, ink);
    face.fillRect(x, y, width * s.bar / 99, h, ink);
  }
}

void draw(uint32_t now) {
  const Screen s = wrist->face(now);
  // The picture is drawn again only when it changes and can be seen. A change
  // of light alone (a flash's off step, the meeting's blink, a face going to
  // sleep) only turns the backlight, so a blink that goes on all night never
  // holds up the loop and a quick tap is not missed. What lies under the dark
  // is never seen, so it is not drawn.
  if (s.light != LIGHT_OFF) {
    const std::string key = s.big + '|' + s.small + '|' + s.field + '|' + s.ink + '|' + std::to_string(s.bar) + '|' +
                            s.code + '|' + relay.origin;
    if (key != drawn) {
      drawn = key;
      paint(s);
      face.pushSprite(0, 0);
    }
  }
  if (s.light != lit) {
    lit = s.light;
    M5.Display.setBrightness(s.light);
  }
}

// ---------- sound ----------

/** The speaker has finished reading a buffer, so it may be written again. Runs on the speaker's own task. */
void soundReleased(void*, const void* data, uint8_t) {
  for (int i = 0; i < 2; ++i)
    if (data == soundBuf[i]) soundHeld[i] = false;
}

/**
 * Starts the newest sound the wrist has due, cutting off the one playing. If
 * the speaker still holds the buffer it goes in, it waits for the next time
 * round. A sound cut off before it began is never let go, but never read
 * either, so once the speaker is quiet its buffer is free.
 */
void playSounds() {
  for (std::string& name : wrist->sounds()) soundDue = std::move(name);
  if (soundDue.empty()) return;
  if (!speaker) {
    soundDue.clear();
    return;
  }
  const int i = soundNext;
  if (soundHeld[i]) {
    if (M5.Speaker.isPlaying(SOUND_CHANNEL)) return;
    soundHeld[i] = false;
  }
  const size_t n = render(soundDue, soundBuf[i], SOUND_SAMPLES);
  soundHeld[i] = true;
  if (n && M5.Speaker.playRaw(soundBuf[i], n, SOUND_RATE, false, 1, SOUND_CHANNEL, true)) {
    Serial.printf("sound: %s\n", soundDue.c_str());
    soundNext = 1 - i;
  } else {
    soundHeld[i] = false;
  }
  soundDue.clear();
}

// ---------- the serial console ----------

void help() {
  Serial.println(
      "  ssid <network name>     the venue's Wi-Fi\n"
      "  pass <password>         its password (leave it out for an open network)\n"
      "  relay <address>         https://....trycloudflare.com from npm run tunnel, or ws://<laptop>:8790 on a LAN\n"
      "  show                    what it is set to, and how it is doing\n"
      "  forget                  back to what it was built with\n"
      "  press face|side         a press, as a finger makes it\n"
      "  hold face|side          a hold, let go just after it counts\n"
      "  face                    what the screen shows now");
}

void report() {
  Serial.printf("wi-fi   %s%s  (%s)\n", ssid.empty() ? "(none)" : ssid.c_str(), pass.empty() ? "" : ", with a password",
                WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "not connected");
  Serial.printf("relay   %s  (%s)\n", relay.ok ? relay.origin.c_str() : "(none)", wrist->up() ? "on it" : "not on it");
  const auto charging = M5.Power.isCharging();
  Serial.printf("battery %d%%%s\n", battery,
                charging == m5::Power_Class::is_charging      ? " (charging)"
                : charging == m5::Power_Class::is_discharging ? " (not charging)"
                                                              : "");
  // The Plus has no PSRAM: the sound buffers and the face leave this much for a TLS handshake.
  Serial.printf("memory  %u bytes free, %u at the least; sound %s\n", static_cast<unsigned>(ESP.getFreeHeap()),
                static_cast<unsigned>(ESP.getMinFreeHeap()), speaker ? "on the speaker" : "none: light only");
}

void run(const Command& c) {
  if (c.verb == "ssid") {
    ssid = trim(c.arg);
    prefs.putString("ssid", ssid.c_str());
    startWifi();
  } else if (c.verb == "pass") {
    pass = c.arg;
    prefs.putString("pass", pass.c_str());
    Serial.println("password kept");
    startWifi();
  } else if (c.verb == "relay") {
    if (!parseRelay(c.arg).ok) {
      Serial.println("that is not an address. e.g.  relay https://abc-def.trycloudflare.com");
      return;
    }
    relayText = trim(c.arg);
    prefs.putString("relay", relayText.c_str());
    startRelay();
  } else if (c.verb == "show") {
    report();
  } else if (c.verb == "press" || c.verb == "hold") {
    const KeyPress p = pressFor(c);
    if (!p.key) {
      Serial.println("press face, press side, hold face or hold side");
      return;
    }
    // Down from the next read of the keys, and up after p.ms, through the same edges as the buttons.
    consoleKeyUntil[p.key] = millis() + p.ms;
    Serial.printf("%s the %s for %u ms\n", c.verb == "hold" ? "holding" : "pressing", p.key == 1 ? "face" : "side",
                  static_cast<unsigned>(p.ms));
  } else if (c.verb == "face") {
    Serial.println(faceLine(wrist->face(millis())).c_str());
  } else if (c.verb == "forget") {
    prefs.remove("ssid");
    prefs.remove("pass");
    prefs.remove("relay");
    loadSettings();
    startWifi();
    startRelay();
    report();
  } else {
    help();
  }
}

void console() {
  while (Serial.available() > 0) {
    const int c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (!typed.empty()) run(readCommand(typed));
      typed.clear();
    } else if (typed.size() < 200) {
      typed += static_cast<char>(c);
    }
  }
}

void readBattery(uint32_t now) {
  if (batteryAt && now - batteryAt < 1000) return;
  batteryAt = now;
  const int32_t level = M5.Power.getBatteryLevel();
  battery = level >= 0 && level <= 100 ? static_cast<int>(level) : -1;
  if (wrist) wrist->setBattery(battery, now);
}

}  // namespace

void setup() {
  auto cfg = M5.config();
  // M5Unified leaves Serial closed unless asked, and the console is the only
  // way to give the band its Wi-Fi and relay. Found on the first real band.
  cfg.serial_baudrate = 115200;
  // M5Unified switches on the 5V output for the hat and Grove port by default.
  // Nothing hangs off it here, and on the StickS3 the power chip does not charge
  // the battery while that boost is on: plugged in, the band still ran down.
  // Found on the first real band.
  cfg.output_power = false;
  M5.begin(cfg);
  M5.Display.setRotation(0);
  if (M5.Display.width() > M5.Display.height()) M5.Display.setRotation(1);
  M5.Display.setBrightness(LIGHT_OFF);
  face.setColorDepth(16);
  face.createSprite(M5.Display.width(), M5.Display.height());
  // The speaker, as the sound test had it: the microphone off first (on some
  // bands the two share one I2S), then full volume. The StickC Plus plays the
  // same samples through its buzzer.
  M5.Mic.end();
  M5.Speaker.setBufferReleaseCallback(nullptr, soundReleased);
  speaker = M5.Speaker.begin();
  M5.Speaker.setVolume(255);

  // The radio on before the key is made: with it on, esp_random() is true noise.
  WiFi.mode(WIFI_STA);
  // A new wristband at every boot: the key lives in RAM only, and the id is its hash.
  wrist = new Wrist(makeKey([] { return static_cast<uint32_t>(esp_random()); }));
  prefs.begin("otb", false);
  if (prefs.isKey("id")) prefs.remove("id");  // the id an older build kept for good is not kept any more
  loadSettings();
  readBattery(millis());
  wrist->setBattery(battery, millis());

  Serial.println("\nON THE BEAT wristband");
  if (!speaker) Serial.println("no speaker on this band: it only lights up");
  help();
  events = xQueueCreate(12, sizeof(Event));
  outbox = xQueueCreate(8, sizeof(Out));
  // Why the radio drops, kept for the console. Leaving on purpose (a new begin, a new network) is not a reason.
  WiFi.onEvent(
      [](arduino_event_id_t, arduino_event_info_t info) {
        const uint8_t why = info.wifi_sta_disconnected.reason;
        if (why != WIFI_REASON_ASSOC_LEAVE) wifiWhy = why;
      },
      ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
  startWifi();
  startRelay();
  // On the core the Wi-Fi runs on, with the deep stack a TLS handshake wants.
  xTaskCreatePinnedToCore(socketTask, "socket", 12288, nullptr, 1, nullptr, 0);
  report();
}

void loop() {
  M5.update();
  const uint32_t now = millis();
  console();
  readBattery(now);
  drain(now);
  // KEY1 is the face button, KEY2 the side one. The Wrist times the holds. A key
  // pressed from the console is down with the button, so it is the same press.
  const auto fromConsole = [now](int k) {
    return consoleKeyUntil[k] && static_cast<int32_t>(consoleKeyUntil[k] - now) > 0;
  };
  const bool a = M5.BtnA.isPressed() || fromConsole(1), b = M5.BtnB.isPressed() || fromConsole(2);
  if (a != keyA) { keyA = a; a ? wrist->keyDown(1, now) : wrist->keyUp(1, now); }
  if (b != keyB) { keyB = b; b ? wrist->keyDown(2, now) : wrist->keyUp(2, now); }
  watchWifi(now);
  wrist->setWifi(WiFi.status() == WL_CONNECTED);
  wrist->tick(now);
  playSounds();  // before the frames and the face: a press's tick is heard as soon as it can be
  for (const std::string& f : wrist->take()) sendFrame(f);
  if (wrist->up() && batteryReport.due(battery, now)) {
    sendFrame(batteryFrame(battery));
    batteryReport.sent(battery, now);
  }
  // What the outbox could not take, a drop included, is tried again every time round.
  flushOut();
  draw(now);
  delay(10);
}
