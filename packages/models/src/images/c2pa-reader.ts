// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * core's ContentCredentials as the images' C2PA presence reader (P3-B7, round P3-3): its read over bytes in
 * memory (render's `c2pa-sidecar`), for a still before the library stores it. A reader that can't read bytes, or
 * a read that fails (the component not installed, a malformed manifest), says 'unknown', never a guess.
 */
import type { ContentCredentials } from '@taalcut/core';
import type { ImageC2paReader } from './image-route-spec';

export function imageC2paReader(credentials: Pick<ContentCredentials, 'readBytes'>): ImageC2paReader {
  return async (bytes, mediaType, signal) => {
    if (!credentials.readBytes) return 'unknown';
    const read = await credentials.readBytes(bytes, mediaType, signal);
    return read.ok ? read.value.presence : 'unknown';
  };
}
