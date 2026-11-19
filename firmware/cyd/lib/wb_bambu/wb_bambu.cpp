#include "wb_bambu.h"

#include <stdio.h>
#include <string.h>

namespace wb {
namespace {

const uint32_t K[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
    0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
    0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
    0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
    0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

inline uint32_t rotr(uint32_t x, unsigned n) { return (x >> n) | (x << (32 - n)); }

struct Sha {
  uint32_t state[8];
  uint8_t block[64];
  size_t used;
  uint64_t total;
};

void shaBlock(Sha &s) {
  uint32_t w[64];
  for (int i = 0; i < 16; i++) {
    w[i] = (static_cast<uint32_t>(s.block[i * 4]) << 24) | (static_cast<uint32_t>(s.block[i * 4 + 1]) << 16) | (static_cast<uint32_t>(s.block[i * 4 + 2]) << 8) | s.block[i * 4 + 3];
  }
  for (int i = 16; i < 64; i++) {
    const uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
    const uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint32_t a = s.state[0], b = s.state[1], c = s.state[2], d = s.state[3], e = s.state[4], f = s.state[5], g = s.state[6], h = s.state[7];
  for (int i = 0; i < 64; i++) {
    const uint32_t t1 = h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i];
    const uint32_t t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c));
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + t2;
  }
  s.state[0] += a;
  s.state[1] += b;
  s.state[2] += c;
  s.state[3] += d;
  s.state[4] += e;
  s.state[5] += f;
  s.state[6] += g;
  s.state[7] += h;
}

void shaStart(Sha &s) {
  const uint32_t initial[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  memcpy(s.state, initial, sizeof initial);
  s.used = 0;
  s.total = 0;
}

void shaAdd(Sha &s, const uint8_t *data, size_t len) {
  s.total += len;
  for (size_t i = 0; i < len; i++) {
    s.block[s.used++] = data[i];
    if (s.used == 64) {
      shaBlock(s);
      s.used = 0;
    }
  }
}

void shaEnd(Sha &s, uint8_t out[32]) {
  const uint64_t bits = s.total * 8;
  const uint8_t one = 0x80;
  const uint8_t zero = 0;
  shaAdd(s, &one, 1);
  while (s.used != 56) shaAdd(s, &zero, 1);
  uint8_t length[8];
  for (int i = 0; i < 8; i++) length[i] = static_cast<uint8_t>(bits >> (56 - i * 8));
  shaAdd(s, length, 8);
  for (int i = 0; i < 8; i++) {
    out[i * 4] = static_cast<uint8_t>(s.state[i] >> 24);
    out[i * 4 + 1] = static_cast<uint8_t>(s.state[i] >> 16);
    out[i * 4 + 2] = static_cast<uint8_t>(s.state[i] >> 8);
    out[i * 4 + 3] = static_cast<uint8_t>(s.state[i]);
  }
}

const uint8_t SALT[16] = {0x9a, 0x75, 0x9c, 0xf2, 0xc4, 0xf7, 0xca, 0xff, 0x22, 0x2c, 0xb9, 0x76, 0x9b, 0x41, 0xbc, 0x96};
// "RFID-A" and the zero byte that ends it.
const uint8_t INFO[7] = {'R', 'F', 'I', 'D', '-', 'A', 0};

}  // namespace

void sha256(const uint8_t *data, size_t len, uint8_t out[32]) {
  Sha s;
  shaStart(s);
  shaAdd(s, data, len);
  shaEnd(s, out);
}

void hmacSha256(const uint8_t *key, size_t keyLen, const uint8_t *data, size_t len, uint8_t out[32]) {
  uint8_t padded[64] = {0};
  if (keyLen > 64) sha256(key, keyLen, padded);
  else memcpy(padded, key, keyLen);
  uint8_t inner[64];
  uint8_t outer[64];
  for (int i = 0; i < 64; i++) {
    inner[i] = padded[i] ^ 0x36;
    outer[i] = padded[i] ^ 0x5c;
  }
  uint8_t digest[32];
  Sha s;
  shaStart(s);
  shaAdd(s, inner, 64);
  shaAdd(s, data, len);
  shaEnd(s, digest);
  shaStart(s);
  shaAdd(s, outer, 64);
  shaAdd(s, digest, 32);
  shaEnd(s, out);
}

void bambuKeys(const uint8_t *uid, size_t uidLen, uint8_t keys[BAMBU_SECTORS][MIFARE_KEY_LEN]) {
  // HKDF (RFC 5869). Extract: one HMAC of the serial under the salt.
  uint8_t prk[32];
  hmacSha256(SALT, sizeof SALT, uid, uidLen, prk);

  // Expand: 16 keys of 6 bytes is 96 bytes, so three rounds of 32.
  uint8_t out[96];
  uint8_t previous[32];
  uint8_t input[32 + sizeof INFO + 1];
  for (uint8_t round = 1; round <= 3; round++) {
    size_t len = 0;
    if (round > 1) {
      memcpy(input, previous, 32);
      len = 32;
    }
    memcpy(input + len, INFO, sizeof INFO);
    len += sizeof INFO;
    input[len++] = round;
    hmacSha256(prk, sizeof prk, input, len, previous);
    memcpy(out + (round - 1) * 32, previous, 32);
  }
  memcpy(keys, out, sizeof out);
}

bool appendBlockJson(char *out, size_t outLen, uint8_t block, const uint8_t data[16]) {
  const size_t used = strlen(out);
  // A comma, the quoted block number (up to 2 digits), a colon, 32 hex digits in quotes, and the NUL.
  if (used + 1 + 4 + 1 + 34 + 1 > outLen) return false;
  char *at = out + used;
  at += snprintf(at, outLen - used, "%s\"%u\":\"", used ? "," : "", static_cast<unsigned>(block));
  for (int i = 0; i < 16; i++) at += snprintf(at, 3, "%02X", data[i]);
  *at++ = '"';
  *at = '\0';
  return true;
}

}  // namespace wb
