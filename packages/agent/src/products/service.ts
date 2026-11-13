// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  err,
  newId,
  NotFoundError,
  ok,
  productInputSchema,
  ValidationError,
  type AsyncResult,
  type CommandContext,
  type Product,
  type ProductCampaign,
  type ProductCampaignId,
  type ProductId,
  type ProductIdea,
  type ProductIdeaId,
  type ProductInput,
  type ProductNotification,
  type ProductOccurrence,
  type ProductScheduleInput,
  type ProductService,
} from '@taalcut/core';
import { ProductArchived } from './errors';
import type { ProductServiceDeps } from './ports';
import { researchProduct } from './research';
import { chooseProductIdea, resumeProductCampaign } from './choose';

export function createProductService(deps: ProductServiceDeps) {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  const researchRuns = new Map<ProductId, AsyncResult<ProductIdea[]>>();
  const choiceRuns = new Map<ProductId, AsyncResult<ProductCampaign>>();
  const productionRuns = new Map<ProductCampaignId, AsyncResult<ProductCampaign>>();
  function resumeCampaign(
    id: ProductCampaignId,
    signal = new AbortController().signal,
  ): AsyncResult<ProductCampaign> {
    const running = productionRuns.get(id);
    if (running) return running;
    const work = resumeProductCampaign(deps, id, signal).finally(() => productionRuns.delete(id));
    productionRuns.set(id, work);
    return work;
  }
  const query: ProductService = {
    async list(input = {}) {
      const limit = input.limit ?? 50;
      const found = await store.list({ ...input, limit: limit + 1 });
      if (!found.ok) return found;
      return ok({
        items: found.value.slice(0, limit),
        nextCursor: found.value.length > limit ? found.value[limit - 1]!.id : null,
      });
    },
    get: ({ productId }) => store.get(productId),
    async ideas({ productId, ...page }) {
      const found = await store.ideas(productId, page);
      return found.ok ? ok({ items: [...found.value] }) : found;
    },
    async history({ productId, ...page }) {
      const found = await store.campaigns(productId, page);
      return found.ok ? ok({ items: [...found.value] }) : found;
    },
    knowledge: ({ productId, ...page }) => store.knowledgePage(productId, page),
    async schedule({ productId }) {
      const found = await store.getSchedule(productId);
      return found.ok ? ok({ schedule: found.value }) : found;
    },
    async activity(input) {
      const found = await store.listNotifications(input);
      return found.ok ? ok({ items: [...found.value] }) : found;
    },
  };
  function research(
    productId: ProductId,
    signal = new AbortController().signal,
    occurrenceId?: ProductOccurrence['id'],
  ): AsyncResult<ProductIdea[]> {
    const running = researchRuns.get(productId);
    if (running)
      return occurrenceId ? running.then(() => research(productId, signal, occurrenceId)) : running;
    const work = (async () => {
      const product = await store.get(productId);
      return product.ok ? researchProduct(deps, product.value, signal, occurrenceId) : product;
    })().finally(() => researchRuns.delete(productId));
    researchRuns.set(productId, work);
    return work;
  }
  async function choose(
    productId: ProductId,
    ideaId: ProductIdeaId,
    signal = new AbortController().signal,
  ): AsyncResult<ProductCampaign> {
    const pending = choiceRuns.get(productId);
    if (pending) {
      await pending;
      return choose(productId, ideaId, signal);
    }
    const work = chooseProductIdea(deps, productId, ideaId, signal).finally(() =>
      choiceRuns.delete(productId),
    );
    choiceRuns.set(productId, work);
    return work;
  }
  return {
    ...query,
    async create(
      input: ProductInput,
      id = newId<'Product'>(),
      context?: CommandContext,
    ): AsyncResult<Product> {
      const parsed = productInputSchema.safeParse(input);
      if (!parsed.success) return err(ValidationError({ field: 'product' }));
      if (context?.replay === 'redo') {
        const existing = await store.get(id);
        if (existing.ok) {
          const restored = {
            ...existing.value,
            revision: existing.value.revision + 1,
            archivedAt: null,
            updatedAt: now(),
          };
          const saved = await store.save(restored, existing.value.revision, context);
          return saved.ok ? ok(restored) : saved;
        }
      }
      const at = now();
      const product: Product = {
        ...parsed.data,
        id,
        revision: 1,
        createdAt: at,
        updatedAt: at,
        archivedAt: null,
      };
      const saved = await store.save(product, 0, context);
      return saved.ok ? ok(product) : saved;
    },
    async update(
      productId: ProductId,
      revision: number,
      input: ProductInput,
      context?: CommandContext,
    ): AsyncResult<Product> {
      const before = await store.get(productId);
      if (!before.ok) return before;
      if (before.value.revision !== revision && context?.replay !== 'redo')
        return err(ConflictError({ entity: 'product', id: productId }));
      const product = { ...before.value, ...input, revision: before.value.revision + 1, updatedAt: now() };
      const saved = await store.save(product, before.value.revision, context);
      return saved.ok ? ok(product) : saved;
    },
    async archive(
      productId: ProductId,
      revision: number,
      archived: boolean,
      context?: CommandContext,
    ): AsyncResult<Product> {
      const before = await store.get(productId);
      if (!before.ok) return before;
      if (before.value.revision !== revision && context?.replay !== 'redo')
        return err(ConflictError({ entity: 'product', id: productId }));
      const product = {
        ...before.value,
        revision: before.value.revision + 1,
        updatedAt: now(),
        archivedAt: archived ? now() : null,
      };
      const saved = await store.save(product, before.value.revision, context);
      return saved.ok ? ok(product) : saved;
    },
    research,
    choose,
    resumeCampaign,
    async reject(productId: ProductId, ideaId: ProductIdeaId, feedback: string, context?: CommandContext) {
      const found = await store.getIdea(ideaId);
      if (!found.ok) return found;
      const idea = found.value;
      if (idea.productId !== productId) return err(NotFoundError({ entity: 'productIdea', id: ideaId }));
      if (idea.status === 'chosen') return err(ConflictError({ entity: 'productIdea', id: ideaId }));
      return store.saveIdea({ ...idea, status: 'rejected', feedback, updatedAt: now() }, context);
    },
    async setSchedule(input: ProductScheduleInput, context?: CommandContext) {
      const product = await store.get(input.productId);
      if (!product.ok) return product;
      if (product.value.archivedAt !== null) return err(ProductArchived());
      const next = input.enabled ? deps.nextSchedule(input, now()) : ok(null);
      if (!next.ok) return next;
      return store.saveSchedule({ ...input, nextRunAt: next.value }, context);
    },
    readNotification: (id: ProductNotification['id'], context?: CommandContext) =>
      store.readNotification(id, now(), context),
    async runScheduled(
      productId: ProductId,
      signal = new AbortController().signal,
      occurrenceId?: ProductOccurrence['id'],
    ): AsyncResult<{ ideas: ProductIdea[]; campaign: ProductCampaign | null }> {
      const restored: ProductIdea[] = [];
      let checkpointed = false;
      if (occurrenceId) {
        const occurrence = await store.getOccurrence(occurrenceId);
        if (!occurrence.ok) return occurrence;
        if (occurrence.value.productId !== productId)
          return err(ConflictError({ entity: 'productOccurrence', id: occurrenceId }));
        checkpointed = occurrence.value.ideaIds !== undefined;
        for (const id of occurrence.value.ideaIds ?? []) {
          const idea = await store.getIdea(id);
          if (!idea.ok) return idea;
          restored.push(idea.value);
        }
      }
      const ideas = checkpointed ? ok(restored) : await research(productId, signal, occurrenceId);
      if (!ideas.ok) return ideas;
      const product = await store.get(productId);
      if (!product.ok) return product;
      if (product.value.preferences.ideaPolicy === 'auto-draft' && ideas.value[0]) {
        const chosen = await choose(productId, ideas.value[0].id, signal);
        if (!chosen.ok) return chosen;
        return ok({ ideas: ideas.value, campaign: chosen.value });
      }
      return ok({ ideas: ideas.value, campaign: null });
    },
  };
}
export type ProductOperations = ReturnType<typeof createProductService>;
