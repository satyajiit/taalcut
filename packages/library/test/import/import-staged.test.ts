// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Wi-Fi hand-off (P2-L3): a staged upload becomes a managed original in
 * the dated folder, with its asset, location and `library.hash` done, in one
 * transaction; ADR 0001's duplicates; name clashes; idempotence per upload,
 * including after a crash between the rename and the commit, and after one
 * past the commit.
 */
import { existsSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEventBus, unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createImportSink, hashAsset, scanSource } from '../../src/index';
import { fakeVolumes, library, writeMedia } from '../sources/fixture';
import { importer } from './fixture';

describe('ImportSink.importStaged', () => {
  it('moves a new upload into the dated originals folder and records it in one go', async () => {
    const t = await importer();
    const { file, bytes } = t.stage('IMG_1234.MOV');
    const outcome = unwrap(await t.sink.importStaged(file));
    expect(outcome.duplicate).toBe('none');

    const dest = join(t.root, '2026', '2026-10-12', 'IMG_1234.MOV');
    expect(existsSync(dest)).toBe(true);
    expect(readdirSync(t.dir)).toEqual([`${file.uploadId}.done.json`]); // Staged file, info and journal gone.
    const [asset] = t.rows('SELECT * FROM assets');
    expect(asset).toMatchObject({
      id: outcome.assetId,
      kind: 'video',
      content_hash_alg: 'blake3',
      size_bytes: bytes.length,
      original_filename: 'IMG_1234.MOV',
      availability: 'online',
      reencode: 'unlikely',
      reencode_reasons: JSON.stringify(['hevc', 'camera-metadata']),
    });
    expect(t.rows('SELECT storage, state, via, relative_path FROM asset_locations')).toEqual([
      { storage: 'managed', state: 'present', via: 'wifi', relative_path: '2026/2026-10-12/IMG_1234.MOV' },
    ]);
    const source = unwrap(t.repos.sources.get(outcome.sourceId));
    expect(source).toMatchObject({
      kind: 'wifi_import',
      displayName: 'iPhone',
      deviceLabel: 'iPhone',
      rootPath: t.root,
    });
    expect(source.transferSessionId).toBe(t.sessionId);
    expect(t.rows('SELECT stage, state, output FROM asset_index_stages')).toEqual([
      { stage: 'library.hash', state: 'done', output: JSON.stringify({ contentHash: asset!.content_hash }) },
    ]);
    // Idempotent per upload: asking again returns the same outcome and writes nothing.
    expect(unwrap(await t.sink.importStaged(file))).toEqual(outcome);
    expect(t.rows('SELECT id FROM assets')).toHaveLength(1);
  });

  it('keeps one session source for every file of the session, and announces each asset', async () => {
    const events = createEventBus({ clock: { now: () => 1 } });
    const seen: unknown[] = [];
    events.on('library.changed', (e) => seen.push(e.payload));
    const t = await importer({ events });
    const a = unwrap(await t.sink.importStaged(t.stage('a.jpg').file));
    const b = unwrap(await t.sink.importStaged(t.stage('b.m4a').file));
    expect(b.sourceId).toBe(a.sourceId);
    expect(t.rows('SELECT kind FROM assets ORDER BY original_filename').map((r) => r.kind)).toEqual([
      'image',
      'audio',
    ]);
    expect(seen).toEqual([
      { projectId: null, entity: 'asset', change: 'created', ids: [a.assetId] },
      { projectId: null, entity: 'asset', change: 'created', ids: [b.assetId] },
    ]);
  });

  it('drops bytes the library already manages, and keeps them as the managed copy of a watched-only asset', async () => {
    const t = await importer();
    const first = t.stage('first.mov');
    const kept = unwrap(await t.sink.importStaged(first.file));
    const again = t.stage('again.mov', first.bytes);
    const dropped = unwrap(await t.sink.importStaged(again.file));
    expect(dropped).toEqual({
      assetId: kept.assetId,
      sourceId: kept.sourceId,
      duplicate: 'already-in-library',
    });
    expect(existsSync(again.file.path)).toBe(false);
    expect(t.rows('SELECT id FROM asset_locations')).toHaveLength(1);

    // An asset only in a watched folder gains this upload as its managed copy.
    const lib = library({ db: t.db });
    const folder = lib.addFolder('Camera');
    const watched = writeMedia(folder.root, 'clip.mov', 7000);
    unwrap(
      await scanSource(
        { db: t.db, hasher: lib.hasher, volumes: fakeVolumes() },
        { sourceId: folder.id, mode: 'full' },
      ),
    );
    const [location] = lib.locations(folder.id);
    unwrap(
      await hashAsset(
        { db: t.db, hasher: lib.hasher },
        { assetId: location!.assetId as AssetId, generation: 0 },
      ),
    );
    const { readFileSync } = await import('node:fs');
    const copy = t.stage('clip.mov', readFileSync(watched));
    const added = unwrap(await t.sink.importStaged(copy.file));
    expect(added).toMatchObject({ assetId: location!.assetId, duplicate: 'added-managed-copy' });
    expect(
      t.rows('SELECT storage FROM asset_locations WHERE asset_id = ? ORDER BY storage', added.assetId),
    ).toEqual([{ storage: 'managed' }, { storage: 'referenced' }]);
  });

  it('names a clash with " (2)" and sanitises what the phone sent', async () => {
    const t = await importer();
    unwrap(await t.sink.importStaged(t.stage('IMG_0001.MOV').file));
    unwrap(await t.sink.importStaged(t.stage('IMG_0001.MOV').file));
    unwrap(await t.sink.importStaged(t.stage('../..\u0007/evil:name.mov').file));
    expect(readdirSync(join(t.root, '2026', '2026-10-12')).sort()).toEqual([
      'IMG_0001 (2).MOV',
      'IMG_0001.MOV',
      '__..__evil_name.mov',
    ]);
  });

  it('finds the file again after a crash between the rename and the commit', async () => {
    const t = await importer();
    const { file } = t.stage('crash.mov');
    // What the sink had done before the crash: the destination journalled, the file renamed.
    const dest = join(t.root, '2026', '2026-10-12', 'crash.mov');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(t.root, '2026', '2026-10-12'), { recursive: true });
    writeFileSync(join(t.dir, `${file.uploadId}.dest`), dest);
    renameSync(file.path, dest);
    const outcome = unwrap(await t.sink.importStaged(file));
    expect(outcome.duplicate).toBe('none');
    expect(t.rows('SELECT relative_path FROM asset_locations')).toEqual([
      { relative_path: '2026/2026-10-12/crash.mov' },
    ]);
    expect(readdirSync(t.dir)).toEqual([`${file.uploadId}.done.json`]);
  });

  it('doesn’t record a second copy after a crash past the commit', async () => {
    const t = await importer();
    let crash = true;
    const sink = createImportSink(t.db, {
      originalsRoot: t.root,
      events: {
        emit: () => {
          if (crash) throw new Error('killed after the commit');
        },
      },
    });
    const { file } = t.stage('late.mov');
    expect((await sink.importStaged(file)).ok).toBe(false);
    expect(t.rows('SELECT id FROM asset_locations')).toHaveLength(1);
    crash = false;
    const outcome = unwrap(await sink.importStaged(file));
    expect(outcome.duplicate).toBe('none');
    expect(t.rows('SELECT id FROM asset_locations')).toHaveLength(1);
    expect(t.rows('SELECT id FROM assets')).toEqual([{ id: outcome.assetId }]);
  });

  it('refuses a path outside the staging folder, and reports an unplugged originals drive', async () => {
    const t = await importer();
    const { file } = t.stage('x.mov');
    const outside = await t.sink.importStaged({ ...file, path: '/etc/hosts' });
    expect(!outside.ok && outside.error.code).toBe('core.validation');
    const offline = createImportSink(t.db, { originalsRoot: '/Volumes/Missing SSD/Originals' });
    const staging = await offline.staging();
    expect(!staging.ok && staging.error).toMatchObject({
      code: 'library.originals_offline',
      params: { name: 'Missing SSD' },
    });
    const staged = unwrap(await t.sink.staging());
    expect(staged).toMatchObject({ dir: t.dir, freeBytes: expect.any(Number), volumeName: 'Disk' });
    expect(staged.freeBytes).toBeGreaterThan(0);
  });
});
