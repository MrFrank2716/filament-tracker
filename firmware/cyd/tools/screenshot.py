"""Save what a location display is showing as a PNG, over its USB cable.

    python tools/screenshot.py COM3 shot.png

Needs pyserial (comes with PlatformIO). Close any serial monitor first: only one program can hold the port.
"""
import struct
import sys
import time
import zlib

import serial


def png(width, height, rgb):
    rows = b"".join(b"\x00" + rgb[y * width * 3:(y + 1) * width * 3] for y in range(height))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def main():
    port, out = sys.argv[1], sys.argv[2]
    s = serial.Serial()
    s.port, s.baudrate, s.timeout, s.dtr, s.rts = port, 115200, 30, False, False
    s.open()
    time.sleep(0.2)
    s.reset_input_buffer()
    s.write(b"S")
    header = b""
    deadline = time.time() + 10
    while not header.endswith(b"\n") or b"WBSHOT" not in header:
        if time.time() > deadline:
            raise SystemExit("The display did not answer. Is it running the Wrkbench firmware?")
        byte = s.read(1)
        header = (header + byte)[-40:] if byte else header
    width, height = map(int, header[header.index(b"WBSHOT"):].split()[1:3])
    raw = s.read(width * height * 2)
    s.close()
    if len(raw) != width * height * 2:
        raise SystemExit(f"Only {len(raw)} of {width * height * 2} bytes arrived")
    rgb = bytearray()
    for i in range(0, len(raw), 2):
        value = (raw[i] << 8) | raw[i + 1]
        rgb += bytes((((value >> 11) & 0x1F) * 255 // 31, ((value >> 5) & 0x3F) * 255 // 63, (value & 0x1F) * 255 // 31))
    with open(out, "wb") as f:
        f.write(png(width, height, bytes(rgb)))
    print(f"Saved {out}")


if __name__ == "__main__":
    main()
