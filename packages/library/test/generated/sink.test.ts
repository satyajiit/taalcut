// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * GeneratedAssetSink (P3-B6, P3-B7, P3-V6): bytes kept unchanged and content-addressed under the originals
 * root, recorded with their provenance and a present managed location, hashed already for indexing; the same
 * bytes again are the same asset; bad input, an unplugged root and a cancel are refused.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createAssetLocationRepository,
  createAssetRepository,
  createGeneratedAssetSink,
} from '../../src/index';
import { openTestDb } from '../helpers';
import { image, project, row, setup } from './fixture';

describe('generated asset sink', () => {
  it('keeps the bytes as a new asset with its provenance and a managed copy', async () => {
    const env = setup();
    const projectId = project(env.db);
    const file = image('a still frame', projectId);
    const kept = unwrap(await env.sink.put(file));
    expect(kept.duplicate).toBe(false);
    expect(kept.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const path = join(env.root, 'Generated', kept.contentHash.slice(0, 2), `${kept.contentHash}.png`);
    expect(readFileSync(path, 'utf8')).toBe('a still frame');
    const asset = unwrap(createAssetRepository(env.db).get(kept.assetId));
    expect(asset).toMatchObject({ kind: 'image', contentHash: kept.contentHash, availability: 'online' });
    expect(asset.originalFilename).toBe(file.fileName);
    expect(JSON.parse(asset.provenance)).toEqual(file.provenance);
    const [location] = createAssetLocationRepository(env.db).listByAsset(kept.assetId);
    expect(location).toMatchObject({ storage: 'managed', state: 'present', absolutePathCached: path });
    expect(
      row(env.db, 'SELECT kind, display_name FROM sources WHERE id = ?', String(location?.sourceId)),
    ).toEqual({
      kind: 'generated',
      display_name: 'Generated',
    });
    expect(
      row(
        env.db,
        `SELECT state FROM asset_index_stages WHERE asset_id = ? AND stage = 'library.hash'`,
        kept.assetId,
      ),
    ).toEqual({ state: 'done' });
    expect(row(env.db, 'SELECT * FROM generated_assets WHERE asset_id = ?', kept.assetId)).toMatchObject({
      project_id: projectId,
      unreferenced_since: env.clock.now(),
    });
    expect(env.events).toEqual([
      { projectId: null, entity: 'asset', change: 'created', ids: [kept.assetId] },
    ]);
  });

  it('answers the same asset for the same bytes, and restarts its 30 days', async () => {
    const env = setup();
    const first = unwrap(await env.sink.put(image('voice line')));
    env.db.driver.prepare('UPDATE generated_assets SET unreferenced_since = 5').run();
    env.clock.advance(1000);
    const again = unwrap(await env.sink.put({ ...image('voice line'), fileName: 'voice-other.png' }));
    expect(again).toEqual({ ...first, duplicate: true });
    expect(createAssetLocationRepository(env.db).listByAsset(first.assetId)).toHaveLength(1);
    expect(row(env.db, 'SELECT unreferenced_since AS since FROM generated_assets')).toEqual({
      since: env.clock.now(),
    });
    expect(env.events).toHaveLength(1);

    const [a, b] = await Promise.all([env.sink.put(image('raced')), env.sink.put(image('raced'))]);
    expect(unwrap(a).assetId).toBe(unwrap(b).assetId);
  });

  it('gives bytes the library had without a readable copy the kept file as one', async () => {
    const env = setup();
    const known = unwrap(await env.sink.put(image('offline original')));
    env.db.driver.prepare('DELETE FROM asset_locations WHERE asset_id = ?').run(known.assetId);
    const again = unwrap(await env.sink.put(image('offline original')));
    expect(again).toEqual({ ...known, duplicate: true });
    const locations = createAssetLocationRepository(env.db).listByAsset(known.assetId);
    expect(locations.map((l) => l.state)).toEqual(['present']);
  });

  it('refuses bad input, an unplugged root and a cancelled put', async () => {
    const env = setup();
    const code = async (result: Promise<{ ok: boolean; error?: { code: string } }>) => {
      const r = await result;
      return r.ok ? 'ok' : r.error?.code;
    };
    expect(await code(env.sink.put({ ...image('x'), bytes: new Uint8Array() }))).toBe('core.validation');
    expect(await code(env.sink.put({ ...image('x'), fileName: '../escape.png' }))).toBe('core.validation');
    const captured = Object.assign(image('x'), { provenance: { kind: 'captured' } });
    expect(await code(env.sink.put(captured))).toBe('core.validation');
    // A media type the sink doesn't list, as an untyped caller could send it.
    const video = Object.assign(image('x'), { mediaType: 'video/webm' });
    expect(await code(env.sink.put(video))).toBe('core.validation');
    const stopped = new AbortController();
    stopped.abort();
    expect(await code(env.sink.put(image('x'), { signal: stopped.signal }))).toBe('core.cancelled');

    const unplugged = createGeneratedAssetSink(openTestDb({ file: false }), {
      originalsRoot: '/Volumes/No Such Drive 7f3a/Originals',
    });
    expect(await code(unplugged.put(image('x')))).toBe('library.originals_offline');
    expect(row(env.db, 'SELECT count(*) AS n FROM assets')).toEqual({ n: 0 });
  });

  it('keeps an unknown project as no project, and audio as an audio asset', async () => {
    const env = setup();
    const kept = unwrap(
      await env.sink.put({
        ...image('a sound'),
        mediaType: 'audio/flac',
        fileName: 'sfx-whoosh.flac',
        projectId: newId<'Project'>(),
      }),
    );
    expect(unwrap(createAssetRepository(env.db).get(kept.assetId as AssetId)).kind).toBe('audio');
    expect(row(env.db, 'SELECT project_id FROM generated_assets')).toEqual({ project_id: null });
  });
});
