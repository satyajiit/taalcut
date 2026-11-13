// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap, ValidationError } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  asarUnpackedPath,
  betterSqlite3DriverFactory,
  loadSqliteVec,
  nodeSqliteDriver,
  openDatabase,
  openVectorIndex,
  sqliteVecPath,
  VectorExtensionUnavailable,
  VectorIndexMismatch,
  type VectorItem,
} from '../src/index';
import { FakeBetterSqlite3 } from './fake-better-sqlite3';
import { openTestDb, tempDir } from './helpers';
import { cosineDistance, seededRandom } from './vector-helpers';

const withVec = { extensions: [sqliteVecPath()] };

function items(count: number, dims: number, seed = 1): VectorItem[] {
  const random = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    vector: Float32Array.from({ length: dims }, random),
    metadata: {
      assetId: `asset-${i % 5}`,
      sourceId: `source-${i % 2}`,
      kind: i % 3 === 0 ? 'frame' : 'transcript',
    },
  }));
}

describe('sqlite-vec extension', () => {
  it('ships a loadable file for this platform and loads through node:sqlite', () => {
    expect(existsSync(sqliteVecPath())).toBe(true);
    const driver = nodeSqliteDriver.open(':memory:', { allowExtensions: true });
    expect(unwrap(loadSqliteVec(driver))).toBe('v0.1.9');
    driver.close();
  });

  it('points at the unpacked copy inside an Electron ASAR', () => {
    expect(asarUnpackedPath('/A.app/Contents/Resources/app.asar/node_modules/x/vec0.dylib', '/')).toBe(
      '/A.app/Contents/Resources/app.asar.unpacked/node_modules/x/vec0.dylib',
    );
    expect(asarUnpackedPath('/dev/node_modules/x/vec0.dylib', '/')).toBe('/dev/node_modules/x/vec0.dylib');
  });

  it('reports unavailable when the connection does not allow extensions', () => {
    const driver = nodeSqliteDriver.open(':memory:');
    const result = loadSqliteVec(driver);
    expect(!result.ok && VectorExtensionUnavailable.is(result.error)).toBe(true);
    driver.close();
    const db = openTestDb({ file: false });
    const index = openVectorIndex(db);
    expect(!index.ok && VectorExtensionUnavailable.is(index.error)).toBe(true);
  });

  it('also loads through the better-sqlite3 fallback driver', () => {
    const db = unwrap(
      openDatabase({ path: ':memory:', driver: betterSqlite3DriverFactory(FakeBetterSqlite3), ...withVec }),
    );
    const index = unwrap(openVectorIndex(db, { dimensions: 4 }));
    unwrap(index.upsert([{ id: 'a', vector: [1, 0, 0, 0] }]));
    expect(unwrap(index.search([1, 0, 0, 0], { k: 1 }))[0]?.id).toBe('a');
    db.close();
  });
});

