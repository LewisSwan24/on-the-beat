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
// the speaker, the microphone a lit card pulses on the beat from, the two
// buttons, the battery, Wi-Fi, the socket, the beacon and the listen that
// tell the relay which bands are near, and a serial console to say which
// Wi-Fi and which relay. The socket has a task of its own, so nothing the
// network does can hold up the button or the screen.
//
// Or, set so on the console, it is a marker the venue leaves at the bar or by
// the stage, and does nothing else: it beacons its area on every channel.

#include <M5Unified.h>
#include <Preferences.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

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
bool axp = false;       // a StickC Plus: its power chip says what the band draws from USB
float usbSum = 0;       // mA, a reading a second, since the console last said it
uint32_t usbCount = 0, usbAt = 0;
std::string drawn;      // what is on the screen now, so it is drawn again only when that changes
int lit = -1;           // the backlight as last set
std::string typed;      // the console line so far

// Sounds play from buffers of their own, on the speaker's own task. playRaw()
// reads a buffer for as long as it plays, so there are two, used in turn, and
// one is written again only once the speaker has let it go.
constexpr int SOUND_CHANNEL = 0;
bool speaker = false;                   // the first M5StickC has none: it only lights up
bool buzzer = false;                    // a buzzer, as the StickC Plus has: sounds go octaves up
uint8_t soundBuf[2][SOUND_SAMPLES];
std::atomic<bool> soundHeld[2];         // a sound on this buffer the speaker has not let go of yet
int soundNext = 0;                      // the buffer the next sound goes in
std::string soundDue;                   // the newest sound not started yet
bool speakerOn = false;                 // the speaker has the audio channel; the microphone takes it in turn

// The microphone's blocks, each handed back to it from its own task the moment it is full, with a copy for the
// loop: so the loop's pace never loses a sample, and blocks the copies could not hold are counted.
struct Heard {
  int16_t samples[BEAT_BLOCK];
  uint32_t at;    // millis() when the microphone handed it over
  uint32_t lost;  // blocks before it that the copies could not hold
};
constexpr size_t HEARD_KEPT = 16;         // 128 ms of blocks the loop may fall behind by
// The microphone's delay from a sound to the block that hears it, in ms, by model (beat §2): measured at the
// gate, from a press of the face button to the block that hears its click (§4.1). Not measured yet, so 0.
constexpr double MIC_LATENCY_S3_MS = 0;   // the StickS3's, through its codec
constexpr double MIC_LATENCY_PDM_MS = 0;  // the StickC Plus's and Plus2's PDM microphone
int16_t micBuf[2][BEAT_BLOCK];
QueueHandle_t heardBlocks = nullptr;
volatile uint32_t micLost = 0;            // written by the microphone's task, and by the loop only while it is shut
std::atomic<int16_t*> micStuck{nullptr};  // a buffer the microphone's task could not hand back
bool micWorks = false;                    // this band has a microphone, and it opened whenever asked
bool micOpen = false;
Levels levels;                            // kept from one opening to the next: the offset it took out is still there
BlockClock blockClock;
uint32_t micBlocks = 0, micDropped = 0;   // since it last opened, for the console

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
  char text[FRAME_MAX];  // the longest a band sends: a report of HEARD_MAX bands (see band_logic.h)
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

// ---------- near: the beacon and the listen ----------
//
// The radio half of Hearing (band_logic.h). While wrist->nearOn(), the band
// broadcasts BEACON by ESP-NOW every BEACON_MS, and every HEAR_EVERY_MS
// listens for LISTEN_MS in promiscuous mode, because Arduino-ESP32 2.0's
// ESP-NOW receive callback carries no RSSI; then it reports what it heard.
// Measured on both bands before it was built: beside the Wi-Fi and a TLS
// socket to the relay, no beacon lost.

const uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
uint8_t air[6] = {0, 0, 0, 0, 0, 0};  // this boot's address on the air (makeAir)
bool airSet = false;                  // the radio took it; if not, the band neither beacons nor listens
bool nearReady = false;               // ESP-NOW is up: once, on the first join
bool nearWanted = true;               // `near off` on the console stops both, to test a band gone quiet
bool beaconWanted = true;             // `near listen` stops only the beacon: two bands so hear nobody, and say so
bool listening = false;
uint32_t beaconAt = 0, listenAt = 0;
uint32_t beacons = 0, beaconsRefused = 0;
Hearing hearing;                      // the listen now
Hearing lastHeard;                    // the last listen, for the console
int lastChannel = 0;
uint32_t lastHeardAt = 0;             // 0 until a listen has ended

// Beacons caught on the Wi-Fi task, taken into `hearing` every time round the loop.
struct Caught {
  uint8_t mac[6];
  int rssi;
  bool mark;       // a marker's beacon, not a band's
  uint8_t letter;  // a marker's: its letter, whatever it is (Hearing ignores one no marker has)
};
constexpr size_t CAUGHT_MAX = 32;
Caught caught[CAUGHT_MAX];
size_t caughtCount = 0;
portMUX_TYPE caughtLock = portMUX_INITIALIZER_UNLOCKED;

/**
 * On the Wi-Fi task: an ESP-NOW frame (a vendor-specific action frame) that
 * carries BEACON, or MARK_BEACON and a letter. Its sender is address 2.
 */
void onAir(void* buf, wifi_promiscuous_pkt_type_t type) {
  if (type != WIFI_PKT_MGMT) return;
  const auto* p = static_cast<const wifi_promiscuous_pkt_t*>(buf);
  const uint8_t* d = p->payload;
  const int len = static_cast<int>(p->rx_ctrl.sig_len);
  if (len < 29 || d[0] != 0xD0 || d[24] != 127) return;
  for (int i = 25; i + static_cast<int>(sizeof BEACON) <= len; ++i) {
    const bool mark = i + static_cast<int>(sizeof MARK_BEACON) < len && memcmp(d + i, MARK_BEACON, sizeof MARK_BEACON) == 0;
    if (!mark && memcmp(d + i, BEACON, sizeof BEACON) != 0) continue;
    portENTER_CRITICAL_ISR(&caughtLock);
    if (caughtCount < CAUGHT_MAX) {
      memcpy(caught[caughtCount].mac, d + 10, 6);
      caught[caughtCount].rssi = p->rx_ctrl.rssi;
      caught[caughtCount].mark = mark;
      caught[caughtCount].letter = mark ? d[i + sizeof MARK_BEACON] : 0;
      ++caughtCount;
    }
    portEXIT_CRITICAL_ISR(&caughtLock);
    return;
  }
}

/** ESP-NOW, on the first join: the broadcast peer, the beacon's rate, and what the listen lets through. */
void startNear() {
  if (esp_now_init() != ESP_OK) {
    Serial.println("near: ESP-NOW would not start");
    return;
  }
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST, 6);
  peer.channel = 0;  // the channel the Wi-Fi is on
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  esp_now_add_peer(&peer);
  // 6 Mbps, not the default 1: a room of bands takes a sixth of the airtime.
  if (esp_wifi_config_espnow_rate(WIFI_IF_STA, WIFI_PHY_RATE_6M) != ESP_OK) Serial.println("near: 6 Mbps refused");
  wifi_promiscuous_filter_t f = {};
  f.filter_mask = WIFI_PROMIS_FILTER_MASK_MGMT;
  esp_wifi_set_promiscuous_filter(&f);
  esp_wifi_set_promiscuous_rx_cb(onAir);
  nearReady = true;
}

void stopListening() {
  if (!listening) return;
  esp_wifi_set_promiscuous(false);
  listening = false;
}

