// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConversationStoreToken,
  newId,
  ok,
  productSchema,
  unwrap,
  type ProductCampaign,
  type ProductIdea,
  type ProductKnowledge,
} from '@taalcut/core';
import { createProductService } from '@taalcut/agent';
import { createProductStore, LibraryPortsToken } from '@taalcut/library';
import { expect, it } from 'vitest';
import { productCreation, productCreationSources } from '../src/utility/products/creation';
import { productDraftCanProduce, productProduction } from '../src/utility/products/production';
import { creationWorld, draftProject, UI } from './helpers/creation';

async function fixture() {
  const world = creationWorld();
  world.container.value(ConversationStoreToken, world.container.resolve(LibraryPortsToken).conversations);
  const products = createProductStore(world.db);
  const sourceId = newId<'CreationSource'>();
  const product = productSchema.parse({
    id: newId<'Product'>(),
    name: 'Editor',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    sources: [{ id: sourceId, kind: 'directory', accessId: 'opaque-grant', label: 'Repository' }],
  });
  unwrap(await products.save(product, 0));
  const doc: ProductKnowledge = {
    id: newId<'ProductKnowledge'>(),
    productId: product.id,
    sourceId,
    locator: 'README.md',
    title: 'Captions',
    digest: 'stable',
    text: 'Accurate captions.',
    capturedAt: 1,
  };
  unwrap(await products.replaceKnowledge(product.id, sourceId, [doc]));
  async function campaign(projectId = newId<'Project'>()) {
    const idea: ProductIdea = {
      id: newId<'ProductIdea'>(),
      productId: product.id,
      title: 'Caption feature',
      featureKey: 'captions',
      angle: 'Save time',
      hook: 'Cut the typing',
      rationale: '',
      score: 0.9,
      status: 'suggested',
      feedback: null,
      createdAt: 1,
      updatedAt: 1,
      evidence: [
        { sourceId, knowledgeId: doc.id, locator: doc.locator, digest: doc.digest, excerpt: doc.text },
      ],
    };
    unwrap(await products.saveIdeas([idea]));
    const campaign: ProductCampaign = {
      id: newId<'ProductCampaign'>(),
      productId: product.id,
      ideaId: idea.id,
      projectId,
      conversationId: null,
      revision: 1,
      status: 'draft',
      createdAt: 1,
      updatedAt: 1,
    };
    unwrap(await products.reserveCampaign(campaign));
    return { product, idea, campaign, knowledge: [doc] };
  }
  const port = productCreation(world.container, products);
  const service = createProductService({
    store: products,
    creation: port,
    sources: { inspect: async () => ok([]) },
    model: { shortlist: async () => ok([]) },
    nextSchedule: () => ok(2000),
  });
  return { ...world, products, product, campaign, port, service };
}

it('uses snapshots unless live capture is explicitly selected and keeps the same chat after retry', async () => {
  const f = await fixture();
  const input = await f.campaign();
  expect(productCreationSources(input)[0]).toMatchObject({
    status: 'ready',
    content: expect.stringContaining('Accurate captions'),
  });
  input.product.sources[0]!.liveCapture = true;
  expect(productCreationSources(input)[0]?.status).toBe('pending');
  input.product.sources[0]!.liveCapture = false;
  const first = unwrap(await f.port.create(input, new AbortController().signal));
  const retry = unwrap(await f.port.create(input, new AbortController().signal));
  expect(retry).toEqual(first);
  const project = unwrap(await f.store.get(input.campaign.projectId));
  expect(project.brief.category).toBe('custom');
  expect(project.sources[0]?.status).toBe('ready');
  expect(project.status).toBe('researching');
  expect(
    unwrap(await f.container.resolve(ConversationStoreToken).list({ projectId: first.projectId })),
  ).toHaveLength(1);
});

it('starts at most two durable campaign reservations and does not execute a rejected approval', async () => {
  const f = await fixture();
  for (let i = 0; i < 5; i++) await f.campaign();
  const production = productProduction(f.container, f.products, f.service);
  f.bus.register(...production.commands);
  await production.start();
  expect(unwrap(await f.store.list())).toHaveLength(2);
  expect(unwrap(await f.products.pendingCampaigns())).toHaveLength(5);
  const rows = unwrap(await f.products.pendingCampaigns());
  expect(rows.filter((row) => row.conversationId !== null)).toHaveLength(2);
  const denied = await f.bus.dispatch(
    'product.produceApprovedIdea',
    { projectId: rows[0]!.projectId, campaignId: rows[0]!.id, revision: 1 },
    UI,
  );
  expect(denied.ok).toBe(false);
  production.dispose();
  const restored = productProduction(f.container, f.products, f.service);
  await restored.start();
  expect(unwrap(await f.store.list())).toHaveLength(2);
  restored.dispose();
});

it('holds unanswered questions, absent previews and exhausted budgets for review', async () => {
  const world = creationWorld();
  const project = await draftProject(world);
  const base = {
    ...project,
    status: 'awaiting-approval' as const,
    draft: { ...project.draft!, visualPreviewAssetId: newId<'Asset'>(), questions: [] },
  };
  expect(productDraftCanProduce(base)).toBe(true);
  expect(
    productDraftCanProduce({ ...base, budget: { capMicros: 10, spentMicros: 10, reservedMicros: 0 } }),
  ).toBe(false);
  expect(productDraftCanProduce({ ...base, draft: { ...base.draft, visualPreviewAssetId: null } })).toBe(
    false,
  );
  expect(
    productDraftCanProduce({
      ...base,
      draft: { ...base.draft, questions: [{ id: 'price', prompt: 'Price?', required: true, answer: null }] },
    }),
  ).toBe(false);
});
