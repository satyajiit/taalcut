// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type Id } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { productPlatformSchema, type ProductCampaignId } from './product-schema';

export type ProductPublishId = Id<'ProductPublish'>;
export type ProductPublishBatchId = Id<'ProductPublishBatch'>;
export const PRODUCT_PUBLISH_STATUSES = [
  'draft',
  'approved',
  'uploading',
  'scheduling',
  'unknown',
  'scheduled',
  'published',
  'failed',
  'cancelled',
] as const;
export type ProductPublishStatus = (typeof PRODUCT_PUBLISH_STATUSES)[number];
export const productPublishRecordSchema = z.object({
  id: idSchema<'ProductPublish'>(),
  batchId: idSchema<'ProductPublishBatch'>(),
  productId: idSchema<'Product'>(),
  campaignId: idSchema<'ProductCampaign'>(),
  campaignRevision: z.int().positive(),
  revision: z.int().positive(),
  platform: productPlatformSchema,
  accountId: z.string().min(1).max(500),
  provider: z.string().min(1).max(100),
  renderId: idSchema<'Render'>(),
  mediaHash: z.string().min(1).max(200),
  content: z.string().max(63_206),
  title: z.string().max(500).optional(),
  tags: z.array(z.string().max(200)),
  providerSettings: z.record(z.string(), z.json()),
  scheduledAt: z.iso.datetime({ offset: true }),
  timezone: z.string().min(1).max(100),
  status: z.enum(PRODUCT_PUBLISH_STATUSES),
  approvalHash: z.string().max(200).nullable(),
  remoteMedia: z.object({ id: z.string(), path: z.string() }).nullable(),
  remotePostId: z.string().nullable(),
  publishedUrl: z.url().nullable(),
  retryAt: z.int().nonnegative().nullable(),
  errorCode: z.string().max(500).nullable(),
  createdAt: z.int().nonnegative(),
  updatedAt: z.int().nonnegative(),
});
export type ProductPublishRecord = z.output<typeof productPublishRecordSchema>;
export interface ProductPublishStore {
  get(id: ProductPublishId): AsyncResult<ProductPublishRecord | null>;
  readReconcileCursor(): AsyncResult<ProductPublishId | null>;
  saveReconcileCursor(afterId: ProductPublishId | null): AsyncResult<void>;
  list(input?: {
    /** Presence selects stable ascending ID order; null starts a reconciliation scan. */
    afterId?: ProductPublishId | null;
    campaignId?: ProductCampaignId;
    statuses?: readonly ProductPublishStatus[];
    limit?: number;
  }): AsyncResult<readonly ProductPublishRecord[]>;
  create(records: readonly ProductPublishRecord[]): AsyncResult<void>;
  update(record: ProductPublishRecord, expectedRevision: number): AsyncResult<void>;
}
