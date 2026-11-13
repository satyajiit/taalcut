// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Pro export's originals in the agent process: the library's source on core's token, kept when one is there. */
import { createContainer, InterchangeMediaSourceToken, ok, unwrap } from '@taalcut/core';
import { openDatabase } from '@taalcut/library';
import { describe, expect, it } from 'vitest';
import { LibraryDatabaseToken } from '../src/shared/tokens';
import { registerInterchangeMediaSource } from '../src/utility/roots/library-interchange';

describe('the agent’s interchange media source', () => {
  it('registers the library’s source on core’s token', async () => {
    const db = unwrap(openDatabase({ path: ':memory:' }));
    const container = createContainer().value(LibraryDatabaseToken, db);
    registerInterchangeMediaSource(container);
    const media = unwrap(await container.resolve(InterchangeMediaSourceToken).resolve([]));
    expect(media.size).toBe(0);
    db.close();
  });

  it('keeps a source another root registered first', () => {
    const own = { resolve: async () => ok(new Map()) };
    const container = createContainer().value(InterchangeMediaSourceToken, own);
    registerInterchangeMediaSource(container);
    expect(container.resolve(InterchangeMediaSourceToken)).toBe(own);
  });
});
