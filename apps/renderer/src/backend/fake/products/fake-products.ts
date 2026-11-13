// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- preview fixtures, not application copy */

import {
  ConflictError,
  CREATION_COMMANDS,
  defineCommand,
  err,
  implementContract,
  newId,
  NotFoundError,
  ok,
  PRODUCT_COMMANDS as C,
  productBackgroundContract,
  productCommandPayloads as P,
  productRouter,
  type AnyCommand,
  type Product,
  type ProductCampaign,
  type ProductId,
  type ProductIdea,
  type ProductKnowledge,
  type ProductSchedule,
} from '@taalcut/core';
import type { createFakeCreation } from '../creation/fake-creation';
import { PRODUCT_DEMO, productDemo } from './product-fixtures';
import { createFakeProductPublishing } from './fake-publishing';
import type { FakeMake } from '../make/fake-make';

export function createFakeProducts(creation: ReturnType<typeof createFakeCreation>) {
  const products = new Map<ProductId, Product>([[PRODUCT_DEMO, productDemo()]]);
  const ideas = new Map<ProductId, ProductIdea[]>();
  const history = new Map<ProductId, ProductCampaign[]>();
  const knowledge = new Map<ProductId, ProductKnowledge[]>();
  const schedules = new Map<ProductId, ProductSchedule>();
  let enabled = false;
  const read = (id: ProductId) => {
    const product = products.get(id);
    return product ? ok(structuredClone(product)) : err(NotFoundError({ entity: 'product', id }));
  };
  const router = productRouter({
    async list(input) {
      const rows = [...products.values()]
        .filter(
          (item) =>
            item.id !== PRODUCT_DEMO &&
            !!item.archivedAt === !!input.archived &&
            (!input.after || item.id > input.after),
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      const items = rows.slice(0, input.limit ?? 50);
      return ok({ items, nextCursor: rows.length > items.length ? items.at(-1)!.id : null });
    },
    async get({ productId }) {
      return read(productId);
    },
    async ideas({ productId }) {
      return ok({ items: ideas.get(productId) ?? [] });
    },
    async history({ productId }) {
      return ok({ items: history.get(productId) ?? [] });
    },
    async knowledge({ productId, query, after, limit = 50 }) {
      const rows = (knowledge.get(productId) ?? [])
        .filter(
          (item) =>
            (!after || item.id > after) && (!query || item.text.toLowerCase().includes(query.toLowerCase())),
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      return ok({
        items: rows.slice(0, limit),
        nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
      });
    },
    async schedule({ productId }) {
      return ok({ schedule: schedules.get(productId) ?? null });
    },
    async activity() {
      return ok({ items: [] });
    },
  });
  const commands: AnyCommand[] = [
    defineCommand({
      name: C.create,
      payload: P[C.create],
      sideEffect: 'write',
      handle({ productId, product }) {
        const id = productId ?? newId<'Product'>();
        if (products.has(id)) return err(ConflictError({ entity: 'product', id }));
        const value: Product = {
          ...product,
          id,
          revision: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          archivedAt: null,
        };
        products.set(id, value);
        return ok({ result: value });
      },
    }),
    defineCommand({
      name: C.update,
      payload: P[C.update],
      sideEffect: 'write',
      handle(input) {
        const before = read(input.productId);
        if (!before.ok) return before;
        if (before.value.revision !== input.revision) return err(ConflictError({ entity: 'product' }));
        const value = {
          ...before.value,
          ...input.product,
          revision: input.revision + 1,
          updatedAt: Date.now(),
        };
        products.set(input.productId, value);
        return ok({ result: value });
      },
    }),
    defineCommand({
      name: C.archive,
      payload: P[C.archive],
      sideEffect: 'write',
      handle(input) {
        const before = read(input.productId);
        if (!before.ok) return before;
        if (before.value.revision !== input.revision) return err(ConflictError({ entity: 'product' }));
        const value = {
          ...before.value,
          archivedAt: input.archived ? Date.now() : null,
          revision: input.revision + 1,
        };
        products.set(input.productId, value);
        return ok({ result: value });
      },
    }),
    defineCommand({
      name: C.research,
      payload: P[C.research],
      sideEffect: 'write',
      handle({ productId }) {
        const found = read(productId);
        if (!found.ok) return found;
        const product = found.value;
        const source = product.sources[0];
        if (!source) return ok({ result: [] });
        const document: ProductKnowledge = {
          id: newId<'ProductKnowledge'>(),
          productId,
          sourceId: source.id,
          title: product.name,
          locator: source.url ?? source.label,
          digest: 'preview-source-v1',
          text: product.description || `Verified product overview for ${product.name}.`,
          capturedAt: Date.now(),
        };
        knowledge.set(productId, [document]);
        const prior = ideas.get(productId) ?? [];
        if (!prior.length)
          ideas.set(productId, [
            {
              id: newId<'ProductIdea'>(),
              productId,
              title: `${product.name}: one useful workflow`,
              featureKey: 'first-workflow',
              angle: 'Show the result before the steps.',
              hook: 'From an idea to a finished result.',
              rationale: 'This introduces a concrete benefit not covered in your video history.',
              score: 0.9,
              evidence: [
                {
                  knowledgeId: document.id,
                  sourceId: source.id,
                  locator: document.locator,
                  digest: document.digest,
                  excerpt: document.text,
                },
              ],
              status: 'suggested',
              feedback: null,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ]);
        return ok({ result: ideas.get(productId) ?? [] });
      },
    }),
    defineCommand({
      name: C.choose,
      payload: P[C.choose],
      sideEffect: 'write',
      async handle(input, context) {
        const found = read(input.productId);
        if (!found.ok) return found;
        const idea = ideas.get(input.productId)?.find((item) => item.id === input.ideaId);
        if (!idea) return err(NotFoundError({ entity: 'idea', id: input.ideaId }));
        const prior = history.get(input.productId)?.find((item) => item.ideaId === input.ideaId);
        if (prior) return ok({ result: prior });
        const product = found.value;
        const projectId = newId<'Project'>();
        const create = creation.commands.find((command) => command.name === CREATION_COMMANDS.create)!;
        const made = await create.handle(
          {
            projectId,
            brief: {
              category: 'custom',
              title: idea.title,
              prompt: `${idea.hook}\n${idea.angle}`,
              audience: product.preferences.audience,
              callToAction: product.preferences.callToAction,
              formats: product.preferences.formats,
              duration: product.preferences.duration,
              voice: product.preferences.voice,
            },
          },
          context,
        );
        if (!made.ok) return made;
        const campaign: ProductCampaign = {
          id: newId<'ProductCampaign'>(),
          productId: input.productId,
          ideaId: idea.id,
          projectId,
          conversationId: null,
          revision: 1,
          status: 'draft',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        history.set(input.productId, [...(history.get(input.productId) ?? []), campaign]);
        idea.status = 'chosen';
        return ok({ result: campaign });
      },
    }),
    defineCommand({
      name: C.reject,
      payload: P[C.reject],
      sideEffect: 'write',
      handle(input) {
        const idea = ideas.get(input.productId)?.find((item) => item.id === input.ideaId);
        if (idea) {
          idea.status = 'rejected';
          idea.feedback = input.feedback;
        }
        return ok({ result: null });
      },
    }),
    defineCommand({
      name: C.schedule,
      payload: P[C.schedule],
      sideEffect: 'write',
      handle({ schedule }) {
        schedules.set(schedule.productId, {
          ...schedule,
          revision: schedule.revision + 1,
          nextRunAt: schedule.enabled ? Date.now() + 86_400_000 : null,
        });
        return ok({ result: null });
      },
    }),
    defineCommand({
      name: C.setBackground,
      payload: P[C.setBackground],
      sideEffect: 'write',
      handle(input) {
        enabled = input.enabled;
        return ok({ result: null });
      },
    }),
    defineCommand({
      name: C.readNotification,
      payload: P[C.readNotification],
      sideEffect: 'write',
      handle() {
        return ok({ result: null });
      },
    }),
  ];
  const os = implementContract(productBackgroundContract);
  return {
    router,
    commands,
    state: { products, ideas, history },
    background: os.router({
      status: os.status.handler(() => ({
        enabled,
        supported: true,
        registration: enabled ? 'enabled' : 'disabled',
        detail: null,
      })),
    }),
  };
}

/** The product preview composes one local state for research and publishing. */
export function productFakes(creation: ReturnType<typeof createFakeCreation>, make: FakeMake) {
  const products = createFakeProducts(creation);
  const publishing = createFakeProductPublishing(products.state, make);
  return {
    ...products,
    commands: [...products.commands, ...publishing.commands],
    publishing: publishing.router,
  };
}
