// The screen and its touch layer, wired into LVGL. Everything here runs on the main loop task only.
#pragma once

#include <stdint.h>

namespace display {

/** Screen, touch and LVGL. Call once from setup(). */
void begin();
/** Let LVGL draw and read touch. Call from loop(). */
void tick();
/** Dim the backlight after a while without touch, and bring it back on the next touch. */
void setBrightness(uint8_t level);
/** Milliseconds since the screen was last touched. */
uint32_t idleMs();

}  // namespace display
