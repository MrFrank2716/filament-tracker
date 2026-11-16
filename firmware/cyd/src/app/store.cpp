#include "store.h"

#include <Preferences.h>
#include <WiFi.h>
#include <string.h>

#include "wb_core.h"

namespace store {

static Preferences prefs;

void load(Settings &out) {
  memset(&out, 0, sizeof out);
  prefs.begin("wb", true);
  prefs.getString("url", out.url, sizeof out.url);
  prefs.getString("token", out.token, sizeof out.token);
  prefs.getString("code", out.code, sizeof out.code);
  out.insecure = prefs.getBool("insecure", false);
  prefs.end();
}

void save(const Settings &settings) {
  prefs.begin("wb", false);
  prefs.putString("url", settings.url);
  prefs.putString("token", settings.token);
  prefs.putString("code", settings.code);
  prefs.putBool("insecure", settings.insecure);
  prefs.end();
}

void clearToken() {
  prefs.begin("wb", false);
  prefs.remove("token");
  prefs.end();
}

void wipe() {
  prefs.begin("wb", false);
  prefs.clear();
  prefs.end();
  WiFi.disconnect(true, true);  // also erases the saved network
}

}  // namespace store