/** Every time round the loop: take in what was caught, beacon, listen, and after each listen, report. */
void hearTick(uint32_t now) {
  if (!nearReady && airSet && WiFi.status() == WL_CONNECTED) startNear();
  Caught got[CAUGHT_MAX];
  portENTER_CRITICAL(&caughtLock);
  const size_t n = caughtCount;
  memcpy(got, caught, n * sizeof(Caught));
  caughtCount = 0;
  portEXIT_CRITICAL(&caughtLock);
  if (!nearReady || !nearWanted || !wrist->nearOn()) {
    stopListening();
    hearing.clear();
    return;
  }
  for (size_t i = 0; i < n; ++i) {
    if (got[i].mark) hearing.heardMark(got[i].letter, got[i].rssi);
    else hearing.heard(got[i].mac, got[i].rssi);
  }
  if (beaconWanted && now - beaconAt >= BEACON_MS) {
    beaconAt = now;
    if (esp_now_send(BROADCAST, BEACON, sizeof BEACON) == ESP_OK) ++beacons;
    else ++beaconsRefused;
  }
  if (!listening && now - listenAt >= HEAR_EVERY_MS) {
    listenAt = now;
    hearing.clear();
    listening = esp_wifi_set_promiscuous(true) == ESP_OK;
  } else if (listening && now - listenAt >= LISTEN_MS) {
    stopListening();
    lastChannel = WiFi.channel();
    sendFrame(hearing.frame(lastChannel));  // heard nobody is a report too
    lastHeard = hearing;
    lastHeardAt = now;
    hearing.clear();
  }
}

/** Whether it beacons and listens now, and if not, why. */
const char* nearState() {
  if (!airSet) return "off: the radio would not take an address of its own";
  if (!nearReady) return "not yet: waiting for the wi-fi";
  if (!nearWanted) return "off, from the console (near on)";
  if (!wrist->up()) return "not now: not on the relay";
  if (wrist->secret().empty()) return "not now: not paired";
  if (!wrist->nearOn()) return "not now: NOT NOW";
  if (!beaconWanted) return "listening, not beaconing, from the console (near on)";
  return "beaconing and listening";
}

void reportNear(uint32_t now) {
  uint8_t mac[6] = {0, 0, 0, 0, 0, 0};
  esp_wifi_get_mac(WIFI_IF_STA, mac);
  Serial.printf("near    %s; on the air as %s; %u beacons sent, %u refused\n", nearState(), airHex(mac).c_str(),
                static_cast<unsigned>(beacons), static_cast<unsigned>(beaconsRefused));
  if (!lastHeardAt) {
    Serial.println("        no listen yet");
    return;
  }
  const std::vector<Hearing::Marked> marks = lastHeard.marks();
  Serial.printf("        last listen %u s ago, channel %d: %s\n", static_cast<unsigned>((now - lastHeardAt) / 1000), lastChannel,
                lastHeard.size() || !marks.empty() ? "heard" : "heard nobody");
  for (const Hearing::Heard& h : lastHeard.strongest()) Serial.printf("        %s  %d dBm\n", airHex(h.mac).c_str(), h.rssi);
  for (const Hearing::Marked& m : marks) Serial.printf("        marker %s  %d dBm\n", m.area, m.rssi);
}

// ---------- a marker ----------
//
// `marker bar`, `marker stage` or `marker back` on the console makes the band
// a marker, kept as the Wi-Fi is, and restarts it as one; `marker off` makes
// it a wristband again. A marker joins no Wi-Fi, reaches no relay, has no key
// and no letters. Every BEACON_MS it sends Marker::beacon() once on each
// channel of markSweep(), waiting for each send to leave before it changes
// channel: on the spike, a sweep of thirteen took 30 ms, 42 at most, and every
// send got out. Its face is dark until a key lights it (band_logic.h).

Marker* marker = nullptr;             // made in setup() when the band is one: then nothing else runs
bool markerReady = false;             // ESP-NOW is up
std::atomic<bool> markSending{false};
std::atomic<uint32_t> markSent{0}, markLost{0};
uint32_t markAt = 0, markRefused = 0, markSweepMs = 0;

/** On the Wi-Fi task: a beacon has left, or could not. */
void onMarkSent(const uint8_t*, esp_now_send_status_t status) {
  if (status == ESP_NOW_SEND_SUCCESS) ++markSent;
  else ++markLost;
  markSending = false;
}

