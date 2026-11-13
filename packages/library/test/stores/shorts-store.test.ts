// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { newId, RationalTime, unwrap, type ShortsRun } from '@taalcut/core';
import { expect, it } from 'vitest';
import { createRepositories, createShortsCache, createShortsRunStore, openDatabase } from '../../src';
import { openTestDb, tempDir } from '../helpers';

function run(projectId: ShortsRun['request']['projectId']): ShortsRun {
  return {
    id: newId<'ShortsRun'>(),
    request: {
      projectId,
      assetId: newId<'Asset'>(),
      duration: RationalTime.of(60, { num: 1, den: 1 }),
      platforms: ['reels'],
    },
    status: 'running',
    stage: 'verifying',
    candidates: [],
    issues: [],
    createdAt: 10,
    updatedAt: 20,
  };
}

it('persists run checkpoints and recomputable evidence across reopening', async () => {
  const path = join(tempDir(), 'shorts.db');
  const db = unwrap(openDatabase({ path }));
  const project = unwrap(createRepositories(db).projects.create({ name: 'Shorts' }));
  const document = run(project.id);
  unwrap(await createShortsRunStore(db).put(document));
  unwrap(
    await createShortsCache(db).put('source:recipe:model', { summary: 'Source evidence', windows: [0, 1] }),
  );
  db.close();
  const reopened = openTestDb({ path });
  expect(unwrap(await createShortsRunStore(reopened).get(document.id))).toEqual(document);
  expect(unwrap(await createShortsRunStore(reopened).list(project.id))).toEqual([document]);
  expect(unwrap(await createShortsCache(reopened).get('source:recipe:model'))).toMatchObject({
    windows: [0, 1],
  });
});

it('rejects stale/cross-project checkpoints and removes runs with their project', async () => {
  const db = openTestDb();
  const projects = createRepositories(db).projects;
  const project = unwrap(projects.create({ name: 'Creator' }));
  const other = unwrap(projects.create({ name: 'Other' }));
  const document = run(project.id);
  const store = createShortsRunStore(db);
  unwrap(await store.put(document));
  expect((await store.put({ ...document, updatedAt: 19 })).ok).toBe(false);
  expect((await store.put({ ...document, request: { ...document.request, projectId: other.id } })).ok).toBe(
    false,
  );
  unwrap(projects.remove(project.id));
  expect(unwrap(await store.get(document.id))).toBeNull();
});

it('bounds cache entries and rejects non-JSON values', async () => {
  const cache = createShortsCache(openTestDb());
  expect((await cache.put('x', undefined)).ok).toBe(false);
  expect((await cache.put('x', 'x'.repeat(2_000_000))).ok).toBe(false);
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  expect((await cache.put('x', cyclic)).ok).toBe(false);
  expect(unwrap(await cache.get('missing'))).toBeNull();
});
