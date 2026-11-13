// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFile, writeFile, symlink, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unwrap } from '@taalcut/core';
import { tempDir, openTestDb } from '../../helpers';
import { inventoryLocalMedia } from '../../../src/import/local/inventory';
import { copySelectedOriginal } from '../../../src/import/local/verified-copy';
import { groupMediaCaptures, type CaptureFile } from '../../../src/import/local/camera-profiles';
import { archiveCapture } from '../../../src/import/local/archive';
import { createImportSpaceCoordinator } from '../../../src/import/local/space';
import { createImportReaderRegistry } from '../../../src/import/local/readers';
import { captureArchives } from '../../../src/migrations/0044-capture-archives';

function database() {
  const db = openTestDb();
  if (!db.driver.prepare("SELECT name FROM sqlite_master WHERE name = 'capture_archives'").get())
    db.driver.exec(captureArchives.up);
  return db;
}

async function file(name = 'take.mp4', bytes = 'the original'): Promise<CaptureFile> {
  const path = join(tempDir(), name);
  await writeFile(path, bytes);
  const info = await stat(path);
  return { key: path, path, name, sizeBytes: info.size, modifiedAt: info.mtimeMs, fileId: info.ino };
}

const camera = (name: string, evidence?: CaptureFile['evidence']): CaptureFile => ({
  key: name,
  name,
  path: `/card/DCIM/${name}`,
  sizeBytes: 40,
  modifiedAt: 0,
  fileId: 1,
  ...(evidence ? { evidence } : {}),
});

describe('local original copy', () => {
  it('copies verified bytes without changing or removing the source', async () => {
    const original = await file();
    const target = join(tempDir(), 'staged');
    const progress: string[] = [];
    const result = unwrap(
      await copySelectedOriginal(original, target, { progress: (event) => progress.push(event.stage) }),
    );
    expect(result.bytes).toBe(original.sizeBytes);
    expect(await readFile(target)).toEqual(await readFile(original.path));
    expect(progress).toEqual(['copying', 'verifying']);
    expect((await stat(original.path)).mtimeMs).toBe(original.modifiedAt);
  });
  it('rejects changed selections and symlink replacements', async () => {
    const original = await file();
    await writeFile(original.path, 'changed');
    const target = join(tempDir(), 'staged');
    expect(await copySelectedOriginal(original, target)).toMatchObject({
      ok: false,
      error: { code: 'library.import_source_changed' },
    });
    const link = join(tempDir(), 'link.mp4');
    await symlink(original.path, link);
    expect(unwrap(await inventoryLocalMedia([link])).files).toEqual([]);
    expect(unwrap(await inventoryLocalMedia([link])).skipped[0]?.reason).toBe('symlink');
  });
  it('drops partial staging on cancellation and leaves originals intact', async () => {
    const original = await file('take.mp4', 'x'.repeat(2 * 1024 * 1024));
    const target = join(tempDir(), 'staged');
    const control = new AbortController();
    const result = await copySelectedOriginal(original, target, {
      signal: control.signal,
      progress: () => control.abort(),
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await stat(original.path)).size).toBe(original.sizeBytes);
  });
});

