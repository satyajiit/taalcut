// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { open, rm, utimes } from 'node:fs/promises';
import { CancelledError, err, ok, toTaalcutError, type AsyncResult, type Result } from '@taalcut/core';
import type { CaptureFile } from './camera-profiles';
import { ImportSourceChanged, ImportVerificationFailed } from './errors';
import { openSelectedOriginal, sameLocalFile } from './inventory';

export interface CopyProgress {
  readonly bytes: number;
  readonly stage: 'copying' | 'verifying';
}

export async function hashCopiedFile(path: string, signal?: AbortSignal): AsyncResult<string> {
  const handle = await open(path, 'r');
  try {
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      if (signal?.aborted) return err(CancelledError());
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) return ok(hash.digest('hex'));
      hash.update(buffer.subarray(0, bytesRead));
    }
  } catch (cause) {
    return err(toTaalcutError(cause));
  } finally {
    await handle.close();
  }
}

/** The target must be a fresh staging path. Never moves or modifies the source. */
export async function copySelectedOriginal(
  file: CaptureFile,
  destination: string,
  options: {
    readonly signal?: AbortSignal;
    readonly progress?: (progress: CopyProgress) => void;
    readonly beforeChunk?: (bytes: number) => Promise<Result<void>>;
    readonly afterChunk?: (bytes: number) => void;
  } = {},
): AsyncResult<{ readonly sha256: string; readonly bytes: number }> {
  const source = await openSelectedOriginal(file);
  if (!source.ok) return source;
  let target;
  let created = false;
  let complete = false;
  try {
    target = await open(destination, 'wx');
    created = true;
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes = 0;
    for (;;) {
      if (options.signal?.aborted) return err(CancelledError());
      const { bytesRead } = await source.value.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      const allowed = await options.beforeChunk?.(bytesRead);
      if (allowed && !allowed.ok) return allowed;
      let written = 0;
      while (written < bytesRead) {
        const result = await target.write(buffer, written, bytesRead - written, null);
        if (!result.bytesWritten) return err(ImportVerificationFailed());
        written += result.bytesWritten;
      }
      hash.update(buffer.subarray(0, bytesRead));
      bytes += bytesRead;
      options.afterChunk?.(bytesRead);
      options.progress?.({ bytes, stage: 'copying' });
    }
    if (!sameLocalFile(file, await source.value.stat()) || bytes !== file.sizeBytes)
      return err(ImportSourceChanged());
    await target.sync();
    await target.close();
    target = undefined;
    options.progress?.({ bytes, stage: 'verifying' });
    const copied = await hashCopiedFile(destination, options.signal);
    if (!copied.ok) return copied;
    if (copied.value !== hash.digest('hex')) return err(ImportVerificationFailed());
    await utimes(destination, new Date(file.modifiedAt), new Date(file.modifiedAt));
    complete = true;
    return ok({ sha256: copied.value, bytes });
  } catch (cause) {
    return err(toTaalcutError(cause));
  } finally {
    await target?.close();
    await source.value.close();
    if (created && !complete) await rm(destination, { force: true });
  }
}
