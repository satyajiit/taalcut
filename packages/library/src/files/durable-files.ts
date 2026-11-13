// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * File writes and moves a crash can't leave half done: bytes go to a temp name beside the target, are fsynced
 * and renamed into place; a move is a rename, or across volumes a copy that is fsynced before its source goes.
 * The library's managed files (originals, generated files, template and Style assets, voice recordings, import
 * journals) all land this way. Throws Node's errors; callers turn them into error values.
 */
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, open, rename, rm, unlink } from 'node:fs/promises';

/** Flushes a file, or a folder after a rename into it, to the disk. */
export async function fsyncPath(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** A temp name beside `path` no other write uses. */
export function uniqueTemp(path: string): string {
  return `${path}.${randomBytes(6).toString('hex')}.tmp`;
}

/**
 * Writes `data` to `temp`, fsyncs it and renames it to `path`, so a crash never leaves a half file under the
 * real name. `temp` is a fresh name unless the caller keeps a fixed one (a journal rewritten in place). A failed
 * rename takes the temp file with it.
 */
export async function writeDurably(
  path: string,
  data: string | Uint8Array,
  temp: string = uniqueTemp(path),
): Promise<void> {
  const handle = await open(temp, 'w', 0o644);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, path);
  } catch (cause) {
    await rm(temp, { force: true });
    throw cause;
  }
}

/** Same volume: a rename. Across volumes: a copy (never over an existing file), fsynced, then the source goes. */
export async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (cause) {
    if (!(cause instanceof Error && 'code' in cause && cause.code === 'EXDEV')) throw cause;
    await copyFile(from, to, constants.COPYFILE_EXCL);
    await fsyncPath(to);
    await unlink(from);
  }
}
