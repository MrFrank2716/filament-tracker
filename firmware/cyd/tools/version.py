# PlatformIO pre-build script: sets WB_VERSION, the firmware's version.
#
# A release takes it from its tag (the Display firmware workflow sets WB_FIRMWARE_VERSION from firmware-v0.3.3),
# so publishing one needs no commit. Without that, as for a build on your own computer, it is custom_wb_version
# in platformio.ini.
import os

Import("env")  # noqa: F821  (provided by PlatformIO)

version = os.environ.get("WB_FIRMWARE_VERSION", "").strip() or env.GetProjectOption("custom_wb_version")  # noqa: F821
env.Append(CPPDEFINES=[("WB_VERSION", env.StringifyMacro(version))])  # noqa: F821
