// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { coverSettingsSchema, unwrap } from '@taalcut/core';
import { expect, it } from 'vitest';
import { createTimelineStore } from '../../src/index';
import { openTestDb } from '../helpers';
import { seed, timeline } from './documents';

it('a saved cover image is a durable timeline reference even when it is absent from every track', async () => {
  const db = openTestDb({ file: false });
  const store = createTimelineStore(db);
  const { project, assets, repos } = seed(db);
  const image = unwrap(
    repos.assets.create({ kind: 'image', sizeBytes: 5, originalFilename: 'cover.jpg' }),
  ).id;
  const doc = timeline(project.id, assets);
  doc.covers = [coverSettingsSchema.parse({ aspect: '1:1', source: { kind: 'asset', assetId: image } })];
  unwrap(await store.create(doc));
  const refs = db.driver
    .prepare('SELECT asset_id FROM timeline_asset_refs WHERE timeline_id = ?')
    .all(doc.id)
    .map((row) => row.asset_id);
  expect(refs).toContain(image);
  expect(repos.assets.remove(image).ok).toBe(false);
  const { covers: _covers, ...cleared } = doc;
  unwrap(await store.put({ ...cleared, revision: 2 }, 1));
  expect(repos.assets.remove(image).ok).toBe(true);
  db.close();
});
