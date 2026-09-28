// Copy to secrets.h (which git ignores) to build a wristband that already
// knows the venue's Wi-Fi and the relay. Everything here can instead be typed
// at the serial console, and what is typed there wins and is kept.

#pragma once

#define OTB_WIFI_SSID ""
#define OTB_WIFI_PASS ""

// The always-on relay, or the address `npm run tunnel` prints
// (https://....trycloudflare.com), or ws://<the laptop's address>:8790 on the
// same network.
#define OTB_RELAY "https://on-the-beat.fly.dev"

// Optional: the root certificate(s), PEM, that sign the relay's certificate,
// in place of relay_roots.h's, which cover the always-on relay and a
// Cloudflare tunnel. A https relay whose certificate chains to none of them
// is refused.
// #define OTB_RELAY_CA "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n"
