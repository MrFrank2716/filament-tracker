#include "portal.h"

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <esp_random.h>

#include "wb_core.h"

namespace portal {
namespace {

WiFiManager manager;
WiFiManagerParameter serverField("server", "Wrkbench address (from Settings, Displays)", "", 120);
WiFiManagerParameter codeField("code", "Set-up code", "", 20);
WiFiManagerParameter insecureField("insecure", "Accept any certificate (only for a self-hosted server with its own certificate)", "T", 2,
                                   "type=\"checkbox\"", WFM_LABEL_AFTER);
bool saved = false;

void onSave() { saved = true; }

}  // namespace

bool configured(const store::Settings &settings) {
  WiFi.mode(WIFI_STA);
  return settings.url[0] && manager.getWiFiIsSaved();
}

void open(char *apName, size_t nameLen, char *apPassword, size_t passwordLen) {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  snprintf(apName, nameLen, "Wrkbench-%02X%02X", mac[4], mac[5]);
  // A password shown only on the display, so nobody nearby can join the set-up network and read the code.
  snprintf(apPassword, passwordLen, "%08lu", static_cast<unsigned long>(esp_random() % 100000000UL));

  manager.setTitle("Wrkbench display");
  static std::vector<const char *> menu{"wifi", "exit"};
  manager.setMenu(menu);
  manager.setShowInfoUpdate(false);
  manager.addParameter(&serverField);
  manager.addParameter(&codeField);
  manager.addParameter(&insecureField);
  manager.setSaveParamsCallback(onSave);
  manager.setSaveConfigCallback(onSave);
  manager.setConfigPortalBlocking(false);
  // A wrong Wi-Fi password keeps the set-up network open so the phone can try again.
  manager.setConnectTimeout(20);
  manager.startConfigPortal(apName, apPassword);
}

bool process(store::Settings &settings) {
  manager.process();
  if (!saved || WiFi.status() != WL_CONNECTED) return false;
  saved = false;
  char url[128];
  if (wb::normalizeServer(serverField.getValue(), url, sizeof url)) wb::copyText(settings.url, sizeof settings.url, url);
  char code[16];
  wb::normalizeCode(codeField.getValue(), code, sizeof code);
  wb::copyText(settings.code, sizeof settings.code, code);
  settings.insecure = strcmp(insecureField.getValue(), "T") == 0;
  settings.token[0] = '\0';
  manager.stopConfigPortal();
  return true;
}

void connect() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin();
}

}  // namespace portal
