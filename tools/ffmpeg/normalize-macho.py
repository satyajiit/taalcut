#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
"""Give a Mach-O a content-derived LC_UUID and a deterministic ad-hoc signature.

Apple's ld writes a new LC_UUID on every link and an ad-hoc signature over it,
so two otherwise identical links do not hash the same. ld -no_uuid drops
LC_UUID and dyld then refuses the binary. This rewrites the UUID after the
link: zero the field, hash the signature-free file, store the first 16 bytes,
then `codesign -s - -i <filename> --timestamp=none`. The identifier is the
filename, not the path, because codesign otherwise embeds the path.
"""

from __future__ import annotations

import hashlib
import struct
import subprocess
import sys
from pathlib import Path

MH_MAGIC_64 = 0xFEEDFACF
LC_UUID = 0x1B


def uuid_offset(data: bytes) -> int:
    if len(data) < 32:
        raise SystemExit("file is too small to be a Mach-O")
    magic, _cputype, _cpusub, _filetype, ncmds, _sizeofcmds, _flags, _reserved = struct.unpack_from(
        "<8I", data, 0
    )
    if magic != MH_MAGIC_64:
        raise SystemExit(f"expected a thin arm64 Mach-O, magic was {magic:#x}")
    off = 32
    found = None
    for _ in range(ncmds):
        if off + 8 > len(data):
            raise SystemExit("load commands run past the end of the file")
        cmd, cmdsize = struct.unpack_from("<II", data, off)
        if cmdsize < 8 or off + cmdsize > len(data):
            raise SystemExit("bad load-command size")
        if cmd == LC_UUID:
            if found is not None:
                raise SystemExit("more than one LC_UUID")
            if cmdsize < 24:
                raise SystemExit("LC_UUID is shorter than 24 bytes")
            found = off + 8
        off += cmdsize
    if found is None:
        raise SystemExit("LC_UUID is missing")
    return found


def normalize(path: Path) -> None:
    # A missing signature is fine: strip -x may already have removed it.
    subprocess.run(["codesign", "--remove-signature", str(path)], check=False, capture_output=True)
    data = bytearray(path.read_bytes())
    start = uuid_offset(data)
    data[start : start + 16] = b"\0" * 16
    data[start : start + 16] = hashlib.sha256(data).digest()[:16]
    path.write_bytes(data)
    subprocess.check_call(
        ["codesign", "-s", "-", "-i", path.name, "-f", "--timestamp=none", str(path)],
        stdout=subprocess.DEVNULL,
    )


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(f"usage: {Path(sys.argv[0]).name} binary...")
    for arg in sys.argv[1:]:
        normalize(Path(arg))


if __name__ == "__main__":
    main()
