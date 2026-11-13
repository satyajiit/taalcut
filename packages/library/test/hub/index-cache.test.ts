// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HubIndexCache (P3-B12): the index and the ratings as last fetched, one row each, replaced on write, kept
 * across a reopen, the body as fetched (not validated here).
 */
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createHubIndexCache } from '../../src/index';
import { openTestDb, tempDir } from '../helpers';

const index = { schema: 1, templates: [{ hubId: '01J0000000000000000000000A', name: 'Goa' }] };

describe('hub index cache', () => {
  it('starts empty, keeps the last write of each document and survives a reopen', async () => {
    const path = `${tempDir()}/library.db`;
    const first = openTestDb({ path });
    const cache = createHubIndexCache(first);
    expect(unwrap(await cache.readIndex())).toBeNull();
    expect(unwrap(await cache.readRatings())).toBeNull();

    unwrap(await cache.writeIndex({ etag: '"a1"', fetchedAt: 10, body: index }));
    unwrap(await cache.writeIndex({ etag: '"a2"', fetchedAt: 20, body: { ...index, schema: 2 } }));
    unwrap(await cache.writeRatings({ etag: null, fetchedAt: 30, body: { ratings: { x: 4.5 } } }));
    first.close();

    const again = createHubIndexCache(openTestDb({ path }));
    expect(unwrap(await again.readIndex())).toEqual({
      etag: '"a2"',
      fetchedAt: 20,
      body: { ...index, schema: 2 },
    });
    expect(unwrap(await again.readRatings())).toEqual({
      etag: null,
      fetchedAt: 30,
      body: { ratings: { x: 4.5 } },
    });
  });

  it('keeps any JSON body as fetched, and refuses a bad time or etag', async () => {
    const db = openTestDb({ file: false });
    const cache = createHubIndexCache(db);
    unwrap(await cache.writeIndex({ etag: null, fetchedAt: 1, body: 'not an index' }));
    expect(unwrap(await cache.readIndex())?.body).toBe('not an index');
    unwrap(await cache.writeIndex({ etag: null, fetchedAt: 2, body: undefined }));
    expect(unwrap(await cache.readIndex())?.body).toBeNull();

    const late = await cache.writeIndex({ etag: null, fetchedAt: -1, body: {} });
    expect(!late.ok && late.error.code).toBe('core.validation');
    const empty = await cache.writeRatings({ etag: '', fetchedAt: 1, body: {} });
    expect(!empty.ok && empty.error.code).toBe('core.validation');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const loop = await cache.writeRatings({ etag: null, fetchedAt: 1, body: cyclic });
    expect(!loop.ok && loop.error.code).toBe('core.validation');
    expect(unwrap(await cache.readRatings())).toBeNull();
  });

  it('answers an error, not a guess, for a row written around the store', async () => {
    const db = openTestDb({ file: false });
    db.driver
      .prepare(`INSERT INTO hub_index_cache (id, etag, fetched_at, body) VALUES (1, NULL, 1, '{}')`)
      .run();
    db.driver.exec('PRAGMA ignore_check_constraints = ON');
    db.driver.prepare(`UPDATE hub_index_cache SET body = 'nope'`).run();
    db.driver.exec('PRAGMA ignore_check_constraints = OFF');
    const read = await createHubIndexCache(db).readIndex();
    expect(!read.ok && read.error.code).toBe('core.validation');
  });
});
