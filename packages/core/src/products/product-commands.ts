// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { productInputSchema } from './product-schema';
import { productScheduleInputSchema } from './product-schedule';

export const PRODUCT_COMMANDS = {
  create: 'product.create',
  update: 'product.update',
  archive: 'product.archive',
  research: 'product.research',
  choose: 'product.choose',
  reject: 'product.reject',
  schedule: 'product.schedule',
  readNotification: 'product.readNotification',
  wake: 'product.wake',
  setBackground: 'product.background.setEnabled',
} as const;
const product = { productId: idSchema<'Product'>() };
export const productCommandPayloads = {
  [PRODUCT_COMMANDS.create]: z.object({
    productId: idSchema<'Product'>().optional(),
    product: productInputSchema,
  }),
  [PRODUCT_COMMANDS.update]: z.object({
    ...product,
    revision: z.int().positive(),
    product: productInputSchema,
  }),
  [PRODUCT_COMMANDS.archive]: z.object({ ...product, revision: z.int().positive(), archived: z.boolean() }),
  [PRODUCT_COMMANDS.research]: z.object(product),
  [PRODUCT_COMMANDS.choose]: z.object({ ...product, ideaId: idSchema<'ProductIdea'>() }),
  [PRODUCT_COMMANDS.reject]: z.object({
    ...product,
    ideaId: idSchema<'ProductIdea'>(),
    feedback: z.string().max(2000).default(''),
  }),
  [PRODUCT_COMMANDS.schedule]: z.object({ schedule: productScheduleInputSchema }),
  [PRODUCT_COMMANDS.readNotification]: z.object({ id: idSchema<'ProductNotification'>() }),
  [PRODUCT_COMMANDS.wake]: z.object({}),
  [PRODUCT_COMMANDS.setBackground]: z.object({ enabled: z.boolean() }),
};