describe('camera evidence and preservation', () => {
  it('requires both older lens originals, but not an optional preview', () => {
    const plans = groupMediaCaptures([
      camera('VID_20261105_120000_00_001.insv', { model: 'Insta360 X3' }),
      camera('LRV_20261105_120000_01_001.lrv'),
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      disposition: 'archive',
      completeness: 'incomplete',
      missingNames: ['VID_20261105_120000_10_001.insv'],
      optionalNames: ['LRV_20261105_120000_01_001.lrv'],
    });
  });
  it('accepts a proven multitrack original and keeps ambiguous layouts unverified', () => {
    const name = 'VID_20261105_120000_00_001.insv';
    expect(groupMediaCaptures([camera(name, { videoTracks: 2 })])[0]?.completeness).toBe('complete');
    expect(groupMediaCaptures([camera(name)])[0]?.completeness).toBe('unknown');
    expect(groupMediaCaptures([camera('DJI_001.mp4')])[0]?.disposition).toBe('asset');
  });
  it('repairs missing members while preserving names and excluding raw archives from indexing', async () => {
    const db = database();
    const first = await file('VID_20261105_120000_00_001.insv');
    const second = { ...(await file('VID_20261105_120000_10_001.insv', 'other lens')) };
    const firstPlan = groupMediaCaptures([{ ...first, evidence: { model: 'Insta360 X3' } }])[0]!;
    const options = { root: tempDir(), sourceKey: 'card-uuid' };
    const before = unwrap(await archiveCapture(db, firstPlan, options));
    expect(before.completeness).toBe('incomplete');
    const repaired = unwrap(
      await archiveCapture(
        db,
        { ...firstPlan, files: [second], missingNames: [], completeness: 'complete' },
        options,
      ),
    );
    expect(repaired.id).toBe(before.id);
    expect(repaired.completeness).toBe('complete');
    expect(repaired.members.map((member) => member.name)).toEqual([first.name, second.name]);
    expect(await readFile(join(repaired.directory, first.name), 'utf8')).toBe('the original');
    expect(db.driver.prepare('SELECT COUNT(*) AS n FROM assets').get()?.['n']).toBe(0);
    expect(db.driver.prepare('SELECT COUNT(*) AS n FROM asset_index_stages').get()?.['n']).toBe(0);
    await rm(join(repaired.directory, first.name));
    const missing = unwrap(
      await archiveCapture(
        db,
        { ...firstPlan, files: [second], missingNames: [], completeness: 'complete' },
        options,
      ),
    );
    expect(missing.completeness).toBe('incomplete');
    expect(missing.missingNames).toEqual([first.name]);
    await writeFile(join(repaired.directory, second.name), 'corrupted saved lens');
    expect(await archiveCapture(db, firstPlan, options)).toMatchObject({
      ok: false,
      error: { code: 'library.import_verification_failed' },
    });
  });
});

it('coordinates simultaneous reservations and incremental writes', async () => {
  const db = database();
  const options = { freeBytes: () => 100, bufferBytes: 0 };
  const first = createImportSpaceCoordinator(db, options);
  const second = createImportSpaceCoordinator(db, options);
  const results = await Promise.all([first.reserve('a', 'v', '/', 70), second.reserve('b', 'v', '/', 70)]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(first.reserved('v')).toBe(70);
  first.consume('a', 40);
  expect((await second.reserve('b', 'v', '/', 70)).ok).toBe(true);
  first.release('a');
  second.release('b');
  expect(first.reserved('v')).toBe(0);
});

it('refuses eject until every participating reader releases the volume', async () => {
  const db = database();
  const registry = createImportReaderRegistry(db);
  const otherProcess = createImportReaderRegistry(db, 23456);
  const release = unwrap(registry.acquire('preview', 'card'));
  let ejected = false;
  const eject = async () => {
    expect(otherProcess.acquire('late-preview', 'card')).toMatchObject({
      ok: false,
      error: { code: 'library.import_volume_busy' },
    });
    ejected = true;
    return { ok: true as const, value: undefined };
  };
  expect(await registry.eject('card', eject)).toMatchObject({
    ok: false,
    error: { code: 'library.import_volume_busy' },
  });
  expect(ejected).toBe(false);
  release();
  expect((await registry.eject('card', eject)).ok).toBe(true);
});

it('guards every sibling volume for a whole disk eject', async () => {
  const registry = createImportReaderRegistry(database());
  const release = unwrap(registry.acquire('copy-on-second-partition', 'second'));
  let calls = 0;
  const eject = async () => {
    calls += 1;
    expect(registry.acquire('late-reader', 'second').ok).toBe(false);
    expect(registry.acquire('late-reader', 'first').ok).toBe(false);
    return { ok: true as const, value: undefined };
  };
  expect((await registry.ejectVolumes(['first', 'second'], eject)).ok).toBe(false);
  expect(calls).toBe(0);
  release();
  expect((await registry.ejectVolumes(['first', 'second'], eject)).ok).toBe(true);
  expect(calls).toBe(1);
});

it('holds eject during PhotoKit reads whose source volume is opaque', async () => {
  const registry = createImportReaderRegistry(database());
  const release = unwrap(registry.acquire('photos-original', '*'));
  const eject = async () => {
    expect(registry.acquire('photos-thumbnail', '*').ok).toBe(false);
    return { ok: true as const, value: undefined };
  };
  expect((await registry.eject('external', eject)).ok).toBe(false);
  release();
  expect((await registry.eject('external', eject)).ok).toBe(true);
});
