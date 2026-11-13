// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { expect, it } from 'vitest';
import { buildProductSocialMetadata } from '../src/images/product-social-metadata';

it('packages accepted product facts for all five destinations without unrelated filmmaking copy', () => {
  const pack = buildProductSocialMetadata({
    productName: 'OpenAlly',
    title: 'Your notes, available offline',
    summary: 'Open a saved note without an internet connection.',
    callToAction: 'Try offline notes.',
    keywords: ['offline notes'],
  });
  expect(pack.youtube.tags).toEqual(['OpenAlly', 'offline notes']);
  expect(pack.youtube.description).toContain('Open a saved note');
  expect(pack.instagram.hashtags).toEqual(['openally', 'offlinenotes']);
  expect(pack.instagram.caption).toContain('Try offline notes.');
  expect(pack.x?.text).toContain('Your notes');
  expect(pack.linkedin?.text).toEqual(pack.facebook?.description);
  expect(JSON.stringify(pack)).not.toContain('cinematic vlog');
});

it('bounds generated metadata without splitting emoji or rejecting long non-BMP titles', () => {
  const pack = buildProductSocialMetadata({
    productName: 'Product',
    title: '🎬'.repeat(100),
    summary: '✨'.repeat(2000),
  });
  expect(pack.youtube.title).toHaveLength(100);
  expect(pack.youtube.title.endsWith('🎬')).toBe(true);
  expect(pack.instagram.caption.length).toBeLessThanOrEqual(2200);
});
