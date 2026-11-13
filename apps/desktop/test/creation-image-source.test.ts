// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { InterchangeMediaSourceToken, ok, unwrap, type InterchangeMedia } from '@taalcut/core';
import { createRepositories } from '@taalcut/library';
import { expect, it } from 'vitest';
import { creationSourceHost } from '../src/utility/creation/sources';
import { creationWorld } from './helpers/creation';
import { testConfig } from './helpers/roots';

it('validates library reference images in source research before they reach paid model work', async () => {
  const world = creationWorld();
  const asset = unwrap(
    createRepositories(world.db).assets.create({
      kind: 'image',
      sizeBytes: 3,
      originalFilename: 'brand.webp',
    }),
  );
  const path = join(world.userData, 'brand.webp');
  await writeFile(path, 'img');
  let media: InterchangeMedia = {
    path,
    lastKnownPath: null,
    name: 'brand.webp',
    rate: null,
    durationFrames: null,
    width: 20,
    height: 20,
    hasAudio: false,
    audioChannels: null,
    audioRate: null,
  };
  world.container.value(InterchangeMediaSourceToken, {
    resolve: async () => ok(new Map([[asset.id, media]])),
  });
  const host = creationSourceHost(world.container, testConfig('agent'));
  const captured = unwrap(await host.readAsset(asset.id, new AbortController().signal));
  expect(captured.assets).toEqual([{ assetId: asset.id, mimeType: 'image/webp', label: 'brand.webp' }]);
  media = { ...media, path: join(world.userData, 'brand.heic') };
  expect(await host.readAsset(asset.id, new AbortController().signal)).toMatchObject({
    ok: false,
    error: { code: 'core.validation', params: { field: 'assetId' } },
  });
  media = { ...media, path: null };
  expect((await host.readAsset(asset.id, new AbortController().signal)).ok).toBe(false);
});
