// PN532 in I2C mode on the CYD's 4-pin connector CN1: 3.3V, GND, IO22 (SDA), IO27 (SCL).
#include <Adafruit_PN532.h>
#include <Arduino.h>
#include <Wire.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include <string.h>

#include "reader.h"
#include "wb_bambu.h"
#include "wb_core.h"

namespace reader {
namespace {

constexpr int SDA_PIN = 22, SCL_PIN = 27;
constexpr uint32_t SAME_TAG_MS = 3000;
constexpr uint8_t NO_PIN = 255;  // IRQ and reset are not wired; the library then polls over I2C

Adafruit_PN532 *nfc = nullptr;
QueueHandle_t taps = nullptr;

struct Tap {
  char uid[24];
  char blocks[wb::BAMBU_JSON_LEN];  // a Bambu Lab spool's data, "" for any other tag
};

/**
 * A Bambu Lab spool's tag: unlock each sector with the key that follows from the serial and read the blocks the
 * server wants. False for any other MIFARE Classic tag (the keys do not fit), or when the spool moved mid-read.
 */
bool readBambu(uint8_t *uid, uint8_t len, char *json, size_t jsonLen) {
  uint8_t keys[wb::BAMBU_SECTORS][wb::MIFARE_KEY_LEN];
  wb::bambuKeys(uid, len, keys);
  json[0] = '\0';
  int unlocked = -1;
  for (const uint8_t block : wb::BAMBU_BLOCKS) {
    const int sector = block / 4;
    if (sector != unlocked) {
      if (!nfc->mifareclassic_AuthenticateBlock(uid, len, block, 0, keys[sector])) return false;
      unlocked = sector;
    }
    uint8_t data[16];
    if (!nfc->mifareclassic_ReadDataBlock(block, data)) return false;
    if (!wb::appendBlockJson(json, jsonLen, block, data)) return false;
  }
  return true;
}

void task(void *) {
  char last[24] = "";
  uint32_t lastAt = 0;
  for (;;) {
    uint8_t uid[10];
    uint8_t len = 0;
    // A short timeout so a missing card never holds the bus for long.
    if (nfc->readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &len, 80) && len >= 4 && len <= 10) {
      Tap tap{};
      wb::uidToHex(uid, len, tap.uid, sizeof tap.uid);
      const uint32_t now = millis();
      if (strcmp(tap.uid, last) != 0 || now - lastAt > SAME_TAG_MS) {
        // Bambu's tags have a 4-byte serial. Anything else, or a tag the keys do not open, is passed on by its UID alone.
        if (len == 4 && !readBambu(uid, len, tap.blocks, sizeof tap.blocks)) tap.blocks[0] = '\0';
        xQueueSend(taps, &tap, 0);
      }
      // Kept fresh while the tag stays on the reader, so leaving it there does not repeat it every 3 s.
      wb::copyText(last, sizeof last, tap.uid);
      lastAt = now;
    }
    vTaskDelay(pdMS_TO_TICKS(150));
  }
}

}  // namespace

bool begin() {
  Wire.begin(SDA_PIN, SCL_PIN, 100000);
  Wire.setTimeOut(50);
  // A quick knock on the PN532's address first: without a reader the library would retry for ~20 s.
  Wire.beginTransmission(PN532_I2C_ADDRESS);
  if (Wire.endTransmission() != 0) {
    Wire.end();
    return false;
  }
  nfc = new Adafruit_PN532(NO_PIN, NO_PIN, &Wire);
  if (!nfc->begin()) return false;
  const uint32_t version = nfc->getFirmwareVersion();
  if (!version) return false;
  Serial.printf("Tag reader: PN5%02X firmware %u.%u\n", static_cast<unsigned>((version >> 24) & 0xFF), static_cast<unsigned>((version >> 16) & 0xFF),
                static_cast<unsigned>((version >> 8) & 0xFF));
  nfc->SAMConfig();
  return true;
}

void start() {
  if (!nfc || taps) return;
  taps = xQueueCreate(2, sizeof(Tap));
  xTaskCreatePinnedToCore(task, "wb-reader", 6144, nullptr, 1, nullptr, 0);
}

bool take(char *uidHex, size_t len, char *blocks, size_t blocksLen) {
  static Tap tap;  // too big for the screen task's stack to hold twice
  if (!taps || xQueueReceive(taps, &tap, 0) != pdTRUE) return false;
  wb::copyText(uidHex, len, tap.uid);
  wb::copyText(blocks, blocksLen, tap.blocks);
  return true;
}

}  // namespace reader
