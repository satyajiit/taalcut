// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A private copy of a downloaded update, so the bytes that are verified are
 * the bytes Squirrel.Mac gets. The update library's cache file stays writable
 * by any process of the user, during verification and until Squirrel reads
 * it; the snapshot is written once into a fresh 0700 folder (0600, fsynced),
 * hashed as it is written, hashed again after verification, and served
 * (squirrel-feed.ts) only while its bytes still have that hash.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';

export interface Snapshot {
  /** The copy; nothing else is in its folder. */
  readonly path: string;
  readonly size: number;
  /** sha512 (hex) of the bytes as they were copied. */
  readonly sha512: string;
  /** Removes the copy and its folder. */
  dispose(): Promise<void>;
}

/** Copies `source` into a new private folder under `root`, hashing what it writes. */
export async function snapshotOf(source: string, root: string = tmpdir()): Promise<Snapshot> {
  const folder = await mkdtemp(join(root, 'taalcut-update-'));
  const dispose = () => rm(folder, { recursive: true, force: true });
  try {
    const path = join(folder, 'update.zip');
    const hash = createHash('sha512');
    let size = 0;
    const file = await open(path, 'wx', 0o600);
    try {
      for await (const chunk of createReadStream(source)) {
        const bytes = chunk as Buffer;
        hash.update(bytes);
        size += bytes.length;
        await file.write(bytes);
      }
      await file.sync();
    } finally {
      await file.close();
    }
    return { path, size, sha512: hash.digest('hex'), dispose };
  } catch (cause) {
    await dispose();
    throw cause;
  }
}

/** sha512 (hex) of a file as it is now. */
export async function sha512Of(path: string): Promise<string> {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * Passes bytes through one chunk behind, and lets the last one out only if
 * everything matched `expected`; otherwise it fails, so the reader gets a
 * short body (less than Content-Length) instead of other bytes.
 */
export function releaseIfUnchanged(expected: Pick<Snapshot, 'size' | 'sha512'>): Transform {
  const hash = createHash('sha512');
  let size = 0;
  let held: Buffer | undefined;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      size += chunk.length;
      const previous = held;
      held = chunk;
      done(null, previous);
    },
    flush(done) {
      if (size !== expected.size || hash.digest('hex') !== expected.sha512) {
        done(new Error('the update changed after it was verified'));
        return;
      }
      done(null, held);
    },
  });
}
