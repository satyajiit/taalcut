// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Glyph coverage before rendering (qa-gate.md, captionGlyphs): pure, per cue, through the font stack. */
import { describe, expect, it } from 'vitest';
import { captionGlyphIssues } from '../../src/captions/glyphs';
import { GOLDEN } from '../support/fonts';

describe('captionGlyphIssues', () => {
  it('passes Hindi with conjuncts in Mukta and every golden string in every stack', () => {
    for (const text of Object.values(GOLDEN)) {
      expect(captionGlyphIssues([{ id: 'c1', text }], 'mukta')).toEqual([]);
      expect(captionGlyphIssues([{ id: 'c1', text }], 'anton')).toEqual([]);
    }
  });

  it('passes emoji through Noto Color Emoji, ignoring joiners and variation selectors', () => {
    expect(captionGlyphIssues([{ id: 'c1', text: 'Family 👨‍👩‍👧 love ❤️ flag 🇮🇳 #️⃣' }], 'bebasNeue')).toEqual([]);
  });

  it('fails Tamil and Arabic in any stack, naming each missing code point once', () => {
    const issues = captionGlyphIssues(
      [
        { id: 'ok', text: 'fine' },
        { id: 'ta', text: 'தமிழ் தமிழ்' },
        { id: 'ar', text: 'مرحبا' },
      ],
      'notoSans',
    );
    expect(issues.map((issue) => issue.cueId)).toEqual(['ta', 'ar']);
    expect(issues[0]!.codepoints).toEqual([...new Set([...'தமிழ்'].map((char) => char.codePointAt(0)!))]);
    expect(issues[1]!.codepoints.length).toBe(5);
  });
});
