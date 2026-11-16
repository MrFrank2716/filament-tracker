# Location displays

A location display is a small touch screen fixed to a shelf, rack or dry box. It shows what is stored there and how much of each is left, with anything running low at the top, and updates by itself. Items in a location inside it (a shelf in a rack, say) are shown too, with a small "at Shelf 2" note.

With an optional tag reader fitted, tapping a spool's [sticker](Spool-tags.md) on the display shows that spool, and can put it away there, mark it as the next spool going into the printer beside it, or link a new sticker to an item.

## What to buy

- **The display**: an ESP32-2432S028R, sold as the "Cheap Yellow Display" or CYD. Get the **2.8 inch version with a USB-C port**. They cost little and need no soldering.
- **A USB-C cable and a USB power supply** to run it. A phone charger is enough.
- **Optional, a tag reader**: a PN532 NFC module (the common red or blue board) and four jumper wires. Set the module's switches to **I2C**. Readers on SPI, such as the RC522, are not supported: the CYD has no free pins for them.

## Flashing it

The display needs Wrkbench's firmware put on it once, from a computer. Plug it in by USB and follow [firmware/README.md](../../firmware/README.md). In short: install PlatformIO, then run `pio run -d firmware/cyd -e cyd-st7789 -t upload`.

These boards come with one of two kinds of screen. If the colours look wrong after flashing (white looks black, or everything looks like a photo negative), flash `cyd-ili9341` instead. If flashing stops with "Wrong boot mode", hold the board's **BOOT** button, press and release **RST**, let go of BOOT, and try again.

## Setting it up

1. In Wrkbench, open **Settings**, then **Displays**, and choose **Add display**. Give it a name ("Rack A display") and choose the location it shows. Wrkbench shows the server's address and a set-up code. The code works once, for ten minutes. Admins and owners can add displays; a workspace can have up to five.
2. Power the display. It shows the name and password of its own Wi-Fi network, **Wrkbench-** followed by four characters. Join it from your phone. A set-up page opens (if it does not, go to `192.168.4.1`).
3. On that page choose your workshop's Wi-Fi and type its password, then the **Wrkbench address** and the **set-up code** from step 1. Save.

The display joins your Wi-Fi, swaps the code for a key of its own, and shows the location within a minute. In Settings its card turns to **Connected**.

If the code was mistyped or has run out, the display shows a keyboard: make a new code in Settings and type it in there.

**The address** must be one the display can reach over your Wi-Fi:

- On the hosted Wrkbench, it is the address you use in the browser.
- On your own copy, use the address other devices on your network reach it at, such as `http://192.168.1.20:4000`, never `localhost`. Settings warns when the address it would show is `localhost`; set `APP_URL` on the server to fix it for good.
- A self-hosted `https://` address with a certificate of its own (not Let's Encrypt or another public authority) is refused unless you tick **Accept any certificate** on the set-up page.

## Using it

- **Scroll** the list with a finger. Each row has the item's colour, name, material and brand, the amount left and, when the item has a full amount set, a bar.
- **Tap the top bar** to look at another location. After two minutes untouched it goes back to its own.
- **Hold the top bar** for details: the display's name, workspace, server, Wi-Fi signal and firmware. From there **New code** asks for a new set-up code, and **Set up again** (press twice) forgets everything, Wi-Fi included.
- The dot at the top right is green while it is up to date and orange when it cannot reach Wrkbench. It keeps showing what it last had, with "Offline, updated 5 min ago", and tries again by itself.
- The screen dims after five minutes untouched.
- At most 40 items are listed; "+12 more in Wrkbench" says how many are left out.

## Changing what it shows

In **Settings**, **Displays**, each display has:

- **Shows**: the location. It changes on the display within half a minute.
- **Printer beside it**: for "going into the printer" when a spool is tapped.
- **Allow changes from this display**: on by default. When it is off, tapping a tag only shows the spool.
- **Rename**, **New set-up code** (to set it up again, say after it was reset) and **Remove**. Removing a display stops it at once: its screen goes back to asking for a code.

## The tag reader

Wire the PN532 to the CYD's 4-pin connector marked **CN1**: 3.3V to VCC, GND to GND, **IO22 to SDA** and **IO27 to SCL**. The display finds the reader when it starts; without one it is a plain location display. Settings shows "tag reader connected" on its card.

Tap a spool's sticker on the reader:

- **A spool Wrkbench knows**: its colour, name, amount left and where it is kept. **Put away here** moves it to this display's location. **Into X1C** marks it as the next spool going into the printer beside the display, the same as [scan, then insert](Spool-tags.md): put it in the printer within two minutes. The card closes by itself after 20 seconds.
- **A tag that is not linked to anything**: **Link to an item** lists the untagged items in this location; choose one and confirm. The sticker is then that item's.

Changes made from a display appear in the [activity log](Dashboard-and-reports.md) under the display's name.

Tags found are stickers written by Wrkbench, and tags whose id was typed in by hand. A Bambu Lab spool's own tag is **not** recognised by the reader: the printer reports a different id for the spool than the chip id a reader sees. A spool that carries the printer's own tag cannot be given a sticker from the display either, so the printer keeps recognising it.

## What the display can do

A display has its own key, separate from any member's sign-in. With it, it can read the items, locations and amounts of its workspace. While **Allow changes** is on, it can also move a tapped spool to its location, mark a spool for its printer and link stickers. It cannot change amounts, delete anything or reach any other part of Wrkbench. If a display is lost, **Remove** it in Settings and its key stops working at once.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Colours look wrong or like a negative | Flash the other kind of screen (`cyd-ili9341`). |
| Taps land in the wrong place | See "Touch lands in the wrong place" in [firmware/README.md](../../firmware/README.md). |
| "Joining Wi-Fi" for a long time | The Wi-Fi is out of reach or its password changed. Use **Set up again** (press twice) and set it up from your phone. |
| "Cannot reach Wrkbench" | Check the address from a phone on the same Wi-Fi. On your own copy, check the computer's firewall lets port 4000 in. A wrong address: **Set up again**. |
| "That set-up code is not valid or has run out" | Make a new code in Settings, Displays, and type it on the display's keyboard. |
| "This display was removed or set up again" | It was removed in Settings, or set up again with a new code. Make a new code. |
| Accented letters look plain ("Cafe") | The display's fonts have plain letters only; names are shown without accents. |

## Good to know

- **Checked so far:** on a real 2.8" USB-C board (ST7789 panel), set-up from a phone, pairing with an `https://` server and showing a location's items all work. Still to try on real hardware: the tag reader (the code has not met a real PN532 yet), recovering from a Wi-Fi or server outage, and removing a display in Settings.
- The display asks for updates every 30 seconds; when nothing changed the answer is a few bytes.
- On your own server, `DEVICES_ENABLED=false` switches displays off and `DEVICE_MAX_PER_WORKSPACE` changes the limit of five. See [Self-hosting](Self-hosting.md).
