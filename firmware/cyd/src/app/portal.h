// First-time set-up from a phone: the display opens its own Wi-Fi network with a page that takes the
// workshop's Wi-Fi, the Wrkbench address and the set-up code. Runs on the main loop, alongside the screen.
#pragma once

#include "store.h"

namespace portal {

/** Whether Wi-Fi and a server address are already saved, so the display can just connect. */
bool configured(const store::Settings &settings);
/** Open the set-up network. Its name and password are filled in for the screen to show. */
void open(char *apName, size_t nameLen, char *apPassword, size_t passwordLen);
/**
 * Keep the set-up page answering. True once the phone has saved the form and the display joined the Wi-Fi;
 * `settings` then holds what was entered.
 */
bool process(store::Settings &settings);
/** Join the saved Wi-Fi without the set-up page. */
void connect();

}  // namespace portal
