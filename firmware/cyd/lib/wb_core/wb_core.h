// What the display knows, and the small pure functions that fill it in. No Arduino includes here, so all of
// it is tested on the computer (test/test_core) before it goes near a board.
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace wb {

constexpr size_t ID_LEN = 32;
constexpr size_t NAME_LEN = 48;
constexpr size_t SHORT_LEN = 28;
constexpr size_t PATH_LEN = 72;
constexpr size_t MAX_ITEMS = 40;
constexpr size_t MAX_LOCATIONS = 40;
/** A response bigger than this is refused rather than parsed: the board has no memory to spare. */
constexpr size_t MAX_RESPONSE = 16 * 1024;

/** One row on the screen, already worded by the server. */
struct Item {
  char id[ID_LEN];
  char name[NAME_LEN];
  char sub[NAME_LEN];
  char qty[SHORT_LEN];
  char at[SHORT_LEN];
  uint32_t color;   // 0xRRGGBB
  bool hasColor;
  float fill;       // 0..1, or -1 when the item has no full amount to compare with
  bool low;
  bool tagged;
};

struct Place {
  char id[ID_LEN];
  char name[PATH_LEN];
};

/** How a printer is doing, for the colour of its dot. */
enum class Tone : uint8_t { Ok, Busy, Warn, Error, Off };

constexpr size_t MAX_TRAYS = 8;

struct TrayInfo {
  char label[6];      // "A1", "Ext"
  char material[16];
  uint32_t color;
  bool hasColor;
  bool active;        // feeding the print now
  bool empty;
};

/** The printer chosen as beside the display, worded by the server. */
struct PrinterInfo {
  char name[36];
  char state[28];     // "Printing", "Idle", "Bridge offline" ...
  Tone tone;
  float progress;     // 0..1, or -1 when nothing is running
  char left[24];      // "1 h 34 min left"
  char job[44];
  char layer[28];     // "Layer 112 of 300"
  char temps[48];     // "Nozzle 220/220 C  Bed 60/60 C"
  char error[96];
  size_t trayCount;
  TrayInfo trays[MAX_TRAYS];
};

struct Overview {
  char v[24];
  int poll;
  char workspace[NAME_LEN];
  char device[NAME_LEN];
  bool canWrite;
  bool hasLocation;
  Place location;     // name is the location's own name
  char path[PATH_LEN];
  int total;
  int lowCount;
  size_t itemCount;
  Item items[MAX_ITEMS];
  size_t placeCount;
  Place places[MAX_LOCATIONS];
  bool hasPrinter;    // a printer is chosen for this display in Settings
  PrinterInfo printer;
};

/** What the server said about a tapped tag. */
struct TagInfo {
  bool known;
  char uid[24];
  Item item;
  char where[PATH_LEN];  // where the item is kept, "" when nowhere
  bool here;
  bool canPutAway;
  bool canLink;
  bool canInsert;
  char printer[NAME_LEN];
};

struct PairResult {
  char token[96];
  char deviceName[NAME_LEN];
  char workspaceName[NAME_LEN];
};

struct ItemList {
  size_t count;
  Item items[MAX_ITEMS];
};

bool parseOverview(const char *json, size_t len, Overview &out);
bool parseTag(const char *json, size_t len, TagInfo &out);
bool parsePair(const char *json, size_t len, PairResult &out);
bool parseItemList(const char *json, size_t len, ItemList &out);
/** The "error" or "message" text of a response, or "" when it has neither. */
void parseMessage(const char *json, size_t len, char *out, size_t outLen);

/** "#1a2b3c" → 0x1A2B3C. False for anything else. */
bool parseColor(const char *text, uint32_t &out);

/**
 * A set-up code as typed: capitals and digits only, the way the server compares it. True when it has the
 * twelve characters a code always has.
 */
bool normalizeCode(const char *in, char *out, size_t outLen);

/**
 * A server address as typed on a phone: trimmed, "http://" added when no scheme was given, no trailing
 * slash. False when nothing usable is left or the scheme is not http or https.
 */
bool normalizeServer(const char *in, char *out, size_t outLen);
bool isHttps(const char *url);

/** Reader bytes as the server expects them: two capital hex digits per byte. */
void uidToHex(const uint8_t *uid, size_t len, char *out, size_t outLen);

/** Waits between failed polls: 5 s, doubling, at most 5 minutes. `failures` counts from 1. */
uint32_t backoffMs(unsigned failures);

/** "just now", "1 min ago", "12 min ago", "3 h ago". */
void formatAgo(uint32_t seconds, char *out, size_t outLen);

/** Copy that always ends in a NUL and never overruns. */
void copyText(char *out, size_t outLen, const char *in);

}  // namespace wb
