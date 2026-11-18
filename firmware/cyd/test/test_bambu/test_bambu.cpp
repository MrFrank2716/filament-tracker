// Tests for wb_bambu. On a computer with a C++ compiler: pio test -e native -f test_bambu
// The expected values come from elsewhere: `printf abc | sha256sum`, RFC 4231 test case 2, and Node's own HKDF:
//   node -e "const c=require('crypto');console.log(Buffer.from(c.hkdfSync('sha256',Buffer.from('D2B9046C','hex'),Buffer.from('9a759cf2c4f7caff222cb9769b41bc96','hex'),Buffer.from('RFID-A\0'),96)).toString('hex'))"
#include <string.h>
#include <unity.h>

#include "wb_bambu.h"

void setUp() {}
void tearDown() {}

static void toHex(const uint8_t *bytes, size_t len, char *out) {
  static const char digits[] = "0123456789abcdef";
  for (size_t i = 0; i < len; i++) {
    out[i * 2] = digits[bytes[i] >> 4];
    out[i * 2 + 1] = digits[bytes[i] & 15];
  }
  out[len * 2] = '\0';
}

static void test_sha256() {
  uint8_t digest[32];
  char hex[65];
  wb::sha256(reinterpret_cast<const uint8_t *>("abc"), 3, digest);
  toHex(digest, 32, hex);
  TEST_ASSERT_EQUAL_STRING("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", hex);
  // Longer than one block, so the padding spills into a second.
  const char *text = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
  wb::sha256(reinterpret_cast<const uint8_t *>(text), strlen(text), digest);
  toHex(digest, 32, hex);
  TEST_ASSERT_EQUAL_STRING("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1", hex);
}

static void test_hmac() {
  uint8_t digest[32];
  char hex[65];
  const char *data = "what do ya want for nothing?";
  wb::hmacSha256(reinterpret_cast<const uint8_t *>("Jefe"), 4, reinterpret_cast<const uint8_t *>(data), strlen(data), digest);
  toHex(digest, 32, hex);
  TEST_ASSERT_EQUAL_STRING("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843", hex);
}

static void test_keys() {
  const uint8_t uid[4] = {0xD2, 0xB9, 0x04, 0x6C};
  uint8_t keys[wb::BAMBU_SECTORS][wb::MIFARE_KEY_LEN];
  wb::bambuKeys(uid, sizeof uid, keys);
  char hex[193];
  toHex(&keys[0][0], sizeof keys, hex);
  TEST_ASSERT_EQUAL_STRING(
      "4282a2d6dc91552288488d64d59df0d597a727279bc5791c456544ecae32f238480c69a9629a9cfd8ce4ccdcb2a7a326"
      "44fb7684460a5141266c51c48db3ebeb9f0a4c9b080af5277a99a8411a8ab11a8d6d363072d5b9b19054a515e9f6c438",
      hex);
}

static void test_block_json() {
  char json[wb::BAMBU_JSON_LEN] = "";
  uint8_t data[16];
  for (int i = 0; i < 16; i++) data[i] = static_cast<uint8_t>(i * 17);
  TEST_ASSERT_TRUE(wb::appendBlockJson(json, sizeof json, 1, data));
  TEST_ASSERT_TRUE(wb::appendBlockJson(json, sizeof json, 9, data));
  TEST_ASSERT_EQUAL_STRING("\"1\":\"00112233445566778899AABBCCDDEEFF\",\"9\":\"00112233445566778899AABBCCDDEEFF\"", json);
  // All six blocks fit; a buffer too small is refused and left as it was.
  char all[wb::BAMBU_JSON_LEN] = "";
  for (size_t i = 0; i < wb::BAMBU_BLOCK_COUNT; i++) TEST_ASSERT_TRUE(wb::appendBlockJson(all, sizeof all, wb::BAMBU_BLOCKS[i], data));
  char tiny[20] = "";
  TEST_ASSERT_FALSE(wb::appendBlockJson(tiny, sizeof tiny, 1, data));
  TEST_ASSERT_EQUAL_STRING("", tiny);
}

int main() {
  UNITY_BEGIN();
  RUN_TEST(test_sha256);
  RUN_TEST(test_hmac);
  RUN_TEST(test_keys);
  RUN_TEST(test_block_json);
  return UNITY_END();
}
