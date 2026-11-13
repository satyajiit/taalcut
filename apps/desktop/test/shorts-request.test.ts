// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createContainer, newId, ok, unwrap, type ShortsRequest } from '@taalcut/core';
import type { LibraryDatabase } from '@taalcut/library';
import { expect, it, vi } from 'vitest';
import { LibraryDatabaseToken } from '../src/shared/tokens';
import { resolveShortRequest } from '../src/utility/roots/shorts-request';

const metadata = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@taalcut/library', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createShortsCache: () => ({ get: async () => ok(metadata.value) }),
}));

it('restores only a validated canonical YouTube backlink and preserves an explicit source URL', async () => {
  const container = createContainer().value(LibraryDatabaseToken, {} as LibraryDatabase);
  const request: ShortsRequest = {
    projectId: newId<'Project'>(),
    assetId: newId<'Asset'>(),
    duration: { value: 60, rate: { num: 1, den: 1 } },
    platforms: ['shorts'],
  };
  metadata.value = { sourceUrl: 'https://youtu.be/abcDEF12345?si=private-token' };
  expect(unwrap(await resolveShortRequest(container, request)).sourceUrl).toBe(
    'https://www.youtube.com/watch?v=abcDEF12345',
  );
  metadata.value = { sourceUrl: 'https://untrusted.example/watch?v=abcDEF12345' };
  expect(unwrap(await resolveShortRequest(container, request))).toEqual(request);
  const explicit = { ...request, sourceUrl: 'https://www.youtube.com/watch?v=ZyxWVUt9876' };
  expect(unwrap(await resolveShortRequest(container, explicit))).toEqual(explicit);
});
