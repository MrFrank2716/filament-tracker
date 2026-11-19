// What survives a restart, in the ESP32's flash (Preferences namespace "wb"). Wi-Fi itself is kept by the
// ESP32's own Wi-Fi settings.
#pragma once

#include <stddef.h>

namespace store {

struct Settings {
  char url[128];       // the server, e.g. https://wrkbench.example.com
  char token[96];      // wbd_..., "" until set up
  char code[16];       // a set-up code typed on the phone page, used once
  bool insecure;       // accept any certificate (self-hosted HTTPS with its own certificate)
};

void load(Settings &out);
void save(const Settings &settings);
/** Forget the token only: the display asks for a new set-up code. */
void clearToken();
/** Forget everything, Wi-Fi included. */
void wipe();

}  // namespace store
