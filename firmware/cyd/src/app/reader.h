// An optional NFC/RFID reader. The display works the same without one; with one, a tapped tag's UID is passed
// to the screen. Only the PN532 over I2C is supported (the CYD has no free SPI pins for an RC522).
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace reader {

/** Look for a reader on the CYD's 4-pin connector (SDA 22, SCL 27). False when none answers. */
bool begin();
/** Start reading tags on a task of its own. Each new tag arrives through take(). */
void start();
/** The UID of a newly tapped tag, as hex, if one is waiting. The same tag is ignored for 3 s. */
bool take(char *uidHex, size_t len);

}  // namespace reader
