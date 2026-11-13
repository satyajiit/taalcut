// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  newId,
  ok,
  productSchema,
  type ProductCampaign,
  type ProductIdea,
  type ProductKnowledge,
  type ProductOccurrence,
  type ProductStore,
} from '@taalcut/core';
import { vi } from 'vitest';
import { createProductService, type ProductServiceDeps } from '../../src/products';

export function productFixture() {
  const sourceId = newId<'CreationSource'>();
  const product = productSchema.parse({
    id: newId<'Product'>(),
    name: 'Editor',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    sources: [{ id: sourceId, kind: 'url', label: 'Docs', url: 'https://example.com' }],
  });
  let knowledge: ProductKnowledge[] = [];
  const ideas: ProductIdea[] = [];
  const campaigns: ProductCampaign[] = [];
  const occurrence: ProductOccurrence = {
    id: newId<'ProductOccurrence'>(),
    productId: product.id,
    scheduledFor: 1000,
    state: 'running',
    leaseUntil: 2000,
    detail: null,
    createdAt: 1000,
    updatedAt: 1000,
  };
  const store = {
    // Database reads return snapshots, so later writes cannot change an earlier revision in place.
    get: vi.fn(async () => ok(structuredClone(product))),
    replaceKnowledge: vi.fn(async (_id, _source, docs: readonly ProductKnowledge[]) => {
      knowledge = [...docs];
      return ok(undefined);
    }),
    knowledge: vi.fn(async () => ok(knowledge)),
    knowledgeByIds: vi.fn(async () => ok(knowledge)),
    ideas: vi.fn(async () => ok(ideas)),
    hasRecentFeature: vi.fn(async () => ok(false)),
    saveIdeas: vi.fn(async (next: readonly ProductIdea[], occurrenceId?: ProductOccurrence['id']) => {
      ideas.push(...next);
      if (occurrenceId) occurrence.ideaIds = next.map((idea) => idea.id);
      return ok(undefined);
    }),
    getIdea: vi.fn(async (id: ProductIdea['id']) => ok(ideas.find((idea) => idea.id === id)!)),
    getOccurrence: vi.fn(async () => ok(occurrence)),
    campaigns: vi.fn(async () => ok(campaigns)),
    campaignForIdea: vi.fn(async (id: ProductIdea['id']) =>
      ok(campaigns.find((campaign) => campaign.ideaId === id) ?? null),
    ),
    getCampaign: vi.fn(async (id: ProductCampaign['id']) =>
      ok(campaigns.find((campaign) => campaign.id === id)!),
    ),
    reserveCampaign: vi.fn(async (campaign: ProductCampaign) => {
      const existing = campaigns.find((row) => row.ideaId === campaign.ideaId);
      if (existing) return ok(existing);
      campaigns.push(campaign);
      return ok(campaign);
    }),
    saveCampaign: vi.fn(async (campaign: ProductCampaign) => {
      campaigns[campaigns.findIndex((row) => row.id === campaign.id)] = campaign;
      return ok(undefined);
    }),
    appendNotification: vi.fn(async () => ok(undefined)),
    forProject: vi.fn(async () => ok(product)),
  } satisfies Partial<ProductStore>;
  const deps: ProductServiceDeps = {
    store: store as unknown as ProductStore,
    now: () => 1000,
    nextSchedule: () => ok(2000),
    sources: {
      inspect: vi.fn(async () =>
        ok([
          {
            sourceId,
            locator: 'https://example.com/docs',
            digest: 'hash',
            title: 'Captions',
            text: 'Accurate captions for all clips',
            capturedAt: 1,
          },
        ]),
      ),
    },
    model: {
      shortlist: vi.fn(async (input) =>
        ok([
          {
            title: 'Caption quickly',
            featureKey: 'captions',
            angle: 'Save time captioning a clip',
            hook: 'An hour back',
            rationale: 'Real docs',
            score: 0.9,
            knowledgeIds: [input.knowledge[0]!.id],
          },
        ]),
      ),
    },
    creation: {
      create: vi.fn(async (input) =>
        ok({ projectId: input.campaign.projectId, conversationId: newId<'Conversation'>() }),
      ),
    },
  };
  return { product, ideas, campaigns, occurrence, store, deps, service: createProductService(deps) };
}
