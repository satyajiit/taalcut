// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, type ProductPublishRecord, type ProductStore } from '@taalcut/core';
import type { ProductPublisher } from '@taalcut/tools';

/** The durable feed remains useful when native notifications are disabled. */
export function productPublishingActivity(products: ProductStore, publisher: ProductPublisher) {
  return async (before: ProductPublishRecord | null, record: ProductPublishRecord) => {
    if (before?.status === record.status) return;
    const product = await products.get(record.productId);
    if (!product.ok) return;
    if (['draft', 'published', 'failed', 'unknown'].includes(record.status)) {
      await products.appendNotification({
        id: newId<'ProductNotification'>(),
        productId: record.productId,
        campaignId: record.campaignId,
        kind:
          record.status === 'draft'
            ? 'approval-required'
            : record.status === 'published'
              ? 'published'
              : 'failed',
        title: product.value.name,
        body:
          record.status === 'draft'
            ? `Review the ${record.platform} post before publication.`
            : record.status === 'published'
              ? `The ${record.platform} post is published.`
              : record.status === 'unknown'
                ? `Check the ${record.platform} post in Postiz before creating a replacement. Its outcome is uncertain.`
                : `The ${record.platform} post needs attention.`,
        createdAt: Date.now(),
        readAt: null,
      });
    }
    if (record.status !== 'scheduled' && record.status !== 'published') return;
    const campaign = await products.getCampaign(record.campaignId);
    if (!campaign.ok) return;
    const records = await publisher.list({ campaignId: record.campaignId });
    if (!records.ok) return;
    const current = records.value.filter(
      (item) => item.campaignRevision === record.campaignRevision && item.status !== 'cancelled',
    );
    if (!current.length || current.some((item) => item.status !== 'scheduled' && item.status !== 'published'))
      return;
    const status = current.every((item) => item.status === 'published') ? 'published' : 'scheduled';
    if (
      campaign.value.status === status ||
      (campaign.value.revision !== record.campaignRevision && campaign.value.status !== 'scheduled')
    )
      return;
    // Content approval remains valid for siblings until the complete revision has been handed off.
    await products.saveCampaign(
      { ...campaign.value, status, revision: campaign.value.revision + 1, updatedAt: Date.now() },
      campaign.value.revision,
    );
  };
}
