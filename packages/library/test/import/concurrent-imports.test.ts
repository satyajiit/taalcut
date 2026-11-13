// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFile } from 'node:fs/promises';
import { newId, unwrap } from '@taalcut/core';
import { expect, it } from 'vitest';
import { importer } from './fixture';

it('reserves destination names across concurrent imports without overwriting either original', async () => {
  const fx = await importer();
  const first = fx.stage('same.mov', new Uint8Array(5000).fill(10));
  const second = fx.stage('same.mov', new Uint8Array(5000).fill(20), {
    sessionId: newId<'TransferSession'>(),
  });
  const results = await Promise.all([fx.sink.importStaged(first.file), fx.sink.importStaged(second.file)]);
  const ids = results.map((result) => unwrap(result).assetId);
  expect(new Set(ids).size).toBe(2);
  const paths = ids.map((id) =>
    String(fx.rows('SELECT absolute_path_cached AS path FROM asset_locations WHERE asset_id=?', id)[0]?.path),
  );
  expect(new Set(paths).size).toBe(2);
  expect(await readFile(paths[0]!)).toEqual(Buffer.from(first.bytes));
  expect(await readFile(paths[1]!)).toEqual(Buffer.from(second.bytes));
});

it('records cross-source provenance when an exact duplicate keeps the existing managed copy', async () => {
  const fx = await importer();
  const first = fx.stage('first.mov');
  const original = unwrap(await fx.sink.importStaged(first.file));
  const second = fx.stage('card.mov', first.bytes, {
    sessionId: newId<'TransferSession'>(),
    channel: 'camera',
    source: { label: 'Camera card' },
  });
  const duplicate = unwrap(await fx.sink.importStaged(second.file));
  expect(duplicate.assetId).toBe(original.assetId);
  expect(duplicate.sourceId).not.toBe(original.sourceId);
  expect(
    fx.rows('SELECT source_id FROM library_asset_sources WHERE asset_id=?', original.assetId),
  ).toHaveLength(2);
  expect(fx.rows('SELECT id FROM asset_locations WHERE asset_id=?', original.assetId)).toHaveLength(1);
});

it('imports a new local file without a phone identity and preserves the location channel', async () => {
  const fx = await importer();
  const staged = fx.stage('local.mp4', new Uint8Array(5000).fill(30), {
    channel: 'local',
    source: { label: 'Selected files' },
  });
  const { device: _device, ...file } = staged.file;
  const result = unwrap(await fx.sink.importStaged(file));
  expect(fx.rows('SELECT kind FROM sources WHERE id=?', result.sourceId)[0]?.kind).toBe('local_import');
  expect(fx.rows('SELECT via FROM asset_locations WHERE asset_id=?', result.assetId)[0]?.via).toBe('local');
});
