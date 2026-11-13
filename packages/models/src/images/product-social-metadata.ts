// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { socialMetadataPackSchema, type SocialMetadataPack } from '@taalcut/core';

export interface ProductSocialMetadataInput {
  readonly productName: string;
  readonly title: string;
  readonly summary: string;
  readonly callToAction?: string;
  readonly keywords?: readonly string[];
}

const clean = (text: string, max: number) => {
  let result = '';
  for (const character of text.normalize('NFC').trim()) {
    if (result.length + character.length > max) break;
    result += character;
  }
  return result;
};

/** Packages accepted product facts; generation must establish the claims before this step. */
export function buildProductSocialMetadata(input: ProductSocialMetadataInput): SocialMetadataPack {
  const title = clean(input.title, 100) || clean(input.productName, 100);
  const summary = clean(input.summary, 1600) || title;
  const cta = clean(input.callToAction ?? '', 250);
  const copy = [summary, cta].filter(Boolean).join('\n\n');
  const tags = [
    ...new Set(
      [input.productName, ...(input.keywords ?? [])]
        .map((tag) => clean(tag.replace(/^#/, ''), 50))
        .filter(Boolean),
    ),
  ].slice(0, 8);
  const hashtags = [
    ...new Set(tags.map((tag) => tag.replace(/[^\p{L}\p{N}_]/gu, '').toLowerCase()).filter(Boolean)),
  ].slice(0, 5);
  return socialMetadataPackSchema.parse({
    researchSummary: ['Copy uses the accepted product story and its source evidence.'],
    youtube: { title, titleAlternates: [], description: copy, tags, chapters: [] },
    instagram: { hookLine: clean(title, 140), caption: copy, hashtags },
    tiktok: { caption: copy, seoKeywords: tags.slice(0, 8).map((tag) => clean(tag, 40)), hashtags },
    // Every Unicode scalar weighs at most two before URL transformation; leave room for copy edits.
    x: { text: clean([title, cta].filter(Boolean).join('\n\n'), 120) },
    linkedin: { text: copy },
    facebook: { title, description: copy },
  });
}
