// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Whether an MP4 carries a C2PA manifest store, read from the bytes alone (no sidecar): BMFF keeps it in a
 * top-level `uuid` box whose extended type is D8FEC3D6-1B0E-483C-9297-5828877EC481 (C2PA 2.4, A.5.1). QA uses
 * it for "off adds nothing" and to confirm an "on" export really carries one.
 */
import { open } from 'node:fs/promises';

export const C2PA_UUID = Buffer.from('d8fec3d61b0e483c92975828877ec481', 'hex');

/** A file with more top-level boxes than this isn't an export (a progressive MP4 has a handful). */
const MAX_BOXES = 10_000;

/** The top-level boxes' types and offsets, stopping at the first malformed header. */
export async function topLevelBoxes(
  path: string,
): Promise<{ type: string; offset: number; size: number; uuid?: Buffer }[]> {
  const handle = await open(path, 'r');
  try {
    const { size: fileSize } = await handle.stat();
    const header = Buffer.alloc(32);
    const boxes: { type: string; offset: number; size: number; uuid?: Buffer }[] = [];
    let offset = 0;
    while (offset + 8 <= fileSize && boxes.length < MAX_BOXES) {
      const { bytesRead } = await handle.read(header, 0, 32, offset);
      if (bytesRead < 8) break;
      let size = header.readUInt32BE(0);
      const type = header.toString('latin1', 4, 8);
      let headerSize = 8;
      if (size === 1) {
        if (bytesRead < 16) break;
        const large = header.readBigUInt64BE(8);
        if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
        size = Number(large);
        headerSize = 16;
      } else if (size === 0) {
        size = fileSize - offset;
      }
      if (size < headerSize || offset + size > fileSize) break;
      const uuid =
        type === 'uuid' && bytesRead >= headerSize + 16
          ? Buffer.from(header.subarray(headerSize, headerSize + 16))
          : undefined;
      boxes.push({ type, offset, size, ...(uuid ? { uuid } : {}) });
      offset += size;
    }
    return boxes;
  } finally {
    await handle.close();
  }
}

export async function hasC2paManifestBox(path: string): Promise<boolean> {
  const boxes = await topLevelBoxes(path);
  return boxes.some((box) => box.uuid?.equals(C2PA_UUID) === true);
}