void startMarker() {
  WiFi.disconnect();
  if (esp_now_init() != ESP_OK) {
    Serial.println("marker: ESP-NOW would not start");
    return;
  }
  esp_now_register_send_cb(onMarkSent);
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST, 6);
  peer.channel = 0;  // whichever channel the sweep has set
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  esp_now_add_peer(&peer);
  if (esp_wifi_config_espnow_rate(WIFI_IF_STA, WIFI_PHY_RATE_6M) != ESP_OK) Serial.println("marker: 6 Mbps refused");
  markerReady = true;
}

/** Every BEACON_MS, one sweep: the beacon on each channel in turn. */
void markerTick(uint32_t now) {
  if (!markerReady || now - markAt < BEACON_MS) return;
  markAt = now;
  const std::vector<uint8_t> beacon = marker->beacon();
  for (const int ch : markSweep()) {
    if (esp_wifi_set_channel(static_cast<uint8_t>(ch), WIFI_SECOND_CHAN_NONE) != ESP_OK) {
      ++markRefused;
      continue;
    }
    markSending = true;
    if (esp_now_send(BROADCAST, beacon.data(), beacon.size()) != ESP_OK) {
      markSending = false;
      ++markRefused;
      continue;
    }
    const uint32_t sentAt = millis();
    while (markSending && millis() - sentAt < 20) delay(1);
  }
  markSweepMs = millis() - now;
}

void reportMarker() {
  Serial.printf("marker  %s, as %s, on channels 1 to %d every %u ms%s\n", marker->area(), airHex(air).c_str(), MARK_CHANNELS,
                static_cast<unsigned>(BEACON_MS), markerReady ? "" : ": not beaconing, ESP-NOW would not start");
  Serial.printf("        %u beacons sent, %u lost, %u refused; the last sweep took %u ms\n", static_cast<unsigned>(markSent),
                static_cast<unsigned>(markLost), static_cast<unsigned>(markRefused), static_cast<unsigned>(markSweepMs));
  int8_t cap = 0;
  if (esp_wifi_get_max_tx_power(&cap) == ESP_OK) Serial.printf("        power %.2f dBm at most, as the radio says\n", cap / 4.0f);
  Serial.printf("battery %d%%\n", battery);
}

/**
 * `power <dBm>`, for tests only: the radio capped lower, so the marker reads
 * as one further away. Not kept: a restart is full power again. With no
 * number, it says the cap the radio has now.
 */
void setMarkPower(const std::string& a) {
  const int quarters = markPower(a);
  if (!a.empty() && quarters < 0) {
    Serial.printf("power %d to %d, in whole dBm\n", MARK_POWER_MIN, MARK_POWER_MAX);
    return;
  }
  if (quarters >= 0 && esp_wifi_set_max_tx_power(static_cast<int8_t>(quarters)) != ESP_OK) Serial.println("power: the radio refused it");
  int8_t cap = 0;
  esp_wifi_get_max_tx_power(&cap);
  Serial.printf("power   %.2f dBm at most, as the radio says\n", cap / 4.0f);
}

