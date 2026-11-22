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

// New firmware starts on trial: the board goes back to the one before if it restarts before net.cpp confirms it
// (once Wrkbench has answered). The Arduino core confirms every start at once unless this says otherwise.
extern "C" bool verifyRollbackLater() { return true; }

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

/**
 * Set-up over USB, sent by the web app right after it flashed the board (Settings, Displays, Flash a new display):
 * one line of JSON with the Wi-Fi, the server and a set-up code. Saved the same way the phone page saves them;
 * the board then restarts, joins the Wi-Fi and swaps the code for its own key. Answers "WBSETUP OK" or
 * "WBSETUP ERR <why>" on its own line.
 */
void setUpOverUsb(const char *line, size_t len) {
  static wb::UsbSetup setup;
  const char *why = wb::parseUsbSetup(line, len, setup);
  if (why) {
    Serial.printf("\nWBSETUP ERR %s\n", why);
    return;
  }
  wb::copyText(settings.url, sizeof settings.url, setup.url);
  wb::copyText(settings.code, sizeof settings.code, setup.code);
  settings.insecure = setup.insecure;
  settings.token[0] = '\0';
  store::save(settings);
  // Kept in the ESP32's own Wi-Fi settings, where the phone page keeps it too.
  WiFi.persistent(true);
  WiFi.mode(WIFI_STA);
  WiFi.begin(setup.ssid, setup.password);
  memset(&setup, 0, sizeof setup);
  Serial.println("\nWBSETUP OK");
  Serial.flush();
  delay(800);
  ESP.restart();
}

void loop() {
  display::tick();
  handleOta();
  // Over USB: "S" sends what is on screen (tools/screenshot.py); "P" and "O" open the printer screen and overview;
  // a line starting with "{" is set-up from the web app's flasher.
  static char line[400];
  static size_t lineLen = 0;
  static bool inLine = false;
  while (Serial.available()) {
    const int key = Serial.read();
    if (inLine) {
      if (key == '\n' || key == '\r') {
        line[lineLen] = '\0';
        inLine = false;
        setUpOverUsb(line, lineLen);
      } else if (lineLen + 1 < sizeof line) {
        line[lineLen++] = static_cast<char>(key);
      } else {
        inLine = false;  // too long to be set-up: dropped
        Serial.println("\nWBSETUP ERR Too long");
      }
    } else if (key == '{') {
      inLine = true;
      lineLen = 0;
      line[lineLen++] = '{';
    } else if (key == 'S') {
      display::sendScreenshot();
    } else if (!inPortal && (key == 'P' || key == 'O')) {
      ui::openScreen(static_cast<char>(key));
    }
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
