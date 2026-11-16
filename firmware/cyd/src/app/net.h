// Talking to the Wrkbench server, on a FreeRTOS task of its own so a slow network never freezes the screen.
// The screen sends Commands and receives Results through queues; nothing here touches LVGL.
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "store.h"
#include "wb_core.h"

namespace net {

enum class Phase : uint8_t {
  Connecting,   // waiting for Wi-Fi
  Pairing,      // swapping a set-up code for a token
  NeedCode,     // no token and no code: the screen asks for one
  Online,       // the last poll worked
  Offline,      // the last poll failed; showing what we had
};

struct Status {
  Phase phase;
  uint32_t lastOkMs;  // millis() of the last answer from the server, 0 if none yet
  char message[96];   // why it is offline, in a few words
  int rssi;
  char ip[16];
};

enum class CommandType : uint8_t {
  Pair,      // arg: a 12-character set-up code
  Browse,    // arg: a location id, or "" for the display's own location
  Refresh,   // poll now
  Tag,       // arg: UID in hex
  PutAway,   // arg: UID
  Insert,    // arg: UID
  Link,      // arg: UID, arg2: item id
  Untagged,  // items here without a tag
  Forget,    // drop the token: the display asks for a new set-up code
};

struct Command {
  CommandType type;
  char arg[32];
  char arg2[32];
};

enum class ResultType : uint8_t {
  Overview,      // data: wb::Overview*, which the receiver frees
  Tag,           // data: wb::TagInfo*
  Untagged,      // data: wb::ItemList*
  Action,        // ok + message (put away, insert, link)
  Paired,        // message: the display's name
  PairFailed,    // message: why
  Unauthorized,  // the token stopped working: removed or set up again elsewhere
};

struct Result {
  ResultType type;
  bool ok;
  char message[96];
  void *data;
};

/** Start the task. `settings` is copied; `hasReader` is reported to the server with each poll. */
void start(const store::Settings &settings, bool hasReader);
void send(const Command &command);
/** A result waiting for the screen, if any. */
bool receive(Result &out);
Status status();

}  // namespace net
