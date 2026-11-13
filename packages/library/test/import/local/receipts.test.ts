// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { expect, it } from 'vitest';
import {
  createDeviceVolumeProbe,
  createImportSessionService,
  createLocalImportAdapter,
} from '../../../src/index';
import type { CaptureArchive } from '../../../src/import/local/archive';
import { openTestDb, tempDir } from '../../helpers';

async function fixture(name = 'take.mp4', companion?: string) {
  const db = openTestDb();
  const folder = tempDir();
  const source = join(folder, name);
  await writeFile(source, 'original footage');
  if (companion) await writeFile(join(folder, companion), 'original companion');
  const root = tempDir();
  const adapter = createLocalImportAdapter({
    db,
    originalsRoot: async () => root,
    volumes: createDeviceVolumeProbe(),
    pick: async () => ({ ok: true, value: [companion ? folder : source] }),
  });
  const create = () => createImportSessionService({ db, adapters: { files: adapter } });
  const service = create();
  const { draftId } = unwrap(await service.createDraft({ method: 'files', watch: false }));
  const { sessionId } = unwrap(await service.start(draftId));
  await expect.poll(() => service.session({ sessionId })?.session.status).toBe('completed');
  return { db, source, folder, service, create };
}

it('remembers copied sources across service restart and excludes them with Only new', async () => {
  const { db, service, create } = await fixture();
  await service.close();
  const restored = create();
  const { draftId } = unwrap(await restored.createDraft({ method: 'files', watch: false }));
  expect(restored.items({ draftId }).items[0]?.duplicate).toBe(true);
  unwrap(await restored.updateDraft({ draftId, onlyNew: true }));
  expect(unwrap(await restored.preflight(draftId)).selectedItems).toBe(0);
  expect(db.driver.prepare('SELECT COUNT(*) AS n FROM local_import_receipts').get()?.n).toBe(1);
  await restored.close();
});

it('offers a missing managed original for recovery despite its source receipt', async () => {
  const { db, source, service } = await fixture();
  const saved = db.driver.prepare('SELECT absolute_path_cached AS path FROM asset_locations').get()!;
  await rm(String(saved.path));
  const { draftId } = unwrap(await service.createDraft({ method: 'files', watch: false }));
  expect(service.items({ draftId }).items[0]?.duplicate).toBe(false);
  unwrap(await service.updateDraft({ draftId, onlyNew: true }));
  const { sessionId } = unwrap(await service.start(draftId));
  await expect.poll(() => service.session({ sessionId })?.session.status).toBe('completed');
  const repaired = db.driver.prepare('SELECT absolute_path_cached AS path FROM asset_locations').get()!;
  expect(await readFile(String(repaired.path), 'utf8')).toBe(await readFile(source, 'utf8'));
  await service.close();
});

it('keeps a changed recording selectable at a previously copied path', async () => {
  const { source, service } = await fixture();
  await writeFile(source, 'another recording');
  const { draftId } = unwrap(await service.createDraft({ method: 'files', watch: false }));
  expect(service.items({ draftId }).items[0]?.duplicate).toBe(false);
  await service.close();
});

it('does not hide a changed companion behind an unchanged primary file', async () => {
  const { folder, service } = await fixture('take.mp4', 'take.srt');
  const unchanged = unwrap(await service.createDraft({ method: 'files', watch: false }));
  expect(service.items(unchanged).items[0]?.duplicate).toBe(true);
  await writeFile(join(folder, 'take.srt'), 'new companion metadata');
  const changed = unwrap(await service.createDraft({ method: 'files', watch: false }));
  expect(service.items(changed).items[0]?.duplicate).toBe(false);
  await service.close();
});

it('checks every managed member of a copied capture', async () => {
  const { db, service } = await fixture('take.mp4', 'take.jpg');
  const locations = db.driver.prepare('SELECT absolute_path_cached AS path FROM asset_locations').all();
  expect(locations).toHaveLength(2);
  await rm(String(locations[0]!.path));
  const { draftId } = unwrap(await service.createDraft({ method: 'files', watch: false }));
  expect(service.items({ draftId }).items[0]?.duplicate).toBe(false);
  await service.close();
});

it('checks archived originals before hiding them with Only new', async () => {
  const { db, service } = await fixture('capture.insp');
  const { draftId } = unwrap(await service.createDraft({ method: 'files', watch: false }));
  expect(service.items({ draftId }).items[0]?.duplicate).toBe(true);
  const row = db.driver.prepare('SELECT manifest FROM capture_archives').get()!;
  const archive = JSON.parse(String(row.manifest)) as CaptureArchive;
  await rm(join(archive.directory, archive.members[0]!.name));
  const missing = unwrap(await service.createDraft({ method: 'files', watch: false }));
  expect(service.items(missing).items[0]?.duplicate).toBe(false);
  expect(db.driver.prepare('SELECT COUNT(*) AS n FROM assets').get()?.n).toBe(0);
  await service.close();
});
