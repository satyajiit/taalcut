// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  defineCommand,
  err,
  newId,
  NotFoundError,
  ok,
  PERSON_SOURCES,
  PRODUCT_PUBLISH_COMMANDS as C,
  productPublishCommandPayloads as P,
  productPublishingRouter,
  type AnyCommand,
  type Product,
  type ProductId,
  type ProductIdea,
  type ProductCampaign,
  type ProductPublishId,
  type ProductPublishRecord,
  type ProductPlatform,
} from '@taalcut/core';
import type { createMakeFakes } from '../make/fake-make';

interface ProductsView {
  products: ReadonlyMap<ProductId, Product>;
  ideas: ReadonlyMap<ProductId, readonly ProductIdea[]>;
  history: ReadonlyMap<ProductId, readonly ProductCampaign[]>;
}

/** An in-memory preview ledger; it never calls a provider. */
export function createFakeProductPublishing(
  products: ProductsView,
  make: ReturnType<typeof createMakeFakes>,
) {
  const records = new Map<ProductPublishId, ProductPublishRecord>();
  const platforms: ProductPlatform[] = ['youtube', 'instagram', 'x', 'linkedin', 'facebook'];
  const accounts = platforms.map((platform) => ({
    id: `preview-${platform}`,
    name: `Preview ${platform}`,
    platform,
    provider: platform === 'x' ? 'x' : platform,
  }));
  const campaign = (id: string) => [...products.history.values()].flat().find((item) => item.id === id);
  const read = (id: ProductPublishId) => {
    const record = records.get(id);
    return record ? ok(structuredClone(record)) : err(NotFoundError({ entity: 'publication', id }));
  };
  const router = productPublishingRouter({
    async accounts() {
      return ok(accounts);
    },
    async get(id) {
      return read(id);
    },
    async list(input) {
      return ok(
        [...records.values()]
          .filter(
            (item) =>
              (!input?.campaignId || item.campaignId === input.campaignId) &&
              (!input?.statuses || input.statuses.includes(item.status)),
          )
          .reverse()
          .slice(0, input?.limit ?? 1000),
      );
    },
    async prepareMetadata(input) {
      const found = campaign(input.campaignId);
      const product = found ? products.products.get(found.productId) : null;
      const idea = found
        ? products.ideas.get(found.productId)?.find((item) => item.id === found.ideaId)
        : null;
      const render = make.renders.get(input.renderId);
      if (
        !found ||
        !product ||
        !idea ||
        !render ||
        render.projectId !== found.projectId ||
        render.status !== 'ready'
      )
        return err(NotFoundError({ entity: 'publication' }));
      return ok(
        accounts
          .filter((item) => input.accountIds.includes(item.id))
          .map((account) => ({
            productId: product.id,
            campaignId: found.id,
            campaignRevision: found.revision,
            platform: account.platform,
            accountId: account.id,
            provider: account.provider,
            renderId: render.id,
            mediaHash: 'a'.repeat(64),
            content: idea.angle,
            ...(account.platform === 'youtube' ? { title: idea.title } : {}),
            tags: [product.name],
            providerSettings: {},
            scheduledAt: input.scheduledAt,
            timezone: input.timezone,
          })),
      );
    },
  });
  const commands: AnyCommand[] = [
    defineCommand({
      name: C.prepare,
      payload: P[C.prepare],
      sideEffect: 'write',
      handle({ drafts }) {
        const batchId = newId<'ProductPublishBatch'>();
        const result = drafts.map((draft): ProductPublishRecord => ({
          ...draft,
          id: newId<'ProductPublish'>(),
          batchId,
          revision: 1,
          status: 'draft',
          approvalHash: null,
          remoteMedia: null,
          remotePostId: null,
          publishedUrl: null,
          retryAt: null,
          errorCode: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }));
        for (const record of result) records.set(record.id, record);
        return ok({ result });
      },
    }),
    defineCommand({
      name: C.approve,
      payload: P[C.approve],
      sideEffect: 'write',
      sources: PERSON_SOURCES,
      handle(input) {
        const record = read(input.id);
        if (!record.ok) return record;
        if (
          record.value.status !== 'draft' ||
          record.value.revision !== input.expectedRevision ||
          campaign(record.value.campaignId)?.revision !== record.value.campaignRevision
        )
          return err(ConflictError({ entity: 'publication' }));
        const result: ProductPublishRecord = {
          ...record.value,
          revision: record.value.revision + 1,
          status: 'approved',
          approvalHash: 'preview-approval',
        };
        records.set(result.id, result);
        return ok({ result });
      },
    }),
    defineCommand({
      name: C.dispatch,
      payload: P[C.dispatch],
      sideEffect: 'external',
      handle({ id }) {
        const record = read(id);
        if (!record.ok) return record;
        if (record.value.status !== 'approved') return err(ConflictError({ entity: 'publication' }));
        const result: ProductPublishRecord = {
          ...record.value,
          revision: record.value.revision + 1,
          status: 'scheduled',
          remotePostId: `preview:${id}`,
        };
        records.set(id, result);
        return ok({ result });
      },
    }),
    defineCommand({
      name: C.reconcile,
      payload: P[C.reconcile],
      sideEffect: 'external',
      handle({ id }) {
        const result = read(id);
        return result.ok ? ok({ result: result.value }) : result;
      },
    }),
    defineCommand({
      name: C.cancel,
      payload: P[C.cancel],
      sideEffect: 'write',
      handle(input) {
        const record = read(input.id);
        if (!record.ok) return record;
        if (record.value.remotePostId || record.value.revision !== input.expectedRevision)
          return err(ConflictError({ entity: 'publication' }));
        const result: ProductPublishRecord = {
          ...record.value,
          status: 'cancelled',
          revision: input.expectedRevision + 1,
        };
        records.set(input.id, result);
        return ok({ result });
      },
    }),
  ];
  return { router, commands };
}
