// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  newId,
  productSchema,
  unwrap,
  type ProductCampaign,
  type ProductIdea,
  type ProductKnowledge,
} from '@taalcut/core';
import { expect, it } from 'vitest';
import { createProductStore } from '../../src';
import { openTestDb } from '../helpers';

async function fixture() {
  const db = openTestDb({ file: false });
  const store = createProductStore(db);
  const sourceId = newId<'CreationSource'>();
  const product = productSchema.parse({
    id: newId<'Product'>(),
    name: 'Editor',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    sources: [{ id: sourceId, kind: 'url', label: 'Docs', url: 'https://example.com', purpose: 'website' }],
  });
  unwrap(await store.save(product, 0));
  const doc: ProductKnowledge = {
    id: newId<'ProductKnowledge'>(),
    productId: product.id,
    sourceId,
    locator: 'https://example.com/feature',
    digest: 'digest',
    title: 'Captions',
    text: 'Accurate captions',
    capturedAt: 1,
  };
  const idea: ProductIdea = {
    id: newId<'ProductIdea'>(),
    productId: product.id,
    title: 'Caption faster',
    featureKey: 'captions',
    angle: 'Cut repetitive caption work',
    hook: 'Save an hour',
    rationale: 'Evidence',
    score: 0.8,
    evidence: [
      { knowledgeId: doc.id, sourceId, locator: doc.locator, digest: doc.digest, excerpt: doc.text },
    ],
    status: 'suggested',
    feedback: null,
    createdAt: 1,
    updatedAt: 1,
  };
  const campaign: ProductCampaign = {
    id: newId<'ProductCampaign'>(),
    productId: product.id,
    ideaId: idea.id,
    projectId: newId<'Project'>(),
    conversationId: null,
    revision: 1,
    status: 'draft',
    createdAt: 1,
    updatedAt: 1,
  };
  return { db, store, product, sourceId, doc, idea, campaign };
}

it('refreshes source provenance without invalidating unchanged evidence and removes detached knowledge', async () => {
  const { store, product, sourceId, doc } = await fixture();
  unwrap(await store.replaceKnowledge(product.id, sourceId, [doc]));
  unwrap(
    await store.replaceKnowledge(product.id, sourceId, [
      { ...doc, id: newId<'ProductKnowledge'>(), capturedAt: 2 },
    ]),
  );
  expect(unwrap(await store.knowledge(product.id))[0]).toMatchObject({ id: doc.id, capturedAt: 2 });
  const changed = { ...doc, id: newId<'ProductKnowledge'>(), digest: 'new' };
  unwrap(await store.replaceKnowledge(product.id, sourceId, [changed]));
  expect(unwrap(await store.knowledge(product.id, 'Accurate'))[0]?.id).toBe(changed.id);
  expect(unwrap(await store.knowledge(product.id, '%'))).toEqual([]);
  expect((await store.replaceKnowledge(product.id, newId<'CreationSource'>(), [doc])).ok).toBe(false);
  unwrap(await store.save({ ...product, sources: [], revision: 2 }, 1));
  expect(unwrap(await store.knowledge(product.id))).toEqual([]);
  expect((await store.save({ ...product, revision: 2 }, 1)).ok).toBe(false);
});

it('reserves exactly one campaign for an idea and protects chosen history from stale edits', async () => {
  const { store, product, idea, campaign } = await fixture();
  unwrap(await store.saveIdeas([idea]));
  const [first, retry] = await Promise.all([
    store.reserveCampaign(campaign),
    store.reserveCampaign({ ...campaign, id: newId<'ProductCampaign'>() }),
  ]);
  expect(unwrap(first)).toEqual(unwrap(retry));
  expect(unwrap(await store.campaignForIdea(idea.id))?.id).toBe(campaign.id);
  expect(unwrap(await store.getIdea(idea.id)).status).toBe('chosen');
  expect((await store.saveIdea({ ...idea, status: 'rejected' })).ok).toBe(false);
  expect(unwrap(await store.forProject(campaign.projectId))?.id).toBe(product.id);
  unwrap(await store.saveCampaign({ ...campaign, revision: 2, status: 'ready' }, 1));
  expect((await store.saveCampaign({ ...campaign, revision: 2 }, 1)).ok).toBe(false);
  expect(unwrap(await store.getCampaign(campaign.id)).status).toBe('ready');
  expect(unwrap(await store.campaigns(product.id, { before: campaign.id }))).toEqual([]);
});

it('claims a due occurrence atomically, survives expiry, and coalesces missed dates', async () => {
  const { store, product } = await fixture();
  const schedule = {
    productId: product.id,
    revision: 1,
    enabled: true,
    timeZone: 'UTC',
    localTime: '09:00',
    weekdays: [1],
    nextRunAt: 100,
  };
  unwrap(await store.saveSchedule(schedule));
  const input = { productId: product.id, scheduledFor: 100, now: 1000, leaseUntil: 2000, nextRunAt: 5000 };
  const first = unwrap(await store.claimOccurrence(input));
  expect(first).not.toBeNull();
  expect(unwrap(await store.claimOccurrence(input))).toBeNull();
  expect(unwrap(await store.listDue(1000))).toEqual([]);
  expect(unwrap(await store.getSchedule(product.id))).toMatchObject({ revision: 2, nextRunAt: 5000 });
  expect(unwrap(await store.expiredOccurrences(2000))).toHaveLength(1);
  const recovered = unwrap(await store.claimOccurrence({ ...input, now: 2000, leaseUntil: 3000 }));
  expect(recovered?.id).toBe(first?.id);
  unwrap(await store.settleOccurrence(first!.id, { state: 'completed' }));
  expect(unwrap(await store.claimOccurrence({ ...input, now: 3000, leaseUntil: 4000 }))).toBeNull();
  expect((await store.saveSchedule(schedule)).ok).toBe(false);
  unwrap(await store.save({ ...product, revision: 2, archivedAt: 4000 }, 1));
  expect(unwrap(await store.listDue(6000))).toEqual([]);
  expect(unwrap(await store.listSchedules())).toEqual([]);
});

it('paginates 100,000 products without loading or imposing a fixed catalogue cap', async () => {
  const { db, store, product } = await fixture();
  db.driver
    .prepare(
      `WITH RECURSIVE counter(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM counter WHERE n<100000)
    INSERT INTO products(id,revision,archived_at,updated_at,body_json)
    SELECT printf('%026d',n),1,NULL,1,json_set(?, '$.id',printf('%026d',n)) FROM counter`,
    )
    .run(JSON.stringify(product));
  const first = unwrap(await store.list({ limit: 2 }));
  const second = unwrap(await store.list({ after: first[1]!.id, limit: 2 }));
  expect(first).toHaveLength(2);
  expect(second[0]!.id > first[1]!.id).toBe(true);
  expect(db.driver.prepare('SELECT count(*) AS n FROM products').get()?.['n']).toBe(100001);
});
