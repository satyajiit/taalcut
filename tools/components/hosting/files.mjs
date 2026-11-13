// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** File helpers the release scripts share: hashing, walking a folder in archive order, sizes. Node built-ins only. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

export async function sha256File(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Byte order, as `LC_ALL=C sort` orders the names the archives were made with. */
export function byteOrder(left, right) {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

/**
 * Every regular file and symlink under `root`, as paths relative to it, sorted in byte order. Folders are not
 * listed: the archives hold files only and the installer makes the folders.
 */
export async function listEntries(root, prefix = '') {
  const entries = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) entries.push(...(await listEntries(root, path)));
    else if (entry.isFile() || entry.isSymbolicLink()) entries.push(path);
    else throw new Error(`${path}: not a file, folder or symlink`);
  }
  return entries.sort(byteOrder);
}

/** The manifest's extractedSize: the sum of the regular files' sizes (symlinks count nothing). */
export async function regularBytes(root, entries) {
  let total = 0;
  for (const path of entries) {
    const info = await lstat(join(root, path));
    if (info.isFile()) total += info.size;
  }
  return total;
}
