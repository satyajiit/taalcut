// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Writing the Core ML weights for good (IX3-F5, H2): every byte of a buffer written (`FileHandle.write` may write
 * fewer than it was given and say so only in its count), and each written file read back from the disk and checked
 * against the recipe before the expansion is moved into place, so a full volume or a short write never becomes an
 * `expanded/` the helper loads.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type AsyncResult } from '@taalcut/core';

/** Writes all of `bytes` at the handle's position, however few each call takes. */
export async function writeAll(out: Pick<FileHandle, 'write'>, bytes: Uint8Array): Promise<void> {
  for (let at = 0; at < bytes.length;) {
    const { bytesWritten } = await out.write(bytes, at, bytes.length - at);
    if (bytesWritten <= 0) throw new Error(`wrote nothing at byte ${at} of ${bytes.length}`);
    at += bytesWritten;
  }
}

/** Every file read back from `dir`: its size and sha256 as the recipe says. */
export async function readBack(
  dir: string,
  files: readonly { readonly path: string; readonly bytes: number; readonly sha256: string }[],
): AsyncResult<void, string> {
  for (const file of files) {
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of createReadStream(join(dir, file.path))) {
      hash.update(chunk as Buffer);
      bytes += (chunk as Buffer).length;
    }
    const sha = hash.digest('hex');
    if (bytes !== file.bytes || sha !== file.sha256)
      return err(
        `${file.path} reads back as ${bytes} bytes, sha256 ${sha.slice(0, 12)}; the recipe says ${file.bytes}, ${file.sha256.slice(0, 12)}`,
      );
  }
  return ok(undefined);
}
