// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, ValidationError, type Result, type ProductPublishRecord } from '@taalcut/core';
import twitterText from 'twitter-text';
import type { ProductPublishDraft } from './publishing-types';
import { contentHash } from '../hash';

export const xWeightedLength = (text: string): number =>
  twitterText.parseTweet(text.normalize('NFC')).weightedLength;
export const youtubeTagsLength = (tags: readonly string[]): number =>
  tags.reduce((sum, tag, index) => sum + tag.length + (tag.includes(' ') ? 2 : 0) + (index ? 1 : 0), 0);

const PROVIDERS: Readonly<Record<ProductPublishRecord['platform'], readonly string[]>> = {
  youtube: ['youtube'],
  instagram: ['instagram', 'instagram-standalone'],
  x: ['x', 'twitter'],
  linkedin: ['linkedin', 'linkedin-page'],
  facebook: ['facebook'],
};

export function productPlatformFor(provider: string): ProductPublishRecord['platform'] | undefined {
  return (Object.keys(PROVIDERS) as ProductPublishRecord['platform'][]).find((platform) =>
    PROVIDERS[platform].includes(provider),
  );
}

/** Validate the full outgoing copy, after hooks, hashtags and links have been assembled. */
export function validateProductPublishCopy(
  draft: ProductPublishDraft,
  discoveredLimit?: number,
): Result<void> {
  const invalid = (field: string) => err(ValidationError({ field }));
  if (!PROVIDERS[draft.platform].includes(draft.provider)) return invalid('provider');
  if (!draft.content.trim()) return invalid('content');
  const limits = { youtube: 5000, instagram: 2200, x: 280, linkedin: 3000, facebook: 63_206 };
  const limit = Math.min(limits[draft.platform], discoveredLimit ?? Infinity);
  const count = draft.platform === 'x' ? xWeightedLength(draft.content) : Array.from(draft.content).length;
  if (
    count > limit ||
    (draft.platform === 'x' && !twitterText.parseTweet(draft.content.normalize('NFC')).valid)
  ) {
    return invalid('content');
  }
  if (draft.platform === 'youtube' && (!draft.title?.trim() || draft.title.length > 100))
    return invalid('title');
  if (draft.platform === 'youtube' && youtubeTagsLength(draft.tags) > 500) return invalid('tags');
  try {
    new Intl.DateTimeFormat('en', { timeZone: draft.timezone });
  } catch {
    return invalid('timezone');
  }
  return ok(undefined);
}

/** Runtime state and remote IDs never change what the person approved. */
export function productPublishApprovalHash(record: ProductPublishDraft): string {
  return contentHash({
    productId: record.productId,
    campaignId: record.campaignId,
    campaignRevision: record.campaignRevision,
    platform: record.platform,
    accountId: record.accountId,
    provider: record.provider,
    renderId: record.renderId,
    mediaHash: record.mediaHash,
    content: record.content,
    title: record.title,
    tags: record.tags,
    providerSettings: record.providerSettings,
    scheduledAt: record.scheduledAt,
    timezone: record.timezone,
  });
}

export function productPostizPayload(record: ProductPublishRecord): Record<string, unknown> {
  const settings: Record<string, unknown> = { ...record.providerSettings, __type: record.provider };
  if (record.platform === 'youtube') {
    settings['title'] = record.title;
    settings['tags'] = record.tags.map((tag) => ({ value: tag, label: tag }));
    settings['privacyStatus'] ??= 'public';
  }
  if (record.platform === 'instagram' || record.platform === 'facebook') settings['post_type'] ??= 'post';
  if (record.platform === 'facebook' && record.title) settings['title'] = record.title;
  return {
    type: 'schedule',
    date: record.scheduledAt,
    shortLink: false,
    tags: [],
    posts: [
      {
        integration: { id: record.accountId },
        settings,
        value: [{ content: record.content, image: record.remoteMedia ? [record.remoteMedia] : [] }],
      },
    ],
  };
}
