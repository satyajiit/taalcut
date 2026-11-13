// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { expect, it } from 'vitest';
import { archiveCapture } from '../../../src/import/local/archive';
import { groupMediaCaptures } from '../../../src/import/local/camera-profiles';
import { inventoryLocalMedia } from '../../../src/import/local/inventory';
import { openTestDb, tempDir } from '../../helpers';

async function plan(path: string) {
  return groupMediaCaptures(unwrap(await inventoryLocalMedia([path])).files)[0]!;
}

it('keeps recordings with reused camera filenames in separate content generations', async () => {
  const db = openTestDb();
  const path = join(tempDir(), 'DJI_0001.MP4');
  const options = { root: tempDir(), sourceKey: 'same-card' };
  await writeFile(path, 'first recording');
  const first = unwrap(await archiveCapture(db, await plan(path), options));
  await writeFile(path, 'later recording with a reused name');
  const later = unwrap(await archiveCapture(db, await plan(path), options));
  expect(later.id).not.toBe(first.id);
  expect(later.directory).not.toBe(first.directory);
  expect(await readFile(join(first.directory, 'DJI_0001.MP4'), 'utf8')).toBe('first recording');
  expect(await readFile(join(later.directory, 'DJI_0001.MP4'), 'utf8')).toBe(
    'later recording with a reused name',
  );
  await writeFile(path, 'first recording');
  expect(unwrap(await archiveCapture(db, await plan(path), options)).id).toBe(first.id);
  expect(db.driver.prepare('SELECT COUNT(*) AS n FROM capture_archives').get()?.n).toBe(2);
});

it('recovers a generation from its durable manifest before its database receipt exists', async () => {
  const db = openTestDb();
  const path = join(tempDir(), 'DJI_0001.MP4');
  await writeFile(path, 'durable recording');
  const options = { root: tempDir(), sourceKey: 'same-card' };
  const first = unwrap(await archiveCapture(db, await plan(path), options));
  db.driver.prepare('DELETE FROM capture_archives WHERE id=?').run(first.id);
  const recovered = unwrap(await archiveCapture(db, await plan(path), options));
  expect(recovered.id).toBe(first.id);
  expect(recovered.directory).toBe(first.directory);
  expect(db.driver.prepare('SELECT id FROM capture_archives').get()?.id).toBe(first.id);
});

it('does not guess which reused recording owns an isolated missing companion', async () => {
  const db = openTestDb();
  const root = tempDir();
  const firstPath = join(root, 'VID_20261105_120000_00_001.insv');
  const secondPath = join(root, 'VID_20261105_120000_10_001.insv');
  const options = { root: tempDir(), sourceKey: 'same-card' };
  const paired = async (path: string) =>
    groupMediaCaptures(
      unwrap(await inventoryLocalMedia([path])).files.map((file) => ({
        ...file,
        evidence: { model: 'Insta360 X3' },
      })),
    )[0]!;
  await writeFile(firstPath, 'first lens of old recording');
  const first = unwrap(await archiveCapture(db, await paired(firstPath), options));
  await writeFile(firstPath, 'first lens of new recording');
  const later = unwrap(await archiveCapture(db, await paired(firstPath), options));
  await writeFile(secondPath, 'unidentified second lens');
  const isolated = unwrap(await archiveCapture(db, await paired(secondPath), options));
  expect(isolated.id).not.toBe(first.id);
  expect(isolated.id).not.toBe(later.id);
  expect(isolated.completeness).toBe('incomplete');
  expect(first.members).toHaveLength(1);
  expect(later.members).toHaveLength(1);
});
