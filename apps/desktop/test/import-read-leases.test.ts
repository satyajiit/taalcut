// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { afterEach, expect, it, vi } from 'vitest';
import { newId, ok, unwrap, type JobContext } from '@taalcut/core';
import {
  createImportReaderRegistry,
  createSourceRepository,
  openDatabase,
  type LibraryDatabase,
  type VolumeProbe,
} from '@taalcut/library';
import { withImportReadLeases } from '../src/utility/roots/import-read-leases';

const databases: LibraryDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function fixture() {
  const db = unwrap(openDatabase({ path: ':memory:' }));
  databases.push(db);
  const source = unwrap(
    createSourceRepository(db).add({
      kind: 'watched_folder',
      displayName: 'Card',
      rootPath: '/Volumes/Card',
      volumeUuid: 'card-volume',
    }),
  );
  const controller = new AbortController();
  const context: JobContext = {
    jobId: newId<'Job'>(),
    projectId: null,
    attempt: 1,
    signal: controller.signal,
    progress: () => {},
  };
  const probe: VolumeProbe = {
    identify: async () => ({ uuid: 'preview-volume', name: 'Preview', mountPoint: '/Volumes/Preview' }),
    mountedUuids: async () => new Set(['card-volume', 'preview-volume']),
  };
  return { db, source, controller, context, probe, readers: createImportReaderRegistry(db) };
}

it('holds scan and direct preview readers through abort until the worker actually settles', async () => {
  const t = fixture();
  let finish!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const handler = withImportReadLeases(t.db, t.probe, async () => {
    entered();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return ok('finished');
  });
  const running = handler({ sourceId: t.source.id, path: '/Volumes/Preview/take.mov' }, t.context);
  await started;
  expect(t.readers.count('card-volume')).toBe(1);
  expect(t.readers.count('preview-volume')).toBe(1);
  t.controller.abort();
  const eject = vi.fn(async () => ok(undefined));
  expect((await t.readers.eject('card-volume', eject)).ok).toBe(false);
  expect(eject).not.toHaveBeenCalled();
  finish();
  expect(unwrap(await running)).toBe('finished');
  expect(t.readers.count('card-volume')).toBe(0);
  expect(t.readers.count('preview-volume')).toBe(0);
  expect((await t.readers.eject('card-volume', eject)).ok).toBe(true);
});

it('refuses a new hash/index reader while another process owns the eject barrier', async () => {
  const t = fixture();
  const assetId = newId<'Asset'>();
  t.db.driver
    .prepare(
      `INSERT INTO assets(id,kind,size_bytes,original_filename,availability,created_at,updated_at)
    VALUES (?,'video',5,'take.mov','online',0,0)`,
    )
    .run(assetId);
  t.db.driver
    .prepare(
      `INSERT INTO asset_locations(id,asset_id,source_id,storage,relative_path,
    absolute_path_cached,volume_uuid,size_bytes,state) VALUES (?,?,?,'referenced','take.mov',?, ?,5,'present')`,
    )
    .run(newId<'AssetLocation'>(), assetId, t.source.id, '/Volumes/Card/take.mov', 'card-volume');
  let finish!: () => void;
  const ejecting = t.readers.eject('card-volume', async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return ok(undefined);
  });
  const execute = vi.fn(async () => ok(undefined));
  const handler = withImportReadLeases(t.db, t.probe, execute);
  const result = await handler({ nested: { assetIds: [assetId] } }, t.context);
  expect(!result.ok && result.error.code).toBe('library.import_volume_busy');
  expect(execute).not.toHaveBeenCalled();
  finish();
  unwrap(await ejecting);
});

it('releases all acquired volumes after a handler throws', async () => {
  const t = fixture();
  const handler = withImportReadLeases(t.db, t.probe, async () => {
    throw new Error('native worker exited');
  });
  expect((await handler({ sourceId: t.source.id }, t.context)).ok).toBe(false);
  expect(t.readers.count('card-volume')).toBe(0);
});
