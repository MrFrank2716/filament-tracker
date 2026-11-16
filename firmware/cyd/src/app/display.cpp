#include "display.h"

#include <Arduino.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <XPT2046_Touchscreen.h>
#include <lvgl.h>

namespace display {
namespace {

// Touch has its own pins on the CYD.
constexpr int TOUCH_CS = 33, TOUCH_IRQ = 36, TOUCH_MOSI = 32, TOUCH_MISO = 39, TOUCH_CLK = 25;
// Raw touch readings at the screen's edges. Typical for this board; a build flag can override them.
#ifndef WB_TOUCH_X_MIN
#define WB_TOUCH_X_MIN 200
#define WB_TOUCH_X_MAX 3700
#define WB_TOUCH_Y_MIN 240
#define WB_TOUCH_Y_MAX 3800
#endif

constexpr int WIDTH = 320, HEIGHT = 240;
constexpr int BUFFER_LINES = 24;
constexpr int BL_CHANNEL = 0;

TFT_eSPI tft;
SPIClass touchSpi(VSPI);
XPT2046_Touchscreen touch(TOUCH_CS, TOUCH_IRQ);
uint16_t buffer[WIDTH * BUFFER_LINES];
uint32_t lastTouch = 0;
bool capturing = false;  // while true, each drawn area is also sent over USB (sendScreenshot)

void flush(lv_display_t *disp, const lv_area_t *area, uint8_t *pixels) {
  const uint32_t w = lv_area_get_width(area), h = lv_area_get_height(area);
  if (capturing) {
    // Before the panel push, which may swap the bytes in place. LVGL's own RGB565, low byte first.
    Serial.printf("WBAREA %d %d %u %u\n", area->x1, area->y1, static_cast<unsigned>(w), static_cast<unsigned>(h));
    Serial.write(pixels, w * h * 2);
  }
  tft.startWrite();
  tft.setAddrWindow(area->x1, area->y1, w, h);
  tft.pushColors(reinterpret_cast<uint16_t *>(pixels), w * h, true);
  tft.endWrite();
  lv_display_flush_ready(disp);
}

void readTouch(lv_indev_t *, lv_indev_data_t *data) {
  if (!touch.touched()) {
    data->state = LV_INDEV_STATE_RELEASED;
    return;
  }
  const TS_Point p = touch.getPoint();
  if (p.z < 200) {  // too light a press to be sure where it is
    data->state = LV_INDEV_STATE_RELEASED;
    return;
  }
  data->point.x = constrain(map(p.x, WB_TOUCH_X_MIN, WB_TOUCH_X_MAX, 0, WIDTH - 1), 0, WIDTH - 1);
  data->point.y = constrain(map(p.y, WB_TOUCH_Y_MIN, WB_TOUCH_Y_MAX, 0, HEIGHT - 1), 0, HEIGHT - 1);
  data->state = LV_INDEV_STATE_PRESSED;
  lastTouch = millis();
}

uint32_t tickSource() { return millis(); }

}  // namespace

void begin() {
  tft.init();
  tft.setRotation(1);  // landscape, USB on the right
#ifdef WB_INVERT
  // Only when a build asks for it: each driver's own start-up already sets the usual inversion for its panel.
  tft.invertDisplay(WB_INVERT);
#endif
  tft.fillScreen(TFT_BLACK);
  // After init, which takes the backlight pin as a plain output: PWM so the screen can dim.
  ledcSetup(BL_CHANNEL, 5000, 8);
  ledcAttachPin(TFT_BL, BL_CHANNEL);
  setBrightness(255);

  touchSpi.begin(TOUCH_CLK, TOUCH_MISO, TOUCH_MOSI, TOUCH_CS);
  touch.begin(touchSpi);
  touch.setRotation(1);

  lv_init();
  lv_tick_set_cb(tickSource);
  lv_display_t *disp = lv_display_create(WIDTH, HEIGHT);
  lv_display_set_flush_cb(disp, flush);
  lv_display_set_buffers(disp, buffer, nullptr, sizeof buffer, LV_DISPLAY_RENDER_MODE_PARTIAL);
  lv_indev_t *indev = lv_indev_create();
  lv_indev_set_type(indev, LV_INDEV_TYPE_POINTER);
  lv_indev_set_read_cb(indev, readTouch);
  lastTouch = millis();
}

void tick() { lv_timer_handler(); }

void setBrightness(uint8_t level) { ledcWrite(BL_CHANNEL, level); }

uint32_t idleMs() { return millis() - lastTouch; }

void sendScreenshot() {
  // The panel's read-back is unreliable on these boards, so redraw the whole screen and send what LVGL draws.
  Serial.printf("WBSHOT %d %d\n", WIDTH, HEIGHT);
  capturing = true;
  lv_obj_invalidate(lv_screen_active());
  lv_obj_invalidate(lv_layer_top());
  lv_refr_now(nullptr);
  capturing = false;
  Serial.print("WBDONE\n");
  Serial.flush();
}

}  // namespace display
