// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type {
  AsyncResult,
  PluginAgentService,
  ProductCampaignId,
  ProductPublishRecord,
  ProductPublishStore,
  RenderId,
} from '@taalcut/core';

export type ProductPublishDraft = Pick<
  ProductPublishRecord,
  | 'productId'
  | 'campaignId'
  | 'campaignRevision'
  | 'platform'
  | 'accountId'
  | 'provider'
  | 'renderId'
  | 'mediaHash'
  | 'content'
  | 'title'
  | 'tags'
  | 'providerSettings'
  | 'scheduledAt'
  | 'timezone'
>;

export interface ProductPublisherDeps {
  readonly store: ProductPublishStore;
  readonly plugins: Pick<PluginAgentService, 'invoke'>;
  readonly campaignRevision: (id: ProductCampaignId) => AsyncResult<number>;
  /** Recompute from the finished render; don't trust a renderer-supplied digest. */
  readonly verifyRender: (id: RenderId, hash: string, draft: ProductPublishDraft) => AsyncResult<boolean>;
  readonly now?: () => number;
}

export interface ProductPublishingAccount {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly platform: ProductPublishRecord['platform'];
}
