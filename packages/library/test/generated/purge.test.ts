// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The 30-day purge of kept files (library.collect): an unused take goes 30 days after it was made, with its
 * file and vectors; a clip, a mention in a working copy (a voice line not placed yet) or in a saved version
 * keeps it, and its 30 days start when that use ends; bytes the person also imported stay; a root on an
 * unplugged drive waits.
 */
import { existsSync } from 'node:fs';
import { newId, ok, unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  collect,
  createAssetLocationRepository,
  createSourceRepository,
  GENERATED_RETENTION_MS,
  purgeGenerated,
} from '../../src/index';
import { image, row, setup, timeline } from './fixture';

const DAY = 24 * 60 * 60 * 1000;
const count = (env: ReturnType<typeof setup>) => row(env.db, 'SELECT count(*) AS n FROM assets');

describe('generated purge', () => {
  it('deletes an unused take 30 days after it was made, with its file and vectors', async () => {
    const env = setup();
    const kept = unwrap(await env.sink.put(image('unused take')));
    const [location] = createAssetLocationRepository(env.db).listByAsset(kept.assetId);
    const file = String(location?.absolutePathCached);
    env.clock.advance(GENERATED_RETENTION_MS - DAY);
    const vectorsFor: AssetId[][] = [];
    const removeVectors = (ids: readonly AssetId[]) => {
      vectorsFor.push([...ids]);
      return ok(3);
    };
    expect(unwrap(await collect({ db: env.db, removeVectors }))).toMatchObject({ assets: 0 });
    expect(existsSync(file)).toBe(true);

    env.clock.advance(DAY);
    expect(unwrap(await collect({ db: env.db, removeVectors }))).toMatchObject({ assets: 1, vectors: 3 });
    expect(vectorsFor).toEqual([[kept.assetId]]);
    expect(existsSync(file)).toBe(false);
    expect(count(env)).toEqual({ n: 0 });
    expect(row(env.db, 'SELECT count(*) AS n FROM generated_assets')).toEqual({ n: 0 });
  });

  it('keeps what a clip, a working copy or a saved version uses, and starts the 30 days when that ends', async () => {
    const env = setup();
    const clip = unwrap(await env.sink.put(image('on a clip')));
    const line = unwrap(await env.sink.put(image('a voice line')));
    const saved = unwrap(await env.sink.put(image('in a saved version')));
    const used = timeline(env.db, { tracks: [] }, clip.assetId);
    timeline(env.db, { voiceover: { lines: [{ assetId: line.assetId, clipId: null }] } });
    const versioned = timeline(env.db, { tracks: [] });
    env.db.driver
      .prepare(
        `INSERT INTO timeline_versions (id, timeline_id, number, kind, schema_version, document, revision,
           document_hash, created_at) VALUES (?, ?, 1, 'named', 2, ?, 1, ?, 1)`,
      )
      .run(newId<'TimelineVersion'>(), versioned, JSON.stringify({ clips: [saved.assetId] }), 'c'.repeat(64));

    env.clock.advance(GENERATED_RETENTION_MS * 2);
    unwrap(await purgeGenerated({ db: env.db }));
    expect(count(env)).toEqual({ n: 3 });
    expect(
      row(env.db, 'SELECT count(*) AS n FROM generated_assets WHERE unreferenced_since IS NULL'),
    ).toEqual({
      n: 3,
    });

    env.db.driver.prepare('DELETE FROM timeline_asset_refs WHERE timeline_id = ?').run(used);
    unwrap(await purgeGenerated({ db: env.db })); // the clip's 30 days start now
    env.clock.advance(GENERATED_RETENTION_MS - 1);
    expect(unwrap(await purgeGenerated({ db: env.db })).assets).toBe(0);
    env.clock.advance(1);
    expect(unwrap(await purgeGenerated({ db: env.db })).assets).toBe(1);
    expect(row(env.db, 'SELECT count(*) AS n FROM assets WHERE id = ?', clip.assetId)).toEqual({ n: 0 });
  });

  it('stops tracking bytes the person also has elsewhere, and waits for an unplugged drive', async () => {
    const env = setup();
    const adopted = unwrap(await env.sink.put(image('also imported')));
    const folder = unwrap(
      createSourceRepository(env.db).add({
        kind: 'watched_folder',
        displayName: 'Trip',
        rootPath: '/Users/me/Trip',
      }),
    );
    unwrap(
      createAssetLocationRepository(env.db).add({
        assetId: adopted.assetId,
        sourceId: folder.id,
        storage: 'referenced',
        relativePath: 'still.png',
        sizeBytes: 13,
        state: 'present',
      }),
    );
    const away = unwrap(await env.sink.put(image('on a drive')));
    env.db.driver
      .prepare(`UPDATE asset_locations SET absolute_path_cached = ? WHERE asset_id = ?`)
      .run('/Volumes/No Such Drive 9c1e/Originals/Generated/aa/x.png', away.assetId);

    env.clock.advance(GENERATED_RETENTION_MS * 2);
    expect(unwrap(await purgeGenerated({ db: env.db })).assets).toBe(0);
    expect(count(env)).toEqual({ n: 2 });
    expect(row(env.db, 'SELECT asset_id FROM generated_assets')).toEqual({ asset_id: away.assetId });
  });
});
