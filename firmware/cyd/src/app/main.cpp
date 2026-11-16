// Wrkbench location display: a CYD on a shelf that shows what is stored there and how much is left.
//
// Start-up: with no Wi-Fi or server saved, the display opens a set-up network for a phone (portal.cpp).
// Then the network task (net.cpp) pairs with the set-up code and polls the server; the screens (ui.cpp)
// draw what it gets. An optional PN532 tag reader (reader_pn532.cpp) lets a tapped spool be looked up.
#include <Arduino.h>
#include <WiFi.h>

#include "display.h"
#include "net.h"
#include "portal.h"
#include "reader.h"
#include "store.h"
#include "ui.h"

#ifndef WB_VERSION
#define WB_VERSION "dev"
#endif

namespace {

store::Settings settings;
bool hasReader = false;
bool inPortal = false;

void startRunning() {
  net::start(settings, hasReader);
  ui::showBusy("Joining Wi-Fi", WiFi.SSID().c_str());
}

}  // namespace

void setup() {
  Serial.begin(115200);
  Serial.printf("\nWrkbench display %s\n", WB_VERSION);
  display::begin();
  store::load(settings);
  hasReader = reader::begin();
  if (hasReader) reader::start();
  else Serial.println("No tag reader found; showing the location only.");
  ui::begin(settings, hasReader);

  if (portal::configured(settings)) {
    portal::connect();
    startRunning();
  } else {
    char apName[32], apPassword[16];
    portal::open(apName, sizeof apName, apPassword, sizeof apPassword);
    ui::showSetup(apName, apPassword);
    inPortal = true;
  }
}

#ifdef WB_OTA_PASSWORD
// Developer builds only (env cyd-st7789-dev): new firmware over Wi-Fi, so a layout can be tried without the
// BOOT button. Password-protected; release builds do not listen at all.
#include <ArduinoOTA.h>
static void handleOta() {
  static bool started = false;
  if (!started && WiFi.status() == WL_CONNECTED) {
    ArduinoOTA.setHostname("wrkbench-display");
    ArduinoOTA.setPassword(WB_OTA_PASSWORD);
    ArduinoOTA.begin();
    started = true;
    Serial.printf("Wi-Fi updates on at %s\n", WiFi.localIP().toString().c_str());
  }
  if (started) ArduinoOTA.handle();
}
#else
static void handleOta() {}
#endif

void loop() {
  display::tick();
  handleOta();
  // Over USB: "S" sends what is on screen (tools/screenshot.py); "P" and "O" open the printer screen and overview.
  while (Serial.available()) {
    const int key = Serial.read();
    if (key == 'S') display::sendScreenshot();
    else if (!inPortal && (key == 'P' || key == 'O')) ui::openScreen(static_cast<char>(key));
  }
  if (inPortal) {
    if (portal::process(settings)) {
      store::save(settings);
      inPortal = false;
      Serial.printf("Set up: server %s\n", settings.url);
      // The set-up network is closed before polling starts, so TLS has the memory it needs.
      startRunning();
    }
  } else {
    ui::poll();
  }
  delay(5);
}
