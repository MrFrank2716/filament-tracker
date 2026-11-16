# Wrkbench firmware

Firmware for hardware of Wrkbench's own. For now there is one device: the **location display** in `cyd/`, a
2.8" touch screen board fixed to a shelf, rack or dry box that shows what is stored there. How to buy one, set it
up and use it is in the wiki: [Location displays](../docs/wiki/Location-displays.md).

## Building and flashing

You need [PlatformIO Core](https://docs.platformio.org/page/core/installation/index.html)
(`pip install platformio`). The first build downloads the ESP32 toolchain (about 1 GB).

```bash
cd firmware/cyd
pio run -e cyd-st7789 -t upload     # build and flash
pio device monitor                  # what it prints over USB
```

The USB-C version of the board ships with either an ST7789 or an ILI9341 panel, and nothing on the board says
which. Flash `cyd-st7789` first. If the colours are wrong (white looks black, or everything looks like a photo
negative), flash `cyd-ili9341` instead. To check a new board without the full firmware, flash `bringup-st7789`
(or `bringup-ili9341`): it shows four bars labelled RED, GREEN, BLUE and WHITE, prints touch readings over USB,
and a tap on the bottom strip toggles colour inversion.

- **Windows, "No such file or directory" for `lv_conf_internal.h`:** the build path is too long for Windows.
  Build with a short PlatformIO folder: `set PLATFORMIO_WORKSPACE_DIR=C:\wbpio` (PowerShell:
  `$env:PLATFORMIO_WORKSPACE_DIR = "C:\wbpio"`), or turn on Windows long paths.
- **"Wrong boot mode detected" when flashing:** some boards do not enter flashing mode by themselves. Hold the
  **BOOT** button, press and release **RST**, then release BOOT, and flash again.
- **Red and blue swapped:** set `-DTFT_RGB_ORDER` the other way in the env's build flags. The USB-C board with an
  ST7789 needs `TFT_BGR`, which `cyd-st7789` already sets.
- **Touch lands in the wrong place:** flash the bring-up env, note the raw readings at the four corners, and set
  `-DWB_TOUCH_X_MIN=… -DWB_TOUCH_X_MAX=… -DWB_TOUCH_Y_MIN=… -DWB_TOUCH_Y_MAX=…`.

## Working on the screens

- **See the screen from the computer:** `python tools/screenshot.py COM3 shot.png` (any port name) asks the display
  to redraw and saves exactly what it drew as a PNG. It works with every build.
- **Update over Wi-Fi instead of USB:** the `cyd-st7789-dev` env also accepts new firmware over Wi-Fi, protected by
  a password you choose. Set `WB_OTA_PASSWORD` in the environment, flash that env over USB once, then
  `pio run -e cyd-st7789-dev -t upload --upload-port <the display's IP>`. The computer must accept an incoming
  connection from the display (Windows asks to allow Python through the firewall). Release envs never listen.

## Layout

| Path | What it is |
|---|---|
| `cyd/platformio.ini` | Board, libraries (pinned) and the panel variants |
| `cyd/src/app/` | The display: `main` (start-up), `display` (screen, touch, LVGL), `portal` (set-up page for a phone), `net` (server, on its own task), `ui` (screens), `store` (saved settings), `reader_pn532` (optional tag reader) |
| `cyd/src/bringup/` | Colour bars and touch test for a new board |
| `cyd/lib/wb_core/` | Parsing and tidying with no Arduino code in it, so it is tested on a computer |
| `cyd/test/test_core/` | Unity tests for `wb_core` |
| `cyd/certs/make_certs.py` | Writes `src/app/certs.h`, the root certificates trusted for `https://` servers |
| `cyd/include/lv_conf.h` | LVGL settings |

## Tests

The `wb_core` tests run on a computer with a C++ compiler (`pio test -e native`), or on the board itself
(`pio test -e test-board`). Without a compiler on Windows, `pip install ziglang` provides one:

```bash
cd firmware/cyd
python -m ziglang cc -c -I .pio/libdeps/test-board/Unity/src .pio/libdeps/test-board/Unity/src/unity.c -o unity.o
python -m ziglang c++ -std=gnu++17 -I lib/wb_core -I .pio/libdeps/test-board/ArduinoJson/src -I .pio/libdeps/test-board/Unity/src test/test_core/test_core.cpp lib/wb_core/wb_core.cpp unity.o -o test_core.exe
./test_core.exe
```

(`pio pkg install -e test-board` fetches Unity and ArduinoJson into `.pio/libdeps/test-board` first.)

## How it talks to the server

The display uses its own token (`wbd_…`), which it gets once by sending the set-up code to
`POST /api/device/pair`. After that it polls `GET /api/device/overview` every 30 seconds (304 when nothing
changed), and with a reader fitted calls `GET /api/device/tag/:uid` and the put-away, insert and link routes next
to it. The server side is `server/src/routes/devices.ts`.
