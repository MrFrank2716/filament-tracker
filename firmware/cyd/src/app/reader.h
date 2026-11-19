// An optional NFC/RFID reader. The display works the same without one; with one, a tapped tag's UID is passed
// to the screen. A Bambu Lab spool's own tag is also unlocked and its data read, since its UID alone does not
// say which spool it is. Only the PN532 over I2C is supported (the CYD has no free SPI pins for an RC522).
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace reader {

/** Look for a reader on the CYD's 4-pin connector (SDA 22, SCL 27). False when none answers. */
bool begin();
/** Start reading tags on a task of its own. Each new tag arrives through take(). */
void start();
/**
 * The UID of a newly tapped tag, as hex, if one is waiting. The same tag is ignored for 3 s.
 * `blocks` gets a Bambu Lab spool's data blocks as the inside of a JSON object ("1":"…","2":"…"), or "" for
 * any other tag. It needs wb::BAMBU_JSON_LEN bytes.
 */
bool take(char *uidHex, size_t len, char *blocks, size_t blocksLen);

}  // namespace reader
