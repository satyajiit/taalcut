// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { newId, productSchema, unwrap, type ProductPublishRecord } from '@taalcut/core';
import { expect, it } from 'vitest';
import { createProductStore, createProductPublishStore, openDatabase } from '../../src';
import { openTestDb, tempDir } from '../helpers';

async function fixture(db: ReturnType<typeof openTestDb>) {
  const product = productSchema.parse({
    id: newId<'Product'>(),
    name: 'Product',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
  });
  unwrap(await createProductStore(db).save(product, 0));
  const record: ProductPublishRecord = {
    id: newId<'ProductPublish'>(),
    batchId: newId<'ProductPublishBatch'>(),
    productId: product.id,
    campaignId: newId<'ProductCampaign'>(),
    campaignRevision: 1,
    revision: 1,
    platform: 'youtube',
    accountId: 'channel',
    provider: 'youtube',
    renderId: newId<'Render'>(),
    mediaHash: 'hash',
    content: 'Accepted feature',
    title: 'Feature',
    tags: [],
    providerSettings: {},
    scheduledAt: '2030-01-01T00:00:00Z',
    timezone: 'UTC',
    status: 'draft',
    approvalHash: null,
    remoteMedia: null,
    remotePostId: null,
    publishedUrl: null,
    retryAt: null,
    errorCode: null,
    createdAt: 1,
    updatedAt: 1,
  };
  return { record, store: createProductPublishStore(db) };
}

it('persists the external-effect reservation across restart and refuses stale transitions', async () => {
  const path = join(tempDir(), 'publication.db');
  const db = unwrap(openDatabase({ path }));
  const { record, store } = await fixture(db);
  unwrap(await store.create([record]));
  const reserved = { ...record, status: 'uploading' as const, revision: 2, updatedAt: 2 };
  unwrap(await store.update(reserved, 1));
  expect((await store.update({ ...reserved, status: 'scheduled' }, 1)).ok).toBe(false);
  unwrap(await store.saveReconcileCursor(record.id));
  db.close();
  const reopened = createProductPublishStore(openTestDb({ path }));
  expect(unwrap(await reopened.readReconcileCursor())).toBe(record.id);
  expect(unwrap(await reopened.list({ afterId: record.id }))).toEqual([]);
  expect(unwrap(await reopened.list({ afterId: null }))).toHaveLength(1);
  expect(unwrap(await reopened.get(record.id))).toEqual(reserved);
  expect(unwrap(await reopened.list({ statuses: ['uploading'] }))).toHaveLength(1);
  expect(unwrap(await reopened.list({ statuses: [] }))).toEqual([]);
});

it('rolls back a batch when any destination conflicts and protects its identity', async () => {
  const { record, store } = await fixture(openTestDb());
  expect((await store.create([record, record])).ok).toBe(false);
  expect(unwrap(await store.get(record.id))).toBeNull();
  unwrap(await store.create([record]));
  expect((await store.update({ ...record, productId: newId<'Product'>(), revision: 2 }, 1)).ok).toBe(false);
  expect((await store.update({ ...record, revision: 3 }, 1)).ok).toBe(false);
});

it('pages all publications in stable ID order across a restart', async () => {
  const path = join(tempDir(), 'publication-pages.db');
  const db = unwrap(openDatabase({ path }));
  const { record, store } = await fixture(db);
  const records = Array.from({ length: 1205 }, () => ({
    ...record,
    id: newId<'ProductPublish'>(),
  }));
  unwrap(await store.create(records));
  const expected = records.map((item) => item.id).sort();
  const first = unwrap(await store.list({ afterId: null, statuses: ['draft'], limit: 100 }));
  expect(first.map((item) => item.id)).toEqual(expected.slice(0, 100));
  unwrap(await store.saveReconcileCursor(first.at(-1)!.id));
  db.close();

  const reopenedDb = openTestDb({ path });
  const reopened = createProductPublishStore(reopenedDb);
  const visited = first.map((item) => item.id);
  let cursor = unwrap(await reopened.readReconcileCursor());
  while (cursor) {
    const page = unwrap(await reopened.list({ afterId: cursor, statuses: ['draft'], limit: 100 }));
    visited.push(...page.map((item) => item.id));
    cursor = page.at(-1)?.id ?? null;
    unwrap(await reopened.saveReconcileCursor(cursor));
  }
  expect(visited).toEqual(expected);
  expect(unwrap(await reopened.readReconcileCursor())).toBeNull();
  reopenedDb.close();
});
