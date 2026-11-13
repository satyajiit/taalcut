// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { implementContract, ipc } from '../ipc/contract';
import { unwrapRpc } from '../ipc/errors';
import {
  productSchema,
  productIdeaSchema,
  productCampaignSchema,
  productKnowledgeSchema,
  type Product,
  type ProductId,
  type ProductIdea,
  type ProductCampaign,
  type ProductKnowledge,
} from './product-schema';
import {
  productScheduleSchema,
  productNotificationSchema,
  type ProductSchedule,
  type ProductNotification,
} from './product-schedule';

export const productGetSchema = z.object({ productId: idSchema<'Product'>() });
export const productListSchema = z.object({
  after: idSchema<'Product'>().optional(),
  limit: z.int().min(1).max(200).default(50),
  archived: z.boolean().default(false),
});
export interface ProductListInput {
  after?: ProductId;
  limit?: number;
  archived?: boolean;
}
const historyInput = productGetSchema.extend({
  before: z.string().optional(),
  limit: z.int().min(1).max(200).optional(),
});
export const productContract = {
  list: ipc
    .input(productListSchema)
    .output(z.object({ items: z.array(productSchema), nextCursor: idSchema<'Product'>().nullable() })),
  get: ipc.input(productGetSchema).output(productSchema),
  ideas: ipc.input(historyInput).output(z.object({ items: z.array(productIdeaSchema) })),
  history: ipc.input(historyInput).output(z.object({ items: z.array(productCampaignSchema) })),
  knowledge: ipc
    .input(
      productGetSchema.extend({
        query: z.string().max(500).optional(),
        after: z.string().optional(),
        limit: z.int().min(1).max(200).optional(),
      }),
    )
    .output(
      z.object({ items: z.array(productKnowledgeSchema), nextCursor: z.string().nullable().optional() }),
    ),
  schedule: ipc.input(productGetSchema).output(z.object({ schedule: productScheduleSchema.nullable() })),
  activity: ipc
    .input(z.object({ productId: idSchema<'Product'>().optional(), unreadOnly: z.boolean().optional() }))
    .output(z.object({ items: z.array(productNotificationSchema) })),
};
export interface ProductService {
  list(input: ProductListInput): AsyncResult<{ items: Product[]; nextCursor: ProductId | null }>;
  get(input: { productId: ProductId }): AsyncResult<Product>;
  ideas(input: {
    productId: ProductId;
    before?: string;
    limit?: number;
  }): AsyncResult<{ items: ProductIdea[] }>;
  history(input: {
    productId: ProductId;
    before?: string;
    limit?: number;
  }): AsyncResult<{ items: ProductCampaign[] }>;
  knowledge(input: {
    productId: ProductId;
    query?: string;
    after?: string;
    limit?: number;
  }): AsyncResult<{ items: ProductKnowledge[]; nextCursor?: string | null }>;
  schedule(input: { productId: ProductId }): AsyncResult<{ schedule: ProductSchedule | null }>;
  activity(input: {
    productId?: ProductId;
    unreadOnly?: boolean;
  }): AsyncResult<{ items: ProductNotification[] }>;
}
export function productRouter(service: ProductService) {
  const os = implementContract(productContract);
  return os.router({
    list: os.list.handler(async ({ input }) => unwrapRpc(await service.list(input))),
    get: os.get.handler(async ({ input }) => unwrapRpc(await service.get(input))),
    ideas: os.ideas.handler(async ({ input }) => unwrapRpc(await service.ideas(input))),
    history: os.history.handler(async ({ input }) => unwrapRpc(await service.history(input))),
    knowledge: os.knowledge.handler(async ({ input }) => unwrapRpc(await service.knowledge(input))),
    schedule: os.schedule.handler(async ({ input }) => unwrapRpc(await service.schedule(input))),
    activity: os.activity.handler(async ({ input }) => unwrapRpc(await service.activity(input))),
  });
}
