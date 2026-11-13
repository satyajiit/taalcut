// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, unwrap } from '@taalcut/core';
import { expect, it } from 'vitest';
import { importer } from './fixture';

it('repairs a missing managed original without discarding the replacement or changing asset identity', async () => {
  const t = await importer();
  const original = t.stage('original.mov');
  const first = unwrap(await t.sink.importStaged(original.file));
  const oldPath = t.rows('SELECT absolute_path_cached AS path FROM asset_locations')[0]!.path as string;
  rmSync(oldPath);
  expect(unwrap(await t.sink.knownAssets([first.assetId])).size).toBe(0);
  const next = t.stage('replacement.mov', original.bytes);
  const recovered = unwrap(await t.sink.importStaged(next.file));
  expect(recovered).toMatchObject({ assetId: first.assetId, duplicate: 'added-managed-copy' });
  const [location] = t.rows('SELECT absolute_path_cached AS path, state FROM asset_locations');
  expect(location!.state).toBe('present');
  expect(readFileSync(location!.path as string)).toEqual(original.bytes);
  expect(unwrap(await t.sink.knownAssets([first.assetId]))).toEqual(new Set([first.assetId]));
  expect(t.rows('SELECT id FROM assets')).toHaveLength(1);
});

it('does not replay a stale success receipt after its saved original has disappeared', async () => {
  const t = await importer();
  const original = t.stage('original.mov');
  const first = unwrap(await t.sink.importStaged(original.file));
  rmSync(t.rows('SELECT absolute_path_cached AS path FROM asset_locations')[0]!.path as string);
  writeFileSync(original.file.path, original.bytes);
  writeFileSync(join(t.dir, `${original.file.uploadId}.dest`), '/obsolete/original.mov');
  const repaired = unwrap(await t.sink.importStaged(original.file));
  expect(repaired).toMatchObject({ assetId: first.assetId, duplicate: 'added-managed-copy' });
  const [location] = t.rows('SELECT absolute_path_cached AS path FROM asset_locations');
  expect(readFileSync(location!.path as string)).toEqual(original.bytes);
  expect(existsSync(original.file.path)).toBe(false);
  expect(existsSync(join(t.dir, `${original.file.uploadId}.dest`))).toBe(false);
});

it('preserves the incoming original when a managed file was replaced by different equal-size bytes', async () => {
  const t = await importer();
  const original = t.stage('original.mov');
  const first = unwrap(await t.sink.importStaged(original.file));
  const oldPath = t.rows('SELECT absolute_path_cached AS path FROM asset_locations')[0]!.path as string;
  const altered = Buffer.alloc(original.bytes.length, 42);
  writeFileSync(oldPath, altered);
  const next = t.stage('replacement.mov', original.bytes);
  const repaired = unwrap(await t.sink.importStaged(next.file));
  expect(repaired).toMatchObject({ assetId: first.assetId, duplicate: 'added-managed-copy' });
  const [location] = t.rows('SELECT absolute_path_cached AS path FROM asset_locations');
  expect(readFileSync(location!.path as string)).toEqual(original.bytes);
  expect(readFileSync(oldPath)).toEqual(altered);
});

it('removes redundant restaged bytes only after validating an intact completed import', async () => {
  const t = await importer();
  const original = t.stage('original.mov');
  const first = unwrap(await t.sink.importStaged(original.file));
  writeFileSync(original.file.path, original.bytes);
  expect(unwrap(await t.sink.importStaged(original.file))).toEqual(first);
  expect(existsSync(original.file.path)).toBe(false);
});

it('preserves unrelated bytes occupying a journalled destination', async () => {
  const t = await importer();
  const incoming = t.stage('original.mov');
  const destination = join(t.root, 'occupied.mov');
  const unrelated = Buffer.alloc(incoming.bytes.length, 77);
  writeFileSync(destination, unrelated);
  writeFileSync(join(t.dir, `${incoming.file.uploadId}.dest`), destination);
  unwrap(await t.sink.importStaged(incoming.file));
  expect(readFileSync(destination)).toEqual(unrelated);
  const [location] = t.rows('SELECT absolute_path_cached AS path FROM asset_locations');
  expect(readFileSync(location!.path as string)).toEqual(incoming.bytes);
});

it.each([false, true])(
  'retains the first source when repairing a missing copy (legacy=%s)',
  async (legacy) => {
    const t = await importer();
    const original = t.stage('original.mov');
    const first = unwrap(await t.sink.importStaged(original.file));
    expect(t.rows('SELECT * FROM library_asset_sources')).toHaveLength(1);
    if (legacy) t.db.driver.exec('DELETE FROM import_provenance');
    const [location] = t.rows('SELECT absolute_path_cached AS path FROM asset_locations');
    rmSync(location!.path as string);
    const replacement = t.stage('replacement.mov', original.bytes, { sessionId: newId<'TransferSession'>() });
    const repaired = unwrap(await t.sink.importStaged(replacement.file));
    expect(repaired.sourceId).not.toBe(first.sourceId);
    expect(
      t
        .rows('SELECT source_id FROM library_asset_sources')
        .map((row) => row.source_id)
        .sort(),
    ).toEqual([first.sourceId, repaired.sourceId].sort());
  },
);
