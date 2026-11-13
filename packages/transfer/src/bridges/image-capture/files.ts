// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Hash and place the file the helper wrote. Paths never leave this file in an error. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, realpath, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

/**
 * The folder one download goes into: beside its `.part`, inside the staging folder the helper may
 * write to, and the helper's only view of it. Whatever ImageCaptureCore writes there with the
 * original (an iPhone edit's `.AAE`) is deleted with the folder, so nothing else in the shared
 * staging folder can be mistaken for it. The library's sweep reads journals only and skips
 * folders, so a folder a crash leaves behind is never imported; the next pull of the item clears it.
 */
export function downloadFolder(dest: string): string {
  return `${dest}.icc`;
}

/** An empty folder at `path`, whatever was there before. */
export async function freshFolder(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

/** True when `file` exists and is inside `directory` once both are resolved (the helper returns real paths). */
export async function insideReal(directory: string, file: string): Promise<boolean> {
  const [root, target] = await Promise.all([realOrNull(directory), realOrNull(file)]);
  if (root === null || target === null) return false;
  const rel = relative(root, target);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

export async function placeAt(written: string, dest: string): Promise<void> {
  if (resolve(written) === resolve(dest)) return;
  await mkdir(dirname(dest), { recursive: true });
  try {
    await rename(written, dest);
  } catch (cause) {
    if (!isExdev(cause)) throw cause;
    await copyFile(written, dest);
    await rm(written, { force: true });
  }
}

export function hashFile(path: string): Promise<{ readonly sha256: string; readonly bytes: number }> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    let bytes = 0;
    const stream = createReadStream(path);
    stream.on('data', (chunk: Buffer | string) => {
      const block = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      bytes += block.length;
      hash.update(block);
    });
    stream.on('error', reject);
    stream.on('end', () => resolveHash({ sha256: hash.digest('hex'), bytes }));
  });
}

/** A missing path is null: the caller refuses it like any path outside the folder. */
async function realOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch (cause) {
    if (isMissing(cause)) return null;
    throw cause;
  }
}

function isMissing(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT';
}

function isExdev(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'EXDEV';
}
