// ON THE BEAT — the wristband: an M5StickC Plus (or Plus2) on a strap.
//
// A light first and words second. It joins the relay exactly as /band does:
// it says it is a wristband, shows whatever the relay tells it to show, and
// has one button — a press wakes it for three seconds, a one-second hold is
// NOT NOW. What it shows is decided by the relay (relay/band.js), from the
// same view its person's phone is sent, so it can never show more than the
// phone could.
//
// Everything that decides anything is in band_logic.h, which the tests build
// and run on a laptop. This file is only the hardware round it: the screen,
// the button, the battery, Wi-Fi, the socket, and a serial console to say
// which Wi-Fi and which relay. The socket has a task of its own, so nothing
// the network does can hold up the button or the screen.

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

std::string bandId, ssid, pass, relayText;
Relay relay;

Button button;
Link net;
Quiet quiet;
BatteryReport batteryReport;

Show last;              // what the relay last said to show
bool haveShow = false;
int battery = -1;       // percent, or -1 while it will not say
uint32_t batteryAt = 0;
uint32_t wakeUntil = 0;
std::string drawn;      // what is on the screen now, so it is drawn again only when that changes
std::string typed;      // the console line so far

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
  bandId = setting("id", "");
  if (!validId(bandId)) {
    // Made once and kept: the relay, and the phone it pairs with, know it by this.
    bandId = makeId([] { return static_cast<uint32_t>(esp_random()); });
    prefs.putString("id", bandId.c_str());
  }
  ssid = setting("ssid", OTB_WIFI_SSID);
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
  int16_t battery;  // EV_OPENED: the battery the hello said
  uint16_t length;  // EV_TEXT: its length; a frame longer than text[] is heard, not read
  char text[480];
};

enum : uint8_t { OUT_SEND, OUT_DROP };
struct Out {
  uint8_t kind;
  char text[124];
};

QueueHandle_t events = nullptr;  // socket task -> loop
QueueHandle_t outbox = nullptr;  // loop -> socket task
std::mutex relayLock;            // the loop writes `relay`; the socket task copies it under this
std::atomic<bool> relayChanged{false};
std::atomic<int> batteryNow{-1};

void post(uint8_t kind, const uint8_t* text = nullptr, size_t length = 0, int level = -1) {
  Event e;
  e.kind = kind;
  e.battery = static_cast<int16_t>(level);
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

// Runs on the socket task, inside socket_.loop().
void onSocket(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      // First on every connection, before anything the loop has queued.
      const int level = batteryNow.load();
      socket_.sendTXT(helloFrame(bandId, level).c_str());
      post(EV_OPENED, nullptr, 0, level);
      break;
    }
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
        // Back after long enough that what it said was no longer shown: wait for it to say it again.
        if (net.stale(now)) haveShow = false;
        net.opened(now);
        batteryReport.reset();
        if (e.battery >= 0) batteryReport.sent(e.battery, now);
        Serial.printf("on the relay: %s\n", relay.origin.c_str());
        break;
      case EV_CLOSED:
        if (net.up()) Serial.println("lost the relay");
        net.closed(now);
        quiet.closed();
        break;
      case EV_TEXT: {
        net.heard(now);
        Frame f;
        if (e.length > sizeof e.text || !readFrame(std::string(e.text, e.length), f)) break;
        if (f.t == "show" && f.hasShow) {
          last = f.show;
          haveShow = true;
          quiet.shown(last);
        } else if (f.t == "error") {
          Serial.printf("the relay says: %s\n", f.why.c_str());
        }
        break;
      }
      case EV_HEARD:
        net.heard(now);
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
  net.closed(millis());
  quiet.closed();
  if (!relay.ok) Serial.println("no relay yet. Type:  relay https://<the address npm run tunnel printed>");
}

