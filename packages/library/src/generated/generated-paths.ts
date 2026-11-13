// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where kept files live: `<originals root>/Generated/<first two hex>/<blake3>.<ext>`, content-addressed, beside
 * the root's `Stock/` and the phone imports (ADR 0001: the managed originals root is the one place the
 * library keeps media it owns, on the disk the person chose and backs up; render reads them like any original).
 * A root on a drive that isn't plugged in is refused rather than recreated under /Volumes.
 */
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { writeDurably } from '../files/durable-files';
import { exists } from '../files/file-presence';
import { OriginalsOffline } from '../import/errors';

export const GENERATED_FOLDER = 'Generated';

export function generatedPath(root: string, contentHash: string, extension: string): string {
  return join(root, GENERATED_FOLDER, contentHash.slice(0, 2), `${contentHash}.${extension}`);
}

/** The root's drive, when it is on one under /Volumes. */
export function driveOf(path: string): string | null {
  return /^\/Volumes\/[^/]+/.exec(path)?.[0] ?? null;
}

/** `library.originals_offline` when the root's drive is gone. */
export async function rootOnline(root: string): AsyncResult<void> {
  const drive = driveOf(root);
  if (drive && !(await exists(drive))) return err(OriginalsOffline({ name: basename(drive) }));
  return ok(undefined);
}

/**
 * Writes the bytes durably beside `target` and renames them into place. A file already there has these bytes
 * (its name is their hash), so it is replaced by the same content.
 */
export async function writeInPlace(target: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await writeDurably(target, bytes);
}
