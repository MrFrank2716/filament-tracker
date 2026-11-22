"""Packages built display firmware for a release, after `pio run` has built the release envs.

    python tools/package_release.py --out dist

For each kind of board it writes two images and describes them in dist/firmware-manifest.json, which is what the
Wrkbench server reads (server/src/services/firmware.ts):

- wrkbench-display-<version>-<model>.bin: the app alone, which a display downloads to update itself over Wi-Fi.
- wrkbench-display-<version>-<model>-full.bin: bootloader, partition table and app in one, written at offset 0
  to flash a new board from the browser.

The version comes from WB_VERSION in platformio.ini, the only place it is set.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent

# The release envs: what a display reports when it pairs ("cyd-28-st7789"), and how a person would name it.
BUILDS = [
    ("cyd-st7789", "cyd-28-st7789", '2.8 inch, ST7789 screen (USB-C)'),
    ("cyd-ili9341", "cyd-28-ili9341", '2.8 inch, ILI9341 screen'),
    ("cyd24-st7789", "cyd-24-st7789", '2.4 inch, ST7789 IPS screen'),
]

# Where each part goes in flash (min_spiffs.csv with the Arduino core's bootloader).
OFFSETS = [("0x1000", "bootloader.bin"), ("0x8000", "partitions.bin"), ("0xe000", "boot_app0.bin"), ("0x10000", "firmware.bin")]


def version() -> str:
    text = (HERE / "platformio.ini").read_text(encoding="utf-8")
    match = re.search(r'-DWB_VERSION=\\"(\d+\.\d+\.\d+)\\"', text)
    if not match:
        sys.exit("WB_VERSION in platformio.ini must be a plain version such as 0.3.0")
    return match.group(1)


def describe(path: Path) -> dict:
    data = path.read_bytes()
    return {"file": path.name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "md5": hashlib.md5(data).hexdigest()}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="dist")
    parser.add_argument("--build-dir", default=os.environ.get("PLATFORMIO_BUILD_DIR", str(HERE / ".pio" / "build")))
    parser.add_argument("--boot-app0", default=str(Path.home() / ".platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin"))
    args = parser.parse_args()

    ver = version()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    builds = []
    for env, model, name in BUILDS:
        built = Path(args.build_dir) / env
        app = out / f"wrkbench-display-{ver}-{model}.bin"
        shutil.copyfile(built / "firmware.bin", app)
        full = out / f"wrkbench-display-{ver}-{model}-full.bin"
        parts = []
        for offset, part in OFFSETS:
            parts += [offset, str(Path(args.boot_app0) if part == "boot_app0.bin" else built / part)]
        subprocess.run(
            [sys.executable, "-m", "esptool", "--chip", "esp32", "merge-bin", "-o", str(full),
             "--flash-mode", "dio", "--flash-freq", "40m", "--flash-size", "4MB", *parts],
            check=True,
        )
        full_info = describe(full)
        del full_info["md5"]
        builds.append({"model": model, "name": name, "app": describe(app), "full": full_info})
    manifest = {"version": ver, "builds": builds}
    (out / "firmware-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