/** `marker bar|stage|back|off`: kept, and a restart to be it. */
void setMarker(const std::string& a) {
  const int area = markNamed(a);
  if (area < 0 && a != "off") {
    Serial.println("marker bar, marker stage, marker back, or marker off");
    return;
  }
  if (area < 0 && !marker) {
    Serial.println("a wristband already");
    return;
  }
  if (area >= 0) prefs.putString("marker", a.c_str());
  else prefs.remove("marker");
  Serial.printf("%s%s: restarting\n", area >= 0 ? "a marker, " : "a wristband", area >= 0 ? MARK_AREA[area].area : "");
  Serial.flush();
  delay(200);
  ESP.restart();
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

/**
 * `face` on a marker's console: what its screen shows, read back, so a test
 * needs no eyes. The words, the backlight the display driver holds, and how
 * many of the picture's pixels are lit, counted in the frame last pushed.
 */
void markerFace(uint32_t now) {
  const int light = M5.Display.getBrightness();
  if (!marker->lit(now) || drawn != "marker") {
    Serial.printf("face: dark (light %d)\n", light);
    return;
  }
  int on = 0;
  for (int y = 0; y < face.height(); ++y)
    for (int x = 0; x < face.width(); ++x)
      if (face.readPixel(x, y)) ++on;
  const Words w = marker->words();
  Serial.printf("face: %s / %s (white on black, light %d, %d of %d pixels lit)\n", w.big.c_str(), w.small.c_str(), light, on,
                face.width() * face.height());
}

/** A marker's face: dark, and what it is while a key has lit it. */
void drawMarker(uint32_t now) {
  const bool on = marker->lit(now);
  if (on && drawn != "marker") {
    drawn = "marker";
    const float k = std::min(face.width() / 135.0f, face.height() / 240.0f);
    face.fillScreen(BLACK);
    drawWords(marker->words(), WHITE, k);
    face.pushSprite(0, 0);
  }
  const int light = on ? LIGHT_FULL : LIGHT_OFF;
  if (light != lit) {
    lit = light;
    M5.Display.setBrightness(light);
  }
}

// ---------- the microphone ----------
//
// Open only while the wrist is listening (beat §2): a lit card that could
// pulse, the beat switch on, not NOT NOW. It hears loudness only: each block
// becomes five levels here, and nothing of the sound is kept or sent. The
// microphone and the speaker take turns with the audio channel, as they share
// one I2S on some bands: a sound closes the microphone for its length, and it
// opens again once the sound is done, the beat carried across the gap. The
// spike measured the turn at about 25 ms besides the sound.

/** The speaker has the channel again, if this band has one. */
void giveSpeaker() {
  if (speaker && !speakerOn) speakerOn = M5.Speaker.begin();
}

/** A block is full. Runs on the microphone's own task: a copy for the loop, and the buffer straight back. */
void micReleased(void*, void* data, size_t) {
  static Heard h;  // not on the microphone task's own small stack
  std::memcpy(h.samples, data, sizeof h.samples);
  h.at = millis();
  h.lost = micLost;
  if (xQueueSend(heardBlocks, &h, 0) == pdTRUE) micLost = 0;
  else micLost = micLost + 1;
  if (!M5.Mic.record(static_cast<int16_t*>(data), BEAT_BLOCK)) micStuck = static_cast<int16_t*>(data);
}

/** Hands the channel to the microphone: the speaker off first, then two blocks' buffers queued, counted afresh. */
void openMic() {
  if (speakerOn) {
    M5.Speaker.end();
    speakerOn = false;
  }
  xQueueReset(heardBlocks);
  micLost = 0;
  micStuck = nullptr;
  micBlocks = micDropped = 0;
  blockClock.reset();
  if (M5.Mic.begin() && M5.Mic.record(micBuf[0], BEAT_BLOCK, BEAT_RATE) && M5.Mic.record(micBuf[1], BEAT_BLOCK, BEAT_RATE)) {
    micOpen = true;
    return;
  }
  M5.Mic.end();
  micWorks = false;
  Serial.println("the microphone did not open: this band's card stays still");
  giveSpeaker();
}

/** Takes the channel back from the microphone, for the speaker. */
void closeMic() {
  M5.Mic.end();
  micOpen = false;
  xQueueReset(heardBlocks);
  giveSpeaker();
}

/**
 * The microphone open while the wrist is listening and no sound has the
 * channel, and shut otherwise; and each block it handed over, as five levels,
 * to the wrist at the time the block ended.
 */
void micTick(uint32_t now) {
  const bool want = micWorks && wrist->listening(now);
  const bool sounding = speakerOn && (!soundDue.empty() || M5.Speaker.isPlaying(SOUND_CHANNEL));
  if (micOpen && !want) closeMic();
  else if (!micOpen && want && !sounding) openMic();
  if (!micOpen) return;
  if (int16_t* b = micStuck.exchange(nullptr)) M5.Mic.record(b, BEAT_BLOCK, BEAT_RATE);
  static Heard h;
  while (xQueueReceive(heardBlocks, &h, 0) == pdTRUE) {
    const BandLevels lv = levels.block(h.samples);
    ++micBlocks;
    micDropped += h.lost;
    uint32_t t = 0;
    if (blockClock.at(h.at, h.lost, t)) wrist->hear(lv, t);
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
  if (micOpen) closeMic();  // the channel to the speaker for the sound; the microphone opens again after it
  if (!speakerOn) {
    soundDue.clear();
    return;
  }
  const int i = soundNext;
  if (soundHeld[i]) {
    if (M5.Speaker.isPlaying(SOUND_CHANNEL)) return;
    soundHeld[i] = false;
  }
  const size_t n = render(soundDue, soundBuf[i], SOUND_SAMPLES, buzzer);
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
      "  face                    what the screen shows now\n"
      "  sound <name>            play one of the band's sounds, e.g. sound found\n"
      "  beat                    whether its microphone is open, what it has heard, and whether it has the beat\n"
      "  near                    what it last heard of other bands, and whether it beacons\n"
      "  near off|listen|on      stop both, stop only beaconing, or do both again\n"
      "  marker bar|stage|back   make it a marker at the bar, by the stage or out the back (it restarts)");
}

void helpMarker() {
  Serial.println(
      "  show                    which marker, and its beacons\n"
      "  press face|side         light its face, as a finger does\n"
      "  face                    what its screen shows now\n"
      "  power <dBm>             for tests: its radio capped at 2 to 20 dBm, as if further away (not kept)\n"
      "  marker bar|stage|back   another area (it restarts)\n"
      "  marker off              a wristband again (it restarts)");
}

/** The microphone and the beat, as the console says them. */
void reportBeat() {
  if (!micWorks) {
    Serial.println("beat    no microphone: the card stays still");
    return;
  }
  const double period = wrist->beatPeriod();
  if (!micOpen) Serial.printf("beat    microphone shut (%s)\n", wrist->listening(millis()) ? "a sound has the speaker" : "not listening");
  else if (period > 0) Serial.printf("beat    microphone open, %u blocks, %u lost; the beat every %.1f ms (%.1f BPM)\n",
                                     static_cast<unsigned>(micBlocks), static_cast<unsigned>(micDropped), period, 60000 / period);
  else Serial.printf("beat    microphone open, %u blocks, %u lost; no beat yet\n", static_cast<unsigned>(micBlocks),
                     static_cast<unsigned>(micDropped));
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
                static_cast<unsigned>(ESP.getMinFreeHeap()),
                !speaker ? "none: light only" : buzzer ? "on the buzzer, octaves up" : "on the speaker");
  reportBeat();
  // Plugged in with the battery full, what it draws is what the band uses: near on against near off.
  if (axp) {
    Serial.printf("power   %.1f mA from USB, the mean of %u readings since the last show\n", usbCount ? usbSum / usbCount : 0.0f,
                  static_cast<unsigned>(usbCount));
    usbSum = 0;
    usbCount = 0;
  }
  reportNear(millis());
}

