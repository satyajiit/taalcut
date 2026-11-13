// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { newId, ok, unwrap, type ImportSink } from '@taalcut/core';
import { discardPhotosStaging, recoverPhotosOriginal } from '../src/main/imports/photos-recovery';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'taalcut-photos-recovery-')));
  roots.push(root);
  await mkdir(join(root, '.incoming'));
  const path = join(root, '.incoming', newId<'TransferUpload'>());
  const result = { assetId: newId<'Asset'>(), sourceId: newId<'Source'>(), duplicate: 'none' as const };
  const sink: ImportSink = {
    staging: async () => ok({ dir: join(root, '.incoming'), freeBytes: 100000, volumeName: null }),
    importStaged: async () => ok(result),
    knownAssets: async () => ok(new Set([result.assetId])),
  };
  return { root, path, result, sink, bytesWritten: 4 };
}

it('reuses only intact staged or journalled originals and never follows a symlink', async () => {
  const fx = await fixture();
  const target = join(fx.root, 'IMG.MOV');
  await writeFile(target, '1234');
  await writeFile(`${fx.path}.dest`, target);
  expect(unwrap(await recoverPhotosOriginal(fx))).toEqual({ kind: 'staged' });
  await writeFile(fx.path, '12');
  expect(unwrap(await recoverPhotosOriginal(fx))).toEqual({ kind: 'restart' });
  await rm(fx.path);
  await rm(target);
  expect(unwrap(await recoverPhotosOriginal(fx))).toEqual({ kind: 'restart' });
  await writeFile(target, '1234');
  await symlink(target, fx.path);
  expect(unwrap(await recoverPhotosOriginal(fx))).toEqual({ kind: 'restart' });
});

it('requires a known asset for a completion marker and discards only private staging files', async () => {
  const fx = await fixture();
  const original = join(fx.root, 'preserved.MOV');
  await writeFile(original, '1234');
  await writeFile(`${fx.path}.dest`, original);
  await writeFile(`${fx.path}.done.json`, JSON.stringify(fx.result));
  expect(unwrap(await recoverPhotosOriginal(fx))).toEqual({ kind: 'finished', result: fx.result });
  expect(
    unwrap(
      await recoverPhotosOriginal({ ...fx, sink: { ...fx.sink, knownAssets: async () => ok(new Set()) } }),
    ),
  ).toEqual({ kind: 'restart' });
  await discardPhotosStaging(fx.path);
  expect(await readFile(original, 'utf8')).toBe('1234');
});
