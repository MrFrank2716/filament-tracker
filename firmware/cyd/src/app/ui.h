// The screens. Everything here runs on the main loop task, the only one that touches LVGL.
#pragma once

#include "store.h"

namespace ui {

/** Fonts, colours and the first screen. */
void begin(const store::Settings &settings, bool hasReader);
/** First-time set-up: how to reach the set-up page from a phone. */
void showSetup(const char *apName, const char *apPassword);
/** A wait with a spinner: joining Wi-Fi, setting up. */
void showBusy(const char *title, const char *detail);
/** Handle whatever the network task and the reader have for the screen. Call from loop(). */
void poll();
/** For screenshots over USB: "P" opens the printer screen, "O" the overview. */
void openScreen(char key);

}  // namespace ui
