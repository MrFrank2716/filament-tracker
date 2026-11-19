// Bring-up check for a new CYD: is the panel driver right, and does touch line up with the screen?
//
// Shows four colour bars labelled RED, GREEN, BLUE and WHITE. If the colours do not match their labels, or
// white looks black, the panel is the other kind: flash the other env. Touching the screen draws a dot where
// it was read and prints the raw reading over serial; a touch on the bottom strip toggles colour inversion.

#include <Arduino.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <XPT2046_Touchscreen.h>

// Touch has its own pins on the CYD.
static constexpr int TOUCH_CS = 33, TOUCH_IRQ = 36, TOUCH_MOSI = 32, TOUCH_MISO = 39, TOUCH_CLK = 25;

static TFT_eSPI tft;
static SPIClass touchSpi(VSPI);
static XPT2046_Touchscreen touch(TOUCH_CS, TOUCH_IRQ);
static bool inverted = false;

// Raw readings of this board's touch layer at the screen edges (typical CYD values, refined from serial output).
static constexpr int RAW_X_MIN = 200, RAW_X_MAX = 3700, RAW_Y_MIN = 240, RAW_Y_MAX = 3800;

static void drawBars() {
  const int w = tft.width(), barH = (tft.height() - 40) / 4;
  const uint16_t colours[] = {TFT_RED, TFT_GREEN, TFT_BLUE, TFT_WHITE};
  const char *labels[] = {"RED", "GREEN", "BLUE", "WHITE"};
  for (int i = 0; i < 4; i++) {
    tft.fillRect(0, i * barH, w, barH, colours[i]);
    tft.setTextColor(i == 3 ? TFT_BLACK : TFT_WHITE, colours[i]);
    tft.drawString(labels[i], 10, i * barH + barH / 2 - 8, 4);
  }
  tft.fillRect(0, 4 * barH, w, tft.height() - 4 * barH, TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.drawString(String("Panel: ") + WB_PANEL + (inverted ? "  inverted" : "") + "   tap here to invert", 6, 4 * barH + 12, 2);
}

void setup() {
  Serial.begin(115200);
  delay(200);
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH);
  tft.init();
  tft.setRotation(1);  // landscape, USB connector on the right
  drawBars();
  touchSpi.begin(TOUCH_CLK, TOUCH_MISO, TOUCH_MOSI, TOUCH_CS);
  touch.begin(touchSpi);
  touch.setRotation(1);
  Serial.printf("\nWrkbench bring-up. Panel driver: %s, screen %dx%d. Touch the screen to test it.\n", WB_PANEL, tft.width(), tft.height());
}

void loop() {
  if (!touch.touched()) {
    delay(20);
    return;
  }
  const TS_Point p = touch.getPoint();
  const int x = constrain(map(p.x, RAW_X_MIN, RAW_X_MAX, 0, tft.width() - 1), 0, tft.width() - 1);
  const int y = constrain(map(p.y, RAW_Y_MIN, RAW_Y_MAX, 0, tft.height() - 1), 0, tft.height() - 1);
  Serial.printf("touch raw x=%d y=%d z=%d -> screen x=%d y=%d\n", p.x, p.y, p.z, x, y);
  if (y > tft.height() - 40) {
    inverted = !inverted;
    tft.invertDisplay(inverted);
    drawBars();
    Serial.printf("inversion %s\n", inverted ? "on" : "off");
    delay(400);
  } else {
    tft.fillCircle(x, y, 4, TFT_BLACK);
    tft.drawCircle(x, y, 6, TFT_YELLOW);
  }
  delay(30);
}
