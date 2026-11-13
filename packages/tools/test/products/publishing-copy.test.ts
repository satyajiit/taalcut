// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  validateProductPublishCopy,
  xWeightedLength,
  youtubeTagsLength,
} from '../../src/products/publishing-copy';
import { publishDraft } from './publishing-fixture';

describe('social destination copy validation', () => {
  it('uses X URL, emoji sequence, CJK and NFC weights rather than UTF-16 length', () => {
    expect(xWeightedLength('https://example.com/a/very/long/path')).toBe(23);
    expect(xWeightedLength('👨‍👩‍👧‍👦')).toBe(2);
    expect(xWeightedLength('漢字')).toBe(4);
    expect(xWeightedLength('e\u0301')).toBe(1);
    expect(xWeightedLength('नमस्ते')).toBe(6);
    expect(
      validateProductPublishCopy(publishDraft({ platform: 'x', provider: 'x', content: 'a'.repeat(280) })).ok,
    ).toBe(true);
    expect(
      validateProductPublishCopy(publishDraft({ platform: 'x', provider: 'x', content: 'a'.repeat(281) })).ok,
    ).toBe(false);
  });
  it('includes commas and space quoting in YouTube aggregate tags', () => {
    expect(youtubeTagsLength(['one', 'two words'])).toBe(15);
    expect(validateProductPublishCopy(publishDraft({ tags: ['a'.repeat(250), 'b'.repeat(250)] })).ok).toBe(
      false,
    );
  });
  it('honours stricter connected account limits and rejects a mismatched provider', () => {
    expect(validateProductPublishCopy(publishDraft({ content: 'abcdef' }), 5).ok).toBe(false);
    expect(validateProductPublishCopy(publishDraft({ provider: 'facebook' })).ok).toBe(false);
  });
});
