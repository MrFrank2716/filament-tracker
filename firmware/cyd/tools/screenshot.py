"""Save what a location display is showing as a PNG, over its USB cable.

    python tools/screenshot.py COM3 shot.png

The display redraws its screen and sends each area it draws. Needs pyserial (comes with PlatformIO). Close any
serial monitor first: only one program can hold the port.
"""
import struct
import sys
import time
import zlib

import serial


def png(width, height, rgb):
    rows = b"".join(b"\x00" + bytes(rgb[y * width * 3:(y + 1) * width * 3]) for y in range(height))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def read_line(s, deadline):
    line = b""
    while not line.endswith(b"\n"):
        if time.time() > deadline:
            raise SystemExit("The display stopped answering")
        line += s.read(1)
    return line.strip()


def main():
    port, out = sys.argv[1], sys.argv[2]
    s = serial.Serial()
    s.port, s.baudrate, s.timeout, s.dtr, s.rts = port, 115200, 5, False, False
    s.open()
    time.sleep(0.2)
    s.reset_input_buffer()
    s.write(b"S")
    deadline = time.time() + 60
    line = b""
    while not line.startswith(b"WBSHOT"):
        line = read_line(s, deadline)
    width, height = map(int, line.split()[1:3])
    rgb = bytearray(width * height * 3)
    while True:
        line = read_line(s, deadline)
        if line == b"WBDONE":
            break
        if not line.startswith(b"WBAREA"):
            continue  # log output from the display between areas
        x0, y0, w, h = map(int, line.split()[1:5])
        raw = s.read(w * h * 2)
        if len(raw) != w * h * 2:
            raise SystemExit("An area arrived incomplete")
        for i in range(w * h):
            value = raw[i * 2] | (raw[i * 2 + 1] << 8)
            x, y = x0 + i % w, y0 + i // w
            if 0 <= x < width and 0 <= y < height:
                p = (y * width + x) * 3
                rgb[p:p + 3] = bytes((((value >> 11) & 0x1F) * 255 // 31, ((value >> 5) & 0x3F) * 255 // 63, (value & 0x1F) * 255 // 31))
    s.close()
    with open(out, "wb") as f:
        f.write(png(width, height, rgb))
    print(f"Saved {out}")


if __name__ == "__main__":
    main()
