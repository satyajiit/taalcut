// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  err,
  ok,
  ValidationError,
  type AsyncResult,
  type ProductMetadataRequest,
  type ProductStore,
} from '@taalcut/core';
import { buildProductSocialMetadata } from '@taalcut/models';
import type { ProductPublisher, ProductPublishDraft } from '@taalcut/tools';
import { productDeliveryReady, productRenderHash, type productPublishMedia } from './publishing-media';

export function productPublishingMetadata(
  products: ProductStore,
  publisher: ProductPublisher,
  media: ReturnType<typeof productPublishMedia>,
) {
  return async (input: ProductMetadataRequest): AsyncResult<readonly ProductPublishDraft[]> => {
    const campaign = await products.getCampaign(input.campaignId);
    if (!campaign.ok) return campaign;
    const product = await products.get(campaign.value.productId);
    if (!product.ok) return product;
    const idea = await products.getIdea(campaign.value.ideaId);
    if (!idea.ok) return idea;
    const accounts = await publisher.accounts();
    if (!accounts.ok) return accounts;
    const selected = await media.renders.get(input.renderId);
    if (!selected.ok) return selected;
    const current = await media.current(selected.value, {
      productId: campaign.value.productId,
      campaignId: campaign.value.id,
    });
    if (!current.ok) return current;
    const candidates = await media.renders.list({ projectId: campaign.value.projectId, limit: 500 });
    if (!candidates.ok) return candidates;
    const social = buildProductSocialMetadata({
      productName: product.value.name,
      title: idea.value.title,
      summary: idea.value.angle,
      callToAction: product.value.preferences.callToAction,
      keywords: [idea.value.featureKey, ...product.value.preferences.topics],
    });
    const drafts: ProductPublishDraft[] = [];
    const hashes = new Map<string, string>();
    for (const accountId of new Set(input.accountIds)) {
      const account = accounts.value.find((item) => item.id === accountId);
      if (!account) return err(ValidationError({ field: 'accountId' }));
      const render = productDeliveryReady(selected.value, account.platform)
        ? selected.value
        : candidates.value
            .filter(
              (item) =>
                item.timelineId === selected.value.timelineId &&
                item.timelineRevision === selected.value.timelineRevision &&
                productDeliveryReady(item, account.platform),
            )
            .sort((a, b) => b.width * b.height - a.width * a.height || b.createdAt - a.createdAt)[0];
      if (!render)
        return err(
          ValidationError(
            { field: 'publication.delivery' },
            { detail: `Export a current H.264 delivery rendition for ${account.platform}` },
          ),
        );
      let hash = hashes.get(render.id);
      if (!hash) {
        const digest = await productRenderHash(render);
        if (!digest.ok) return digest;
        hash = digest.value;
        hashes.set(render.id, hash);
      }
      const content =
        account.platform === 'youtube'
          ? social.youtube.description
          : account.platform === 'instagram'
            ? [social.instagram.caption, social.instagram.hashtags.map((tag) => `#${tag}`).join(' ')]
                .filter(Boolean)
                .join('\n\n')
            : account.platform === 'x'
              ? social.x!.text
              : account.platform === 'linkedin'
                ? social.linkedin!.text
                : social.facebook!.description;
      drafts.push({
        productId: product.value.id,
        campaignId: campaign.value.id,
        campaignRevision: campaign.value.revision,
        platform: account.platform,
        accountId,
        provider: account.provider,
        renderId: render.id,
        mediaHash: hash,
        content,
        ...(account.platform === 'youtube' || account.platform === 'facebook'
          ? { title: social.youtube.title }
          : {}),
        tags: account.platform === 'youtube' ? social.youtube.tags : [],
        providerSettings:
          account.platform === 'youtube'
            ? { privacyStatus: 'public' }
            : account.platform === 'instagram' || account.platform === 'facebook'
              ? { post_type: 'post' }
              : {},
        scheduledAt: input.scheduledAt,
        timezone: input.timezone,
      });
    }
    return ok(drafts);
  };
}