void startWifi() {
  WiFi.disconnect();
  if (ssid.empty()) {
    Serial.println("no wi-fi yet. Type:  ssid <network name>  then  pass <password>");
    return;
  }
  WiFi.begin(ssid.c_str(), pass.empty() ? nullptr : pass.c_str());
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

/** One or two short lines, big over small, in the middle of the face. */
void drawWords(const Words& w, uint16_t ink, float k) {
  const int W = face.width(), H = face.height();
  const int maxW = W - 2 * px(10, k);
  const Fit big = fit(w.big, 3, maxW, H * 3 / 5, [](int i, const std::string& s) { return widthIn(BIG[i], s); }, bigStep);
  Fit small;
  if (!w.small.empty())
    small = fit(w.small, 3, maxW, H / 4, [](int i, const std::string& s) { return widthIn(SMALL[i], s); }, smallStep);
  const int gap = small.lines.empty() ? 0 : px(6, k);
  int y = (H - (static_cast<int>(big.lines.size()) * bigStep(big.font) + gap +
                static_cast<int>(small.lines.size()) * smallStep(small.font))) / 2;
  face.setTextColor(ink);
  face.setTextDatum(lgfx::textdatum_t::top_center);
  drawLines(big.lines, BIG[big.font], bigStep(big.font), y);
  y += gap;
  drawLines(small.lines, SMALL[small.font], smallStep(small.font), y);
}

/** After a mutual yes: MEET, over the number both wrists show. */
void drawMeet(const Words& w, uint16_t ink, float k) {
  const int W = face.width(), H = face.height();
  const int maxW = W - 2 * px(10, k);
  const float size = std::min(2.0f * k, static_cast<float>(maxW) / std::max(1, widthIn(NUMBER, w.big)));
  const int smallH = heightOf(SMALL[0]);
  const int numH = heightOf(NUMBER, size) * 3 / 4;
  const int gap = px(6, k);
  int y = (H - (smallH + gap + numH)) / 2;
  face.setTextColor(ink);
  face.setTextDatum(lgfx::textdatum_t::top_center);
  face.setFont(SMALL[0]);
  face.setTextSize(1);
  face.drawString(w.small.c_str(), W / 2, y);
  y += smallH + gap;
  face.setFont(NUMBER);
  face.setTextSize(size);
  face.drawString(w.big.c_str(), W / 2, y);
  face.setTextSize(1);
}

/**
 * Pairing: a code to scan over the four letters to type. The code is as wide
 * as the screen allows, with four light modules round it — a tunnel address
 * is a version 4 code, and the canvas's 115 pixels would make each module two
 * pixels, too small for a phone to read off a screen this size.
 */
void drawPairing(const std::string& code, float k) {
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
  int y = (H - (box + gap + codeH)) / 2;
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
}

void paint(const Face& f, const Words& w) {
  const int W = face.width(), H = face.height();
  const float k = std::min(W / 135.0f, H / 240.0f);  // the canvas draws the wristband 135 x 240
  const Show& s = f.show;
  if (s.kind == "test") {
    face.fillScreen(WHITE);
    return;
  }
  if (lit(s)) {
    const Hue& hue = *hueFor(s.intent);
    for (int y = 0; y < H; ++y)
      for (int x = 0; x < W; ++x) face.drawPixel(x, y, rgb565(glow(hue, x, y, W, H)));
    if (s.kind == "meet") drawMeet(w, rgb565(INK), k);
    else drawWords(w, rgb565(INK), k);
    return;
  }
  face.fillScreen(BLACK);
  if (s.kind == "pairing") drawPairing(s.code, k);
  else if (!w.big.empty()) drawWords(w, rgb565(TEXT_2), k);
}

void draw(uint32_t now) {
  const bool awake = static_cast<int32_t>(wakeUntil - now) > 0;
  const Face f = faceFor(haveShow ? &last : nullptr, net.stale(now), quiet.dark());
  const Signal signal = WiFi.status() != WL_CONNECTED ? Signal::NO_WIFI : net.up() ? Signal::LIVE : Signal::NO_RELAY;
  const Words w = wordsFor(f, awake, battery, signal);
  const uint8_t light = lightFor(f, awake);
  const std::string key = f.show.kind + '|' + f.show.intent + '|' + f.show.code + '|' + w.big + '|' + w.small + '|' +
                          std::to_string(light) + '|' + relay.origin;
  if (key == drawn) return;
  drawn = key;
  paint(f, w);
  face.pushSprite(0, 0);
  M5.Display.setBrightness(light);
}

// ---------- the serial console ----------

void help() {
  Serial.println(
      "  ssid <network name>     the venue's Wi-Fi\n"
      "  pass <password>         its password (leave it out for an open network)\n"
      "  relay <address>         https://....trycloudflare.com from npm run tunnel, or ws://<laptop>:8790 on a LAN\n"
      "  show                    what it is set to, and how it is doing\n"
      "  forget                  back to what it was built with");
}

void report() {
  Serial.printf("wi-fi   %s%s  (%s)\n", ssid.empty() ? "(none)" : ssid.c_str(), pass.empty() ? "" : ", with a password",
                WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str() : "not connected");
  Serial.printf("relay   %s  (%s)\n", relay.ok ? relay.origin.c_str() : "(none)", net.up() ? "on it" : "not on it");
  Serial.printf("battery %d%%\n", battery);
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
  batteryNow = battery;
}

}  // namespace

void setup() {
  auto cfg = M5.config();
  // M5Unified leaves Serial closed unless asked, and the console is the only
  // way to give the band its Wi-Fi and relay. Found on the first real band.
  cfg.serial_baudrate = 115200;
  M5.begin(cfg);
  M5.Display.setRotation(0);
  if (M5.Display.width() > M5.Display.height()) M5.Display.setRotation(1);
  M5.Display.setBrightness(LIGHT_OFF);
  face.setColorDepth(16);
  face.createSprite(M5.Display.width(), M5.Display.height());

  // The radio on before the id is made: with it on, esp_random() is true noise.
  WiFi.mode(WIFI_STA);
  prefs.begin("otb", false);
  loadSettings();
  readBattery(millis());

  Serial.println("\nON THE BEAT wristband");
  help();
  events = xQueueCreate(12, sizeof(Event));
  outbox = xQueueCreate(8, sizeof(Out));
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

  switch (button.update(M5.BtnA.isPressed(), now)) {
    case Button::WAKE:
      wakeUntil = now + WAKE_MS;
      break;
    case Button::HOLD:
      quiet.held();
      Serial.println("NOT NOW, from the wrist");
      break;
    default:
      break;
  }

  switch (net.tick(now)) {
    case Link::PING:
      toSocket(OUT_SEND, PING_FRAME);
      break;
    case Link::DROP:
      // Marked closed only once the socket task has it; otherwise asked again next time round.
      if (toSocket(OUT_DROP)) {
        Serial.println("the relay went quiet; trying again");
        net.closed(now);
        quiet.closed();
      }
      break;
    default:
      break;
  }
  if (quiet.due(net.up()) && toSocket(OUT_SEND, HOLD_FRAME)) quiet.sent(now);
  quiet.tick(now);
  if (net.up() && batteryReport.due(battery, now) && toSocket(OUT_SEND, batteryFrame(battery))) {
    batteryReport.sent(battery, now);
  }

  draw(now);
  delay(10);
}