describe('VectorIndex (sqlite-vec)', () => {
  it('reads stored vectors back by id, unit length in a cosine index (find similar)', () => {
    const db = openTestDb(withVec);
    const index = unwrap(openVectorIndex(db, { dimensions: 4 }));
    const l2 = unwrap(openVectorIndex(db, { name: 'plain', dimensions: 2, metric: 'l2' }));
    unwrap(
      index.upsert([
        { id: 'a', vector: [3, 0, 4, 0] },
        { id: 'b', vector: [0, 2, 0, 0] },
      ]),
    );
    unwrap(l2.upsert([{ id: 'p', vector: [3, 4] }]));
    const got = unwrap(index.get(['a', 'missing', 'a']));
    expect([...got.keys()]).toEqual(['a']);
    expect(Array.from(got.get('a')!).map((v) => v.toFixed(2))).toEqual(['0.60', '0.00', '0.80', '0.00']);
    expect(Array.from(unwrap(l2.get(['p'])).get('p')!)).toEqual([3, 4]);
    expect(unwrap(index.get([])).size).toBe(0);
  });

  it('returns the exact nearest neighbours by cosine distance', () => {
    const db = openTestDb(withVec);
    const index = unwrap(openVectorIndex(db, { dimensions: 32 }));
    const data = items(300, 32);
    expect(unwrap(index.upsert(data))).toBe(300);
    expect(index.count()).toBe(300);
    const query = Float32Array.from({ length: 32 }, seededRandom(99));
    const expected = data
      .map((item) => ({ id: item.id, distance: cosineDistance(query, item.vector) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 10);
    const found = unwrap(index.search(query, { k: 10 }));
    expect(found.map((m) => m.id)).toEqual(expected.map((e) => e.id));
    found.forEach((m, i) => expect(m.distance).toBeCloseTo(expected[i]!.distance, 5));
  });

  it('filters by asset, source and kind before taking the top k', () => {
    const db = openTestDb(withVec);
    const index = unwrap(openVectorIndex(db, { dimensions: 16 }));
    unwrap(index.upsert(items(200, 16)));
    const query = Float32Array.from({ length: 16 }, seededRandom(7));
    const frames = unwrap(index.search(query, { k: 10, filter: { kind: 'frame', sourceId: 'source-0' } }));
    expect(frames).toHaveLength(10);
    for (const m of frames) expect(m.metadata).toMatchObject({ kind: 'frame', sourceId: 'source-0' });
    const twoAssets = unwrap(index.search(query, { k: 50, filter: { assetId: ['asset-1', 'asset-2'] } }));
    expect(new Set(twoAssets.map((m) => m.metadata.assetId))).toEqual(new Set(['asset-1', 'asset-2']));
    expect(unwrap(index.search(query, { k: 5, filter: { assetId: [] } }))).toEqual([]);
  });

  it('replaces on upsert and removes by id or filter', () => {
    const db = openTestDb(withVec);
    const index = unwrap(openVectorIndex(db, { dimensions: 3 }));
    unwrap(index.upsert([{ id: 'a', vector: [1, 0, 0], metadata: { assetId: 'x' } }]));
    unwrap(index.upsert([{ id: 'a', vector: [0, 1, 0], metadata: { assetId: 'y', kind: 'ocr' } }]));
    expect(index.count()).toBe(1);
    const [hit] = unwrap(index.search([0, 1, 0], { k: 1 }));
    expect(hit).toEqual({ id: 'a', distance: 0, metadata: { assetId: 'y', sourceId: null, kind: 'ocr' } });
    unwrap(
      index.upsert([
        { id: 'b', vector: [0, 0, 1], metadata: { assetId: 'y' } },
        { id: 'c', vector: [1, 1, 0] },
      ]),
    );
    expect(unwrap(index.removeWhere({ assetId: 'y' }))).toBe(2);
    expect(unwrap(index.remove(['c', 'missing']))).toBe(1);
    expect(index.count()).toBe(0);
  });

  it('lists the ids a filter matches, every id without one (LRN1-TPL)', () => {
    const db = openTestDb(withVec);
    const index = unwrap(openVectorIndex(db, { dimensions: 3 }));
    unwrap(
      index.upsert([
        { id: 'a', vector: [1, 0, 0], metadata: { sourceId: 's1', kind: 'template' } },
        { id: 'b', vector: [0, 1, 0], metadata: { sourceId: 's1', kind: 'intent' } },
        { id: 'c', vector: [0, 0, 1], metadata: { sourceId: 's2', kind: 'intent' } },
      ]),
    );
    expect(unwrap(index.ids()).sort()).toEqual(['a', 'b', 'c']);
    expect(unwrap(index.ids({ kind: 'intent' })).sort()).toEqual(['b', 'c']);
    expect(unwrap(index.ids({ sourceId: ['s1'], kind: 'intent' }))).toEqual(['b']);
    expect(unwrap(index.ids({ sourceId: [] }))).toEqual([]);
  });

  it('replaces one owner’s set in one transaction, with no neighbour limit (IX-F3)', () => {
    const db = openTestDb(withVec);
    const index = unwrap(openVectorIndex(db, { dimensions: 4 }));
    // More of one asset's frames than one search may list (k ≤ 4096), and other kinds and assets beside them.
    const random = seededRandom(5);
    const frame = (i: number) => ({
      id: `frame:s${i}:0`,
      vector: Float32Array.from({ length: 4 }, () => random() - 0.5),
      metadata: { assetId: 'a1', kind: 'frame' },
    });
    unwrap(index.upsert(Array.from({ length: 4200 }, (_, i) => frame(i))));
    unwrap(
      index.upsert([
        { id: 'transcript:a1:0', vector: [1, 0, 0, 0], metadata: { assetId: 'a1', kind: 'transcript' } },
        { id: 'frame:other:0', vector: [0, 1, 0, 0], metadata: { assetId: 'a2', kind: 'frame' } },
      ]),
    );
    const next = [frame(0), frame(4199), frame(5000)];
    expect(unwrap(index.replaceWhere({ assetId: 'a1', kind: ['frame'] }, next))).toBe(4198);
    const ids = db.driver
      .prepare('SELECT item_id FROM vec_default ORDER BY item_id')
      .values()
      .map((row) => String(row[0]));
    expect(ids).toEqual(['frame:other:0', 'frame:s0:0', 'frame:s4199:0', 'frame:s5000:0', 'transcript:a1:0']);
    // Nothing new: every id of those kinds goes. A bad item writes nothing and removes nothing.
    const bad = index.replaceWhere({ assetId: 'a1', kind: ['frame'] }, [{ id: 'x', vector: [1, 2] }]);
    expect(bad.ok).toBe(false);
    expect(index.count()).toBe(5);
    expect(unwrap(index.replaceWhere({ assetId: 'a1', kind: ['frame'] }, []))).toBe(3);
    expect(index.count()).toBe(2);
    expect(index.replaceWhere({}, []).ok).toBe(false);
    expect(unwrap(index.replaceWhere({ assetId: [] }, [frame(1)]))).toBe(0);
  });

  it('supports an L2 index with raw Euclidean distances', () => {
    const db = openTestDb(withVec);
    const index = unwrap(openVectorIndex(db, { name: 'l2_test', dimensions: 2, metric: 'l2' }));
    unwrap(
      index.upsert([
        { id: 'far', vector: [3, 4] },
        { id: 'near', vector: [1, 0] },
      ]),
    );
    expect(unwrap(index.search([0, 0], { k: 2 })).map((m) => [m.id, m.distance])).toEqual([
      ['near', 1],
      ['far', 5],
    ]);
  });

  it('validates vectors, k and filters', () => {
    const db = openTestDb(withVec);
    const index = unwrap(openVectorIndex(db, { dimensions: 3 }));
    for (const vector of [
      [1, 0],
      [Number.NaN, 0, 0],
      [0, 0, 0],
    ]) {
      const result = index.upsert([{ id: 'x', vector }]);
      expect(!result.ok && ValidationError.is(result.error)).toBe(true);
    }
    expect(index.search([1, 0, 0], { k: 0 }).ok).toBe(false);
    expect(index.search([1, 0, 0], { k: 5000 }).ok).toBe(false);
    expect(index.removeWhere({}).ok).toBe(false);
    expect(openVectorIndex(db, { name: 'Bad-Name' }).ok).toBe(false);
  });

  it('remembers dimensions and metric, and refuses a mismatch', () => {
    const path = join(tempDir(), 'library.db');
    const db = unwrap(openDatabase({ path, ...withVec }));
    unwrap(openVectorIndex(db, { name: 'shots', dimensions: 8 }));
    db.close();
    const again = unwrap(openDatabase({ path, ...withVec }));
    expect(unwrap(openVectorIndex(again, { name: 'shots', dimensions: 8 })).dimensions).toBe(8);
    const wrong = openVectorIndex(again, { name: 'shots', dimensions: 16 });
    expect(!wrong.ok && VectorIndexMismatch.is(wrong.error)).toBe(true);
    const index = unwrap(openVectorIndex(again, { name: 'shots', dimensions: 8 }));
    unwrap(index.drop());
    expect(unwrap(openVectorIndex(again, { name: 'shots', dimensions: 16 })).dimensions).toBe(16);
    again.close();
  });

  it('survives backup, integrity check and restore', () => {
    const path = join(tempDir(), 'library.db');
    const db = unwrap(openDatabase({ path, ...withVec }));
    const index = unwrap(openVectorIndex(db, { dimensions: 4 }));
    unwrap(index.upsert([{ id: 'kept', vector: [0, 0, 1, 0] }]));
    const backup = unwrap(db.backup('test'));
    db.close();
    // The integrity check on open covers the vec0 shadow tables too.
    const copy = unwrap(
      openDatabase({ path: backup.path, backups: { dir: join(tempDir(), 'b') }, ...withVec }),
    );
    expect(
      unwrap(unwrap(openVectorIndex(copy, { dimensions: 4 })).search([0, 0, 1, 0], { k: 1 }))[0]?.id,
    ).toBe('kept');
    copy.close();
  });
});
