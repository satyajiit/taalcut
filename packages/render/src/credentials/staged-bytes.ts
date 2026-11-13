// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Bytes in memory as a file the c2pa sidecar can read (contract round P3-3, `ContentCredentials.readBytes`): a
 * generated still or clip of sound is read before the library stores it. The sidecar reads paths only, inside
 * the folders it was started with, and the c2pa crate tells formats by extension, so the bytes go to a private
 * file with the media type's extension in a folder the sidecar may read, for one read, and are removed after.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GeneratedMediaType } from '@taalcut/core';

/** The extension the c2pa crate reads each generated media type by. */
export const STAGED_EXTENSION: Readonly<Record<GeneratedMediaType, string>> = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

/**
 * Runs `use` over the bytes staged as a new private file in `dir`; null when they can't be staged (the folder
 * can't be made, the disk is full). The file is removed whatever `use` answers.
 */
export async function withStagedBytes<T>(
  dir: string,
  bytes: Uint8Array,
  mediaType: GeneratedMediaType,
  use: (path: string) => Promise<T>,
): Promise<T | null> {
  const path = join(dir, `${randomUUID()}.${STAGED_EXTENSION[mediaType]}`);
  // Nothing staged is nothing to read: the caller answers presence 'unknown', as for a file the sidecar can't read.
  const made = await mkdir(dir, { recursive: true, mode: 0o700 }).then(
    () => true,
    () => false,
  );
  if (!made) return null;
  const written = await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }).then(
    () => true,
    () => false,
  );
  if (!written) {
    // A part written before the disk filled.
    await rm(path, { force: true });
    return null;
  }
  try {
    return await use(path);
  } finally {
    await rm(path, { force: true });
  }
}
