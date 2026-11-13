// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { socialMetadataPackSchema, type CreatorProfile, type SocialMetadataPack } from '@taalcut/core';

export interface ShortSocialMetadataInput {
  /** These statements come from the accepted candidate's source evidence. */
  readonly title: string;
  readonly hook: string;
  readonly summary: string;
  readonly sourceUrl?: string;
  readonly sourceStartSeconds?: number;
  readonly sourceEndSeconds?: number;
  readonly creator?: CreatorProfile;
  /** Confirmed after an eligible native Related Video has actually been attached. */
  readonly youtubeRelatedVideoConfirmed?: boolean;
}

function clean(value: string, limit: number): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, limit);
}

function sourceLink(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Platform packaging of accepted source facts; independent of images, invented SEO or research claims. */
export function buildShortSocialMetadataPack(input: ShortSocialMetadataInput): SocialMetadataPack {
  const title =
    clean(input.title, 100) || clean(input.hook, 100) || clean(input.summary, 100) || 'Source excerpt';
  const hook = clean(input.hook, 140) || title;
  const summary = clean(input.summary, 1800) || hook;
  const source = sourceLink(input.sourceUrl);
  const creator = input.creator;
  const channel = creator?.youtubeHandle ?? creator?.name;
  const attribution = channel ? `From ${clean(channel, 100)} on YouTube.` : '';
  const youtubeCta =
    source && input.youtubeRelatedVideoConfirmed
      ? 'Watch the full video using the related video link.'
      : attribution;
  // A saved profile link for another episode must not be presented as this episode's destination.
  const profileMatches =
    source && creator?.profileLinkConfirmed && sourceLink(creator.profileLinkUrl) === source;
  const instagramCta = profileMatches ? 'Watch the full video via the link in my profile.' : attribution;
  const researchSummary = [
    'Copy is based on the selected source segment.',
    'YouTube Shorts description and comment URLs are not clickable. Add a related video in YouTube Studio to link the full video.',
    ...(profileMatches
      ? []
      : ['Check the Instagram profile destination before adding a link-in-profile call to action.']),
  ];
  const start = input.sourceStartSeconds;
  const end = input.sourceEndSeconds;
  if (
    start !== undefined &&
    end !== undefined &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start >= 0 &&
    end > start
  ) {
    researchSummary.push(`Source excerpt: ${start.toFixed(2)}–${end.toFixed(2)} seconds.`);
  }
  return socialMetadataPackSchema.parse({
    researchSummary,
    youtube: {
      title,
      titleAlternates: [],
      description: [summary, youtubeCta, source ? `Original video: ${source}` : '']
        .filter(Boolean)
        .join('\n\n'),
      tags: [title.slice(0, 50)],
      chapters: [],
    },
    instagram: {
      hookLine: hook,
      caption: [summary === hook ? '' : summary, instagramCta].filter(Boolean).join('\n\n') || hook,
      hashtags: [],
    },
    tiktok: { caption: [summary, attribution].filter(Boolean).join('\n\n'), seoKeywords: [], hashtags: [] },
  });
}
