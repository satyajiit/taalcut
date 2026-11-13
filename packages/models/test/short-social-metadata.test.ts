// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { buildShortSocialMetadataPack } from '../src/images/short-social-metadata';

const input = {
  title: 'Why this bridge moves',
  hook: 'The bridge moves when the train arrives.',
  summary: 'The engineer explains how the bridge expands with the heat.',
  sourceUrl: 'https://www.youtube.com/watch?v=source123',
};

describe('source-grounded short publishing copy', () => {
  it('packages only the accepted source facts without generated images or invented research', () => {
    const pack = buildShortSocialMetadataPack(input);
    expect(pack.youtube.title).toBe(input.title);
    expect(pack.instagram.hookLine).toBe(input.hook);
    expect(pack.youtube.description).toContain(input.summary);
    expect(pack.youtube.description).toContain(input.sourceUrl);
    expect(pack.youtube.chapters).toEqual([]);
    expect(pack.instagram.hashtags).toEqual([]);
    expect(pack.youtube.description).not.toContain('related video link');
    expect(pack.instagram.caption).not.toContain('link in my profile');
  });

  it('does not promise a profile destination from another video or an unconfirmed link', () => {
    for (const creator of [
      { profileLinkConfirmed: false, profileLinkUrl: input.sourceUrl },
      { profileLinkConfirmed: true, profileLinkUrl: 'https://www.youtube.com/watch?v=other123' },
    ]) {
      expect(buildShortSocialMetadataPack({ ...input, creator }).instagram.caption).not.toContain(
        'link in my profile',
      );
    }
    expect(
      buildShortSocialMetadataPack({
        ...input,
        creator: { profileLinkConfirmed: true, profileLinkUrl: input.sourceUrl },
      }).instagram.caption,
    ).toContain('link in my profile');
  });

  it('uses an actual related-video confirmation separately from plain description URLs', () => {
    expect(
      buildShortSocialMetadataPack({ ...input, youtubeRelatedVideoConfirmed: true }).youtube.description,
    ).toContain('related video link');
    expect(
      buildShortSocialMetadataPack({ ...input, sourceUrl: undefined, youtubeRelatedVideoConfirmed: true })
        .youtube.description,
    ).not.toContain('related video link');
  });

  it('ignores invalid source links and reports valid source timestamps without inventing chapters', () => {
    const pack = buildShortSocialMetadataPack({
      ...input,
      sourceUrl: 'javascript:alert(1)',
      sourceStartSeconds: 12.5,
      sourceEndSeconds: 62,
    });
    expect(pack.youtube.description).not.toContain('javascript:');
    expect(pack.researchSummary).toContain('Source excerpt: 12.50–62.00 seconds.');
    expect(pack.youtube.chapters).toEqual([]);
  });
});
