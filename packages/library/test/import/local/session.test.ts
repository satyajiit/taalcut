// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { unwrap } from '@taalcut/core';
import {
  createImportSessionService,
  createLocalImportAdapter,
  createDeviceVolumeProbe,
  createImportReaderRegistry,
} from '../../../src/index';
import { openTestDb, tempDir } from '../../helpers';

async function fixture() {
  const db = openTestDb();
  const root = join(tempDir(), 'originals');
  await mkdir(root);
  const source = join(tempDir(), 'take.mp4');
  await writeFile(source, 'fixture footage');
  const adapter = createLocalImportAdapter({
    db,
    originalsRoot: async () => root,
    volumes: createDeviceVolumeProbe(),
    pick: async () => ({ ok: true, value: [source] }),
  });
  const service = createImportSessionService({ db, adapters: { files: adapter } });
  return { db, root, source, service };
}

it('runs the native file flow through a persisted draft, review, copy, and receipt', async () => {
  const { db, source, service } = await fixture();
  const { draftId } = unwrap(await service.createDraft({ method: 'files', watch: false }));
  const draft = service.draft(draftId)!;
  expect(draft.storage).toBe('copy');
  expect(JSON.stringify(service.items({ draftId }))).not.toContain(source);
  expect(unwrap(await service.preflight(draftId))).toMatchObject({
    selectedItems: 1,
    knownBytes: 15,
    canStart: true,
  });
  const { sessionId } = unwrap(await service.start(draftId));
  await expect.poll(() => service.session({ sessionId })?.session.status).not.toBe('running');
  expect(service.session({ sessionId })).toMatchObject({
    session: { status: 'completed' },
    items: [{ error: null }],
  });
  const receipt = service.session({ sessionId })!;
  expect(receipt.items[0]).toMatchObject({ state: 'imported', result: { kind: 'asset' } });
  expect(await readFile(source, 'utf8')).toBe('fixture footage');
  expect(db.driver.prepare('SELECT kind FROM sources').get()?.['kind']).toBe('local_import');
  expect(db.driver.prepare('SELECT COUNT(*) AS n FROM library_asset_sources').get()?.['n']).toBe(1);
  await service.close();
});

it('blocks a changed restored selection before starting any transfer', async () => {
  const { source, service } = await fixture();
  const { draftId } = unwrap(await service.createDraft({ method: 'files', watch: false }));
  await writeFile(source, 'changed after review');
  expect(unwrap(await service.preflight(draftId))).toMatchObject({
    canStart: false,
    warnings: ['source-changed'],
  });
  expect((await service.start(draftId)).ok).toBe(false);
  expect((await stat(source)).size).toBe(20);
  await service.close();
});

it('guards every selected volume and waits for other readers before advertising disconnect', async () => {
  const db = openTestDb();
  const root = tempDir();
  const first = join(tempDir(), 'first.mp4');
  const second = join(tempDir(), 'second.mp4');
  await writeFile(first, 'first footage');
  await writeFile(second, 'second footage');
  const firstPath = await realpath(first);
  const secondPath = await realpath(second);
  const readers = createImportReaderRegistry(db);
  const observed: number[] = [];
  const adapter = createLocalImportAdapter({
    db,
    originalsRoot: async () => root,
    volumes: {
      identify: async (path) => ({
        uuid: path === firstPath ? 'card-one' : path === secondPath ? 'card-two' : 'target',
        name: null,
        mountPoint: '/',
      }),
      mountedUuids: async () => new Set(['card-one', 'card-two', 'target']),
    },
    pick: async () => ({ ok: true, value: [first, second] }),
    events: {
      emit() {
        observed.push(readers.count('card-one'), readers.count('card-two'));
      },
    },
  });
  const service = createImportSessionService({ db, adapters: { files: adapter } });
  const { draftId } = unwrap(await service.createDraft({ method: 'files', watch: false }));
  const { sessionId } = unwrap(await service.start(draftId));
  await expect.poll(() => service.session({ sessionId })?.session.status).toBe('completed');
  expect(observed.length).toBeGreaterThan(0);
  expect(observed.every((count) => count > 0)).toBe(true);
  expect(service.session({ sessionId })?.session.safeToDisconnect).toBe(true);
  const release = unwrap(readers.acquire('another-thumbnail', 'card-two'));
  expect(service.session({ sessionId })?.session.safeToDisconnect).toBe(false);
  release();
  expect(service.session({ sessionId })?.session.safeToDisconnect).toBe(true);
  await service.close();
});

it('creates an empty watched root and respects a nonrecursive initial scan', async () => {
  const db = openTestDb();
  const root = tempDir();
  const source = tempDir();
  const adapter = createLocalImportAdapter({
    db,
    originalsRoot: async () => root,
    volumes: createDeviceVolumeProbe(),
    pick: async () => ({ ok: true, value: [source] }),
  });
  const service = createImportSessionService({ db, adapters: { folder: adapter } });
  const { draftId } = unwrap(await service.createDraft({ method: 'folder', watch: true }));
  unwrap(await service.updateDraft({ draftId, recursive: false }));
  expect(unwrap(await service.preflight(draftId))).toMatchObject({ canStart: true, selectedItems: 0 });
  const { sessionId } = unwrap(await service.start(draftId));
  await expect.poll(() => service.session({ sessionId })?.session.status).toBe('completed');
  expect(service.session({ sessionId })?.session.sourceId).toBeTruthy();
  expect(db.driver.prepare('SELECT recursive FROM import_source_scopes').get()?.recursive).toBe(0);
  expect(db.driver.prepare('SELECT root_path,watch FROM sources').get()).toMatchObject({
    root_path: await realpath(source),
    watch: 1,
  });
  expect(service.session({ sessionId })?.session.progress.totalBytes).toBeNull();
  await service.close();
});
