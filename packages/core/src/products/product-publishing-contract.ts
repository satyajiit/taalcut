// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { implementContract, ipc } from '../ipc/contract';
import { unwrapRpc } from '../ipc/errors';
import { productPlatformSchema } from './product-schema';
import {
  productPublishRecordSchema,
  PRODUCT_PUBLISH_STATUSES,
  type ProductPublishId,
  type ProductPublishRecord,
  type ProductPublishStore,
} from './product-publishing';

export const productPublishDraftSchema = productPublishRecordSchema.pick({
  productId: true,
  campaignId: true,
  campaignRevision: true,
  platform: true,
  accountId: true,
  provider: true,
  renderId: true,
  mediaHash: true,
  content: true,
  title: true,
  tags: true,
  providerSettings: true,
  scheduledAt: true,
  timezone: true,
});
export const productPublishingAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  platform: productPlatformSchema,
});
const publication = z.object({ id: idSchema<'ProductPublish'>() });
export const productMetadataRequestSchema = z.object({
  campaignId: idSchema<'ProductCampaign'>(),
  renderId: idSchema<'Render'>(),
  accountIds: z.array(z.string().min(1).max(500)).min(1).max(20),
  scheduledAt: z.iso.datetime({ offset: true }),
  timezone: z.string().min(1).max(100),
});
export type ProductMetadataRequest = z.output<typeof productMetadataRequestSchema>;
export const productPublishingContract = {
  prepareMetadata: ipc.input(productMetadataRequestSchema).output(z.array(productPublishDraftSchema)),
  accounts: ipc.input(z.object({})).output(z.array(productPublishingAccountSchema)),
  get: ipc.input(publication).output(productPublishRecordSchema),
  list: ipc
    .input(
      z.object({
        campaignId: idSchema<'ProductCampaign'>().optional(),
        statuses: z.array(z.enum(PRODUCT_PUBLISH_STATUSES)).optional(),
        limit: z.int().min(1).max(1000).optional(),
      }),
    )
    .output(z.array(productPublishRecordSchema)),
};
export const PRODUCT_PUBLISH_COMMANDS = {
  prepare: 'product.publish.prepare',
  approve: 'product.publish.approve',
  dispatch: 'product.publish.dispatch',
  reconcile: 'product.publish.reconcile',
  cancel: 'product.publish.cancel',
} as const;
export const productPublishCommandPayloads = {
  [PRODUCT_PUBLISH_COMMANDS.prepare]: z.object({ drafts: z.array(productPublishDraftSchema).min(1).max(20) }),
  [PRODUCT_PUBLISH_COMMANDS.approve]: publication.extend({ expectedRevision: z.int().positive() }),
  [PRODUCT_PUBLISH_COMMANDS.dispatch]: publication,
  [PRODUCT_PUBLISH_COMMANDS.reconcile]: publication,
  [PRODUCT_PUBLISH_COMMANDS.cancel]: publication.extend({ expectedRevision: z.int().positive() }),
};
export interface ProductPublishingQueries {
  prepareMetadata(
    input: ProductMetadataRequest,
  ): AsyncResult<readonly z.output<typeof productPublishDraftSchema>[]>;
  accounts(): AsyncResult<readonly z.output<typeof productPublishingAccountSchema>[]>;
  get(id: ProductPublishId): AsyncResult<ProductPublishRecord>;
  list: ProductPublishStore['list'];
}
export function productPublishingRouter(service: ProductPublishingQueries) {
  const os = implementContract(productPublishingContract);
  return os.router({
    prepareMetadata: os.prepareMetadata.handler(async ({ input }) => [
      ...unwrapRpc(await service.prepareMetadata(input)),
    ]),
    accounts: os.accounts.handler(async () => [...unwrapRpc(await service.accounts())]),
    get: os.get.handler(async ({ input }) => unwrapRpc(await service.get(input.id))),
    list: os.list.handler(async ({ input }) => [...unwrapRpc(await service.list(input))]),
  });
}
