// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { lstat, readFile, realpath, rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  err,
  ok,
  toTaalcutError,
  type AsyncResult,
  type ImportOutcome,
  type ImportSink,
} from '@taalcut/core';
import { photosOutcomeSchema } from './photos-state';

type PhotosRecovery =
  | { readonly kind: 'staged' | 'restart' }
  | {
      readonly kind: 'finished';
      readonly result: ImportOutcome;
    };

const missing = (cause: unknown): boolean =>
  typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT';

async function readMarker(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (cause) {
    if (missing(cause)) return null;
    throw cause;
  }
}

const inside = (root: string, candidate: string): boolean => {
  const child = relative(root, candidate);
  return child.length > 0 && !isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`);
};

async function savedOriginal(
  root: string,
  path: string,
  bytes: number,
): Promise<'missing' | 'valid' | 'invalid'> {
  if (!isAbsolute(path) || !inside(resolve(root), path)) return 'invalid';
  try {
    const file = await lstat(path);
    if (!file.isFile() || file.size !== bytes) return 'invalid';
    return inside(await realpath(root), await realpath(path)) ? 'valid' : 'invalid';
  } catch (cause) {
    if (missing(cause)) return 'missing';
    throw cause;
  }
}

/** A journal proves intent, not that the original or its library asset still exists. */
export async function recoverPhotosOriginal(options: {
  readonly root: string;
  readonly path: string;
  readonly bytesWritten: number;
  readonly sink: ImportSink;
}): AsyncResult<PhotosRecovery> {
  try {
    const { path, sink, bytesWritten } = options;
    const done = await readMarker(`${path}.done.json`);
    if (done !== null) {
      let value: unknown;
      try {
        value = JSON.parse(done);
      } catch {
        return ok({ kind: 'restart' });
      }
      const outcome = photosOutcomeSchema.safeParse(value);
      if (!outcome.success || !sink.knownAssets) return ok({ kind: 'restart' });
      const known = await sink.knownAssets([outcome.data.assetId]);
      if (!known.ok) return known;
      return ok(
        known.value.has(outcome.data.assetId)
          ? { kind: 'finished', result: outcome.data }
          : { kind: 'restart' },
      );
    }
    const staged = await savedOriginal(options.root, path, bytesWritten);
    if (staged === 'valid') return ok({ kind: 'staged' });
    if (staged === 'invalid') return ok({ kind: 'restart' });
    const destination = await readMarker(`${path}.dest`);
    return ok(
      destination !== null && (await savedOriginal(options.root, destination, bytesWritten)) === 'valid'
        ? { kind: 'staged' }
        : { kind: 'restart' },
    );
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
}

/** Remove only this upload's private staging files; a destination in a stale journal is never deleted. */
export async function discardPhotosStaging(path: string): Promise<void> {
  for (const suffix of ['', '.dest', '.done.json', '.import.json'])
    await rm(`${path}${suffix}`, { force: true });
}
