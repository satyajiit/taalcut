// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Desktop's file read for `styles.importImage`. The service itself stays free of node:fs. The size is checked
 * before the read, so picking a film by mistake reads nothing; the bytes are still sniffed afterwards.
 */
import { readFile, stat } from 'node:fs/promises';
import { err, LOGO_LIMITS, NotFoundError, ok, type AsyncResult } from '@taalcut/core';
import { StyleImageInvalid } from '../errors';

export function nodeImageReader(
  limitBytes: number = LOGO_LIMITS.bytes,
): (file: string) => AsyncResult<Uint8Array> {
  return async (file) => {
    try {
      const { size } = await stat(file);
      if (size > limitBytes) return err(StyleImageInvalid({ reason: 'size' }));
      return ok(new Uint8Array(await readFile(file)));
    } catch {
      // Gone, a folder or unreadable: there is no image at that path to import.
      return err(NotFoundError({ entity: 'file' }));
    }
  };
}
