// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The images' C2PA presence over core's ContentCredentials.readBytes (round P3-3): what the read finds, and
 * 'unknown' when it can't read bytes or the read fails.
 */
import { describe, expect, it } from 'vitest';
import { err, ok, type ContentCredentials, type GeneratedMediaType } from '@taalcut/core';
import { imageC2paReader } from '@taalcut/models';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe('imageC2paReader', () => {
  it("passes the bytes, their type and the call's signal, and says what the read found", async () => {
    const seen: { bytes: Uint8Array; mediaType: GeneratedMediaType; signal: AbortSignal | undefined }[] = [];
    const credentials: Pick<ContentCredentials, 'readBytes'> = {
      readBytes: async (bytes, mediaType, signal) => {
        seen.push({ bytes, mediaType, signal });
        return ok({ presence: 'present', summary: null });
      },
    };
    const signal = new AbortController().signal;
    expect(await imageC2paReader(credentials)(PNG, 'image/png', signal)).toBe('present');
    expect(seen).toEqual([{ bytes: PNG, mediaType: 'image/png', signal }]);
  });

  it("says 'unknown' without a bytes read, or when the read fails", async () => {
    expect(await imageC2paReader({})(PNG, 'image/png')).toBe('unknown');
    const failing: Pick<ContentCredentials, 'readBytes'> = {
      readBytes: async () =>
        err({ code: 'render.credentials_unreadable', messageKey: 'x', retryable: false }),
    };
    expect(await imageC2paReader(failing)(PNG, 'image/jpeg')).toBe('unknown');
  });
});
