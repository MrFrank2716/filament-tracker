// Unlocking a Bambu Lab spool's own tag. No Arduino code in here, so it is tested on a computer.
//
// The tag is a MIFARE Classic chip with 16 sectors, each locked with its own 6-byte key. The keys follow from
// the tag's serial: HKDF-SHA256 over the serial with a fixed salt, as worked out by the community and written
// up in the Bambu Lab RFID Tag Guide (github.com/queengooborg/Bambu-Lab-RFID-Tag-Guide). The display only
// reads; what the blocks say is worked out by the server.
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace wb {

constexpr size_t BAMBU_SECTORS = 16;
constexpr size_t MIFARE_KEY_LEN = 6;
/** The data blocks the server reads a spool from: material, colour and size, temperatures, and the spool's id. */
constexpr uint8_t BAMBU_BLOCKS[] = {1, 2, 4, 5, 6, 9};
constexpr size_t BAMBU_BLOCK_COUNT = sizeof BAMBU_BLOCKS;
/** Room for blocksJson(): each block is `"9":"` + 32 hex digits + `",`. */
constexpr size_t BAMBU_JSON_LEN = BAMBU_BLOCK_COUNT * 40;

void sha256(const uint8_t *data, size_t len, uint8_t out[32]);
void hmacSha256(const uint8_t *key, size_t keyLen, const uint8_t *data, size_t len, uint8_t out[32]);

/** The "A" key of each of the tag's 16 sectors, from its serial. */
void bambuKeys(const uint8_t *uid, size_t uidLen, uint8_t keys[BAMBU_SECTORS][MIFARE_KEY_LEN]);

/**
 * Adds one block to the inside of a JSON object, as `"9":"0A1B…"`, with a comma before it when it is not the
 * first. `out` must already hold a string (empty to begin with). False when it does not fit.
 */
bool appendBlockJson(char *out, size_t outLen, uint8_t block, const uint8_t data[16]);

}  // namespace wb
