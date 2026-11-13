// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * sha256 of the analysed file: finds a repeat paste of the same reel
 * (`origin.fingerprint`, TemplateListQuery.fingerprint) and keys the
 * breakdown job. Read in place; the user's file is never moved or changed.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { CancelledError, err, ok, toTaalcutError, type AsyncResult } from '@taalcut/core';

export async function fileSha256(path: string, signal?: AbortSignal): AsyncResult<string> {
  const hash = createHash('sha256');
  try {
    for await (const chunk of createReadStream(path, signal ? { signal } : {})) hash.update(chunk as Buffer);
    return ok(hash.digest('hex'));
  } catch (cause) {
    if (signal?.aborted) return err(CancelledError());
    return err(toTaalcutError(cause));
  }
}
