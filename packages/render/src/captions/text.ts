// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Text units for captions, from Intl.Segmenter: graphemes (a Devanagari
 * conjunct with its matras and reph is one, so nothing ever splits it),
 * word break opportunities, and the code points a glyph check ignores.
 */

const graphemeSegmenters = new Map<string, Intl.Segmenter>();
const wordSegmenters = new Map<string, Intl.Segmenter>();

function segmenter(cache: Map<string, Intl.Segmenter>, language: string, granularity: 'grapheme' | 'word') {
  let found = cache.get(language);
  if (!found) {
    found = new Intl.Segmenter(language, { granularity });
    cache.set(language, found);
  }
  return found;
}

/** Extended grapheme clusters. */
export function graphemes(text: string, language = 'en'): string[] {
  return [...segmenter(graphemeSegmenters, language, 'grapheme').segment(text)].map((part) => part.segment);
}

/** Word-like segments and the separators between them, in order (joining them gives the text back). */
export function wordSegments(
  text: string,
  language = 'en',
): { readonly text: string; readonly isWord: boolean }[] {
  return [...segmenter(wordSegmenters, language, 'word').segment(text)].map((part) => ({
    text: part.segment,
    isWord: part.isWordLike === true,
  }));
}

/**
 * Line-break units: words with the punctuation and spaces that follow them, so a line can only end
 * after a whole word. Built from the word segmenter, so breaks never fall inside a grapheme.
 */
export function breakUnits(text: string, language = 'en'): string[] {
  const units: string[] = [];
  let current = '';
  for (const part of wordSegments(text, language)) {
    if (part.isWord && /\s$/u.test(current)) {
      units.push(current);
      current = '';
    }
    current += part.text;
  }
  if (current) units.push(current);
  return units;
}

/** Joiners, variation selectors and spaces: a glyph check never asks a font for these. */
export function isIgnorable(codepoint: number): boolean {
  return (
    codepoint === 0x200c || // ZWNJ
    codepoint === 0x200d || // ZWJ
    (codepoint >= 0xfe00 && codepoint <= 0xfe0f) ||
    (codepoint >= 0xe0100 && codepoint <= 0xe01ef) ||
    (codepoint >= 0xe0020 && codepoint <= 0xe007f) || // emoji tag sequences
    /\s/u.test(String.fromCodePoint(codepoint))
  );
}

export function codepoints(text: string): number[] {
  return [...text].map((char) => char.codePointAt(0)!);
}

/** A grapheme Chrome draws with a colour emoji font: emoji presentation, VS16, ZWJ sequences, flags, keycaps. */
export function isEmojiGrapheme(grapheme: string): boolean {
  if (/\p{Emoji_Presentation}|\p{Regional_Indicator}|⃣/u.test(grapheme)) return true;
  return /️/u.test(grapheme) && /\p{Extended_Pictographic}|[#*0-9]/u.test(grapheme);
}

/** 'upper' changes Latin letters only (core's CaptionStyle.letterCase): Devanagari has no case. */
export function applyLetterCase(text: string, letterCase: 'asIs' | 'upper', language = 'en'): string {
  if (letterCase === 'asIs') return text;
  return text.replace(/\p{Script=Latin}+/gu, (run) => run.toLocaleUpperCase(language));
}

/** Ends a sentence: . ? ! … and the Devanagari danda and double danda, with closing quotes after. */
export function endsSentence(word: string): boolean {
  return /[.?!…।॥]["'”’»)\]]*$/u.test(word.trim());
}

/** Spanish inverted marks open a new cue. */
export function opensSentence(word: string): boolean {
  return /^["'“‘«([]*[¿¡]/u.test(word.trim());
}
