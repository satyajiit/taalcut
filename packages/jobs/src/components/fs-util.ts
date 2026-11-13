// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Small filesystem helpers: atomic JSON writes, streaming hashes, quiet removal. */
import { createHash, randomBytes, type Hash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat, type FileHandle } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export function isErrnoException(cause: unknown, code?: string): cause is NodeJS.ErrnoException {
  return cause instanceof Error && 'code' in cause && (code === undefined || cause.code === code);
}

/**
 * Writes `text` so readers see either the old file or the new one, never a
 * torn one: temp file in the same folder, fsync, rename, then fsync the folder.
 * The folder is created first when it doesn't exist yet (a fresh userData),
 * and each new folder's parent is synced so the new entries survive a crash.
 */
export async function writeFileAtomic(path: string, text: string): Promise<void> {
  await ensureDirectory(dirname(path));
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  const handle = await open(temp, 'w', 0o644);
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, path);
  } catch (cause) {
    await removeQuietly(temp);
    throw cause;
  }
  await syncDirectory(dirname(path));
}

/** mkdir -p, then fsync the parent of every folder it created, innermost first. */
async function ensureDirectory(dir: string): Promise<void> {
  const target = resolve(dir);
  const created = await mkdir(target, { recursive: true });
  if (created === undefined) return;
  const top = resolve(created);
  for (let folder = target; folder !== dirname(folder); folder = dirname(folder)) {
    await syncDirectory(dirname(folder));
    if (folder === top) break;
  }
}

/** Best effort: makes a rename durable on filesystems that allow fsync on a directory. */
async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Not supported everywhere; the rename itself is still atomic.
  }
}

/** FileHandle.write may write less than asked; this loops until the whole chunk is on disk. */
export async function writeAll(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let written = 0;
  while (written < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, written, chunk.length - written);
    written += bytesWritten;
  }
}

/** Size of a regular file, or undefined if there is none. */
export async function fileSize(path: string): Promise<number | undefined> {
  try {
    const stats = await stat(path);
    return stats.isFile() ? stats.size : undefined;
  } catch (cause) {
    if (isErrnoException(cause, 'ENOENT') || isErrnoException(cause, 'ENOTDIR')) return undefined;
    throw cause;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (cause) {
    if (isErrnoException(cause, 'ENOENT') || isErrnoException(cause, 'ENOTDIR')) return false;
    throw cause;
  }
}

/** rm -rf that never throws for a missing path. */
export async function removeQuietly(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true, maxRetries: 2 });
}

/**
 * Streams a file into `hash` (which may already hold earlier bytes) and
 * returns the number of bytes read. `onBytes` gets the running total.
 */
export async function hashFileInto(
  hash: Hash,
  path: string,
  options: { signal?: AbortSignal; onBytes?: (bytesRead: number) => void } = {},
): Promise<number> {
  let bytes = 0;
  const stream = createReadStream(path, { highWaterMark: 1024 * 1024, signal: options.signal });
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    hash.update(chunk);
    bytes += chunk.length;
    options.onBytes?.(bytes);
  }
  return bytes;
}

/** Lowercase hex sha256 of a file, streamed. */
export async function sha256File(
  path: string,
  options: { signal?: AbortSignal; onBytes?: (bytesRead: number) => void } = {},
): Promise<string> {
  const hash = createHash('sha256');
  await hashFileInto(hash, path, options);
  return hash.digest('hex');
}
