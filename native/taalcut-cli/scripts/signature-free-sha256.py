# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Taalcut contributors
"""sha256 of a thin 64-bit Mach-O with its code signature left out, so a re-signed copy hashes the same.

Same rule as native/mac-helper/build.sh and packages/media's signatureFreeSha256: zero __LINKEDIT's
vmsize and filesize, zero LC_CODE_SIGNATURE's datasize, and hash up to the signature's offset.
"""
import hashlib
import pathlib
import struct
import sys

MH_MAGIC_64 = 0xFEEDFACF
HEADER_SIZE = 32
LC_SEGMENT_64 = 0x19
LC_CODE_SIGNATURE = 0x1D


def signature_free_sha256(path):
    data = bytearray(pathlib.Path(path).read_bytes())
    if len(data) < HEADER_SIZE or struct.unpack_from("<I", data, 0)[0] != MH_MAGIC_64:
        raise SystemExit("error: not a thin 64-bit Mach-O: " + path)
    commands = struct.unpack_from("<I", data, 16)[0]
    end = len(data)
    offset = HEADER_SIZE
    for _ in range(commands):
        if offset + 8 > len(data):
            raise SystemExit("error: Mach-O load commands run past the end of the file")
        command, size = struct.unpack_from("<II", data, offset)
        if size < 8 or offset + size > len(data):
            raise SystemExit("error: bad Mach-O load command size")
        if command == LC_SEGMENT_64 and size >= 72:
            raw = bytes(data[offset + 8:offset + 24])
            nul = raw.find(0)
            name = raw[: len(raw) if nul < 0 else nul].decode("latin1")
            if name == "__LINKEDIT":
                data[offset + 32:offset + 40] = b"\0" * 8
                data[offset + 48:offset + 56] = b"\0" * 8
        if command == LC_CODE_SIGNATURE and size >= 16:
            end = struct.unpack_from("<I", data, offset + 8)[0]
            data[offset + 12:offset + 16] = b"\0" * 4
        offset += size
    if end > len(data):
        raise SystemExit("error: Mach-O code signature starts past the end of the file")
    return hashlib.sha256(data[:end]).hexdigest()


if __name__ == "__main__":
    print(signature_free_sha256(sys.argv[1]))
