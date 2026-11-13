// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Glyph coverage before rendering (qa-gate.md, `captionGlyphs`): every code
 * point of every grapheme must be in the cmap of some font in the style's
 * stack. Joiners, variation selectors and spaces are never asked for.
 * Scripts outside the curated set (Tamil, Arabic) fail here, before any
 * render is spent on boxes of missing glyphs.
 */
import type { CaptionFontId } from '../types';
import { fontCovers, stackKeys } from './fonts';
import { codepoints, graphemes, isIgnorable } from './text';

export interface GlyphIssue {
  readonly cueId: string;
  /** Missing code points, each once, in the order they appear. */
  readonly codepoints: number[];
}

/** Cues whose text has a code point no font in the stack covers. Pure. */
export function captionGlyphIssues(
  cues: readonly { readonly id: string; readonly text: string }[],
  font: CaptionFontId,
): GlyphIssue[] {
  const stack = stackKeys(font);
  const issues: GlyphIssue[] = [];
  for (const cue of cues) {
    const missing: number[] = [];
    for (const grapheme of graphemes(cue.text)) {
      for (const cp of codepoints(grapheme)) {
        if (isIgnorable(cp) || missing.includes(cp)) continue;
        if (!stack.some((key) => fontCovers(key, cp))) missing.push(cp);
      }
    }
    if (missing.length > 0) issues.push({ cueId: cue.id, codepoints: missing });
  }
  return issues;
}
