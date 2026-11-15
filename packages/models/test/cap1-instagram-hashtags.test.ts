// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CAP1: one rule for Instagram everywhere. The publish packs' Instagram hashtags take their count from core's
 * post caption rule table (the one `timeline.setPostCaption` enforces): the whole caption's count, and nothing
 * padded up to a quota.
 */
import { POST_CAPTION_RULES } from '@taalcut/core';
import { expect, it } from 'vitest';
import { buildProductSocialMetadata } from '../src/images/product-social-metadata';
import { buildSocialMetadataPack } from '../src/images/social-metadata';

const { min, max } = POST_CAPTION_RULES.instagram.hashtags;
const base = {
  hookText: 'Night market in Hanoi',
  prompt: 'Lanterns over the old quarter street food stalls',
};

it('keeps the stated hashtags, at most the rule’s count, with no filler added', () => {
  const two = buildSocialMetadataPack({ ...base, instagram: { hashtags: ['#Hanoi', 'nightmarket'] } });
  expect(two.instagram.hashtags).toEqual(['hanoi', 'nightmarket']);
  const many = buildSocialMetadataPack({
    ...base,
    instagram: { hashtags: ['hanoi', 'nightmarket', 'streetfood', 'lanterns', 'oldquarter', 'vietnam'] },
  });
  expect(many.instagram.hashtags).toEqual(['hanoi', 'nightmarket', 'streetfood', 'lanterns']);
  expect(many.instagram.hashtags).toHaveLength(max);
});

it('counts a hashtag typed in the caption towards the same total', () => {
  const pack = buildSocialMetadataPack({
    ...base,
    instagram: {
      caption: 'Lanterns everywhere. #hanoi #nightmarket',
      hashtags: ['streetfood', 'lanterns', 'oldquarter', 'vietnam'],
    },
  });
  expect(pack.instagram.hashtags).toEqual(['streetfood', 'lanterns']);
  const full = buildSocialMetadataPack({
    ...base,
    instagram: { caption: 'One #a two #b three #c four #d', hashtags: ['streetfood'] },
  });
  expect(full.instagram.hashtags).toEqual([]);
});

it('with none stated, gives the least the rule asks for, from the video’s own words', () => {
  const pack = buildSocialMetadataPack(base);
  expect(pack.instagram.hashtags).toHaveLength(min);
  expect(pack.instagram.hashtags).toEqual(['night']);
  for (const filler of ['filmmaking', 'cinematography', 'videoediting', 'storytelling'])
    expect(pack.instagram.hashtags).not.toContain(filler);
});

it('holds the product pack’s Instagram hashtags to the same count', () => {
  const pack = buildProductSocialMetadata({
    productName: 'OpenAlly',
    title: 'Your notes, available offline',
    summary: 'Open a saved note without an internet connection.',
    keywords: ['offline notes', 'note taking', 'sync', 'markdown', 'privacy'],
  });
  expect(pack.instagram.hashtags.length).toBeLessThanOrEqual(max);
  expect(pack.instagram.hashtags).toEqual(pack.tiktok.hashtags.slice(0, max));
});