void run(const Command& c) {
  if (marker) {  // a marker takes nothing that would join a Wi-Fi or a relay
    if (c.verb == "marker") setMarker(trim(c.arg));
    else if (c.verb == "show") reportMarker();
    else if (c.verb == "press" || c.verb == "hold") marker->press(millis());
    else if (c.verb == "face") markerFace(millis());
    else if (c.verb == "power") setMarkPower(trim(c.arg));
    else helpMarker();
    return;
  }
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
  } else if (c.verb == "sound") {
    // One of the band's own sounds, to hear the speaker without a room around it.
    const std::string name = trim(c.arg);
    if (!soundFor(name)) {
      std::string names;
      for (const Sound& s : SOUNDS) names += std::string(names.empty() ? "" : ", ") + s.name;
      Serial.printf("sound what? one of: %s\n", names.c_str());
      return;
    }
    if (!speaker) Serial.println("no speaker on this band");
    soundDue = name;
  } else if (c.verb == "beat") {
    reportBeat();
  } else if (c.verb == "near") {
    const std::string a = trim(c.arg);
    if (a == "off" || a == "listen" || a == "on") {
      nearWanted = a != "off";
      beaconWanted = a == "on";
    }
    reportNear(millis());
  } else if (c.verb == "marker") {
    setMarker(trim(c.arg));
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

// The Plus's power chip, an AXP192, says what the band draws from USB, a
// reading a second; the StickS3's build has no AXP192 in it at all.
void startUsb() {
#if defined(CONFIG_IDF_TARGET_ESP32)
  axp = M5.getBoard() == m5::board_t::board_M5StickCPlus;
  if (axp) M5.Power.Axp192.setAdcState(true);
#endif
}

void readUsb(uint32_t now) {
#if defined(CONFIG_IDF_TARGET_ESP32)
  if (!axp || (usbAt && now - usbAt < 1000)) return;
  usbAt = now;
  usbSum += M5.Power.Axp192.getVBUSCurrent();
  ++usbCount;
#else
  (void)now;
#endif
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
  // But the StickC Plus's buzzer runs off that same 5V: with it off, the band
  // played every sound in silence. Measured with a recording beside the band:
  // no tone with it off, from M5Unified's output or a plain square wave; about
  // 18 dB over the room with it on, either way.
  if (M5.getBoard() == m5::board_t::board_M5StickCPlus) M5.Power.setExtOutput(true);
  startUsb();
  M5.Display.setRotation(0);
  if (M5.Display.width() > M5.Display.height()) M5.Display.setRotation(1);
  M5.Display.setBrightness(LIGHT_OFF);
  face.setColorDepth(16);
  face.createSprite(M5.Display.width(), M5.Display.height());
  // The speaker, as the sound test had it: the microphone off first (on some
  // bands the two share one I2S), then full volume. The StickC Plus plays the
  // same sounds through its buzzer, powered as above, whole octaves higher.
  M5.Mic.end();
  M5.Mic.setBufferReleaseCallback(nullptr, micReleased);  // set while it is shut, as M5Unified asks
  M5.Speaker.setBufferReleaseCallback(nullptr, soundReleased);
  speaker = M5.Speaker.begin();
  speakerOn = speaker;
  M5.Speaker.setVolume(255);
  buzzer = speaker && M5.Speaker.config().buzzer;

  // The radio on before the key is made: with it on, esp_random() is true noise.
  WiFi.mode(WIFI_STA);
  // A new address on the air at every boot, from the same noise, before the
  // Wi-Fi joins: nothing the band sends ties it to the band it was the night
  // before, and it is never the chip's own.
  makeAir(air, [] { return static_cast<uint32_t>(esp_random()); });
  airSet = esp_wifi_set_mac(WIFI_IF_STA, air) == ESP_OK;
  prefs.begin("otb", false);
  if (prefs.isKey("id")) prefs.remove("id");  // the id an older build kept for good is not kept any more
  // A marker is nothing else: no Wi-Fi, no relay, no key; the loop only beacons.
  const int area = markNamed(setting("marker", ""));
  if (area >= 0) {
    marker = new Marker(area);
    startMarker();
    readBattery(millis());
    Serial.printf("\nON THE BEAT marker: %s\n", MARK_AREA[area].area);
    helpMarker();
    reportMarker();
    return;
  }
  // A new wristband at every boot: the key lives in RAM only, and the id is its hash.
  wrist = new Wrist(makeKey([] { return static_cast<uint32_t>(esp_random()); }));
  if (airSet) wrist->setAir(airHex(air));
  heardBlocks = xQueueCreate(HEARD_KEPT, sizeof(Heard));
  micWorks = heardBlocks && M5.Mic.isEnabled();
  wrist->setMicLatency(M5.getBoard() == m5::board_t::board_M5StickS3 ? MIC_LATENCY_S3_MS : MIC_LATENCY_PDM_MS);
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
  if (marker) {
    if (M5.BtnA.isPressed() || M5.BtnB.isPressed()) marker->press(now);
    markerTick(now);
    drawMarker(now);
    delay(10);
    return;
  }
  readUsb(now);
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
  micTick(now);  // after the sounds, which take the channel, and before the face, which pulses on what it heard
  for (const std::string& f : wrist->take()) sendFrame(f);
  hearTick(now);
  if (wrist->up() && batteryReport.due(battery, now)) {
    sendFrame(batteryFrame(battery));
    batteryReport.sent(battery, now);
  }
  // What the outbox could not take, a drop included, is tried again every time round.
  flushOut();
  draw(now);
  delay(10);
}
