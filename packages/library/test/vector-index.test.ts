// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-L1: deleting an asset removes its vectors in the same transaction. */
import { unwrap, type VectorIndex } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { openVectorIndex, removeAssets, sqliteVecPath } from '../src/index';
import { embedText, FAKE_DIMENSIONS, FAKE_SPACE } from './fixtures/fake-embedder';
import { buildFixtureLibrary } from './fixtures/library-200';
import { openTestDb } from './helpers';

describe('removeAssets', () => {
  it('deletes the assets, what cascades from them and their vectors, together', () => {
    const db = openTestDb({ extensions: [sqliteVecPath()] });
    const vectors = unwrap(openVectorIndex(db, { name: FAKE_SPACE.indexName, dimensions: FAKE_DIMENSIONS }));
    const fixture = buildFixtureLibrary(db, { vectors });
    const [a, b] = fixture.assets;
    const query = embedText('Golden sunset over the beach');
    const owners = () => new Set(unwrap(vectors.search(query, { k: 4096 })).map((m) => m.metadata.assetId));
    expect(owners().has(a!)).toBe(true);
    const before = vectors.count();

    expect(unwrap(removeAssets(db, [a!, b!], vectors))).toBe(2);
    expect(owners().has(a!)).toBe(false);
    expect(owners().has(b!)).toBe(false);
    expect(vectors.count()).toBeLessThan(before);
    const left = (table: string) =>
      db.driver.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE asset_id IN (?, ?)`).get(a!, b!)?.n;
    for (const table of ['shots', 'asset_locations', 'transcripts', 'derived_files', 'asset_index_stages'])
      expect(left(table)).toBe(0);

    // A failure in the vector index rolls the asset delete back.
    const failing: Pick<VectorIndex, 'removeWhere'> = {
      removeWhere: () => ({
        ok: false,
        error: { code: 'library.query_failed', messageKey: 'x', retryable: false },
      }),
    };
    const c = fixture.assets[2]!;
    expect(removeAssets(db, [c], failing).ok).toBe(false);
    expect(db.driver.prepare('SELECT id FROM assets WHERE id = ?').get(c)).toBeDefined();
    expect(unwrap(removeAssets(db, []))).toBe(0);
  });
});
