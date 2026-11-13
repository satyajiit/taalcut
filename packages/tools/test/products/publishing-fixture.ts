// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  err,
  newId,
  ok,
  type PluginInvoke,
  type AsyncResult,
  type ProductPublishRecord,
  type ProductPublishStore,
} from '@taalcut/core';
import { vi } from 'vitest';
import { createProductPublisher } from '../../src/products/publishing';
import type { ProductPublishDraft } from '../../src/products/publishing-types';

export function publishDraft(overrides: Partial<ProductPublishDraft> = {}): ProductPublishDraft {
  return {
    productId: newId<'Product'>(),
    campaignId: newId<'ProductCampaign'>(),
    campaignRevision: 1,
    platform: 'youtube',
    accountId: 'channel-one',
    provider: 'youtube',
    renderId: newId<'Render'>(),
    mediaHash: 'a'.repeat(64),
    content: 'A real product feature.',
    title: 'Product feature',
    tags: ['product'],
    providerSettings: {},
    scheduledAt: '2030-01-01T12:00:00Z',
    timezone: 'Asia/Kolkata',
    ...overrides,
  };
}

export function publisherWorld() {
  const records = new Map<string, ProductPublishRecord>();
  const store: ProductPublishStore = {
    readReconcileCursor: async () => ok(null),
    saveReconcileCursor: async () => ok(undefined),
    async get(id) {
      return ok(structuredClone(records.get(id) ?? null));
    },
    async list(input = {}) {
      return ok(
        [...records.values()]
          .filter(
            (record) =>
              (!input.campaignId || record.campaignId === input.campaignId) &&
              (!input.statuses || input.statuses.includes(record.status)),
          )
          .map((record) => structuredClone(record)),
      );
    },
    async create(rows) {
      rows.forEach((row) => records.set(row.id, structuredClone(row)));
      return ok(undefined);
    },
    async update(record, revision) {
      if (records.get(record.id)?.revision !== revision)
        return err(ConflictError({ entity: 'publication', id: record.id }));
      records.set(record.id, structuredClone(record));
      return ok(undefined);
    },
  };
  const invoke = vi.fn(async (input: PluginInvoke): AsyncResult<unknown> => {
    if (input.toolName === 'api.getIntegrationSettings') return ok({ output: { maxLength: 5000 } });
    if (input.toolName === 'api.uploadFile')
      return ok({ id: 'media-one', path: 'https://media.example/video.mp4' });
    if (input.toolName === 'api.createPost')
      return ok([{ postId: 'remote-one', integration: 'channel-one' }]);
    if (input.toolName === 'api.listPosts') return ok({ posts: [] });
    return ok([{ id: 'channel-one', name: 'Channel', identifier: 'youtube' }]);
  });
  const campaignRevision = vi.fn(async () => ok(1));
  const verifyRender = vi.fn(async () => ok(true));
  let time = Date.parse('2029-01-01T12:00:00Z');
  const deps = { store, plugins: { invoke }, campaignRevision, verifyRender, now: () => time };
  return {
    records,
    store,
    invoke,
    campaignRevision,
    verifyRender,
    deps,
    advance: (ms: number) => {
      time += ms;
    },
    publisher: createProductPublisher(deps),
  };
}
