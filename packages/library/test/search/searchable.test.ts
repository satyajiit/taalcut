// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-R4: search during deep analysis. An asset that is searchable while its descriptions or proxy are still to
 * come shows in results like any other, and its summary says when it became searchable (the hint the UI reads);
 * search never waits for "complete".
 */
import { unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import type { LibraryDatabase } from '../../src/index';
import { searchFixture } from './search-helpers';

function analysing(db: LibraryDatabase, assetId: AssetId, searchableAt: number) {
  const row = db.driver.prepare(
    `INSERT OR REPLACE INTO asset_index_stages (asset_id, stage, state, finished_at, updated_at) VALUES (?, ?, ?, ?, 0)`,
  );
  row.run(assetId, 'vision.embed', 'done', searchableAt);
  row.run(assetId, 'vision.describe', 'running', null);
  db.driver
    .prepare(
      'INSERT OR REPLACE INTO asset_index_state (asset_id, searchable_at, complete_at) VALUES (?, ?, NULL)',
    )
    .run(assetId, searchableAt);
}

describe('search while deeper analysis carries on', () => {
  it('finds a searchable asset that is not complete, and says when it became searchable', async () => {
    const s = searchFixture();
    const before = unwrap(await s.search.search('sunset shots on the beach', undefined, 30)).hits;
    const target = before[0]?.asset.id;
    expect(target).toBeDefined();
    analysing(s.db, target as AssetId, 1_000);

    const after = unwrap(await s.search.search('sunset shots on the beach', undefined, 30)).hits;
    expect(after.map((hit) => hit.shot.id)).toEqual(before.map((hit) => hit.shot.id));
    const hit = after.find((h) => h.asset.id === target);
    expect(hit?.asset.index).toMatchObject({ state: 'indexing', searchableAt: 1_000 });
    // Assets the pipeline hasn't swept say so with null, never by leaving the field out.
    expect(after.filter((h) => h.asset.id !== target).every((h) => h.asset.index.searchableAt === null)).toBe(
      true,
    );
  });
});
