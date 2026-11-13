// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A unit's translated text back onto its source cues (SPEC P3.11 step 3). The cues keep their timing; the text is
 * shared over them in proportion to their source word time, split only at the target language's word boundaries
 * (Intl.Segmenter), so a Devanagari conjunct with its matras is never cut. Within a cue, render's
 * `captions.applyTranslation` times each word by its graphemes as `captions.editText` does, so a cue takes at most
 * one word per `minWordMs` of its length (and the cue schema's 40) whenever the unit's words fit. A cue left
 * with no word of its own (a translation with fewer words than cues) gets the empty text: render drops it, as
 * `captions.editText` deletes an empty cue (round P3-3), so no word is shown twice.
 */
import { RationalTime, type CaptionCue, type CaptionCueId } from '@taalcut/core';
import { TRANSLATE_CONFIG } from './config';

export interface CueText {
  readonly cueId: CaptionCueId;
  readonly text: string;
}

/** Extended grapheme clusters in `language`. */
export function graphemeCount(text: string, language: string): number {
  return [...new Intl.Segmenter(language, { granularity: 'grapheme' }).segment(text)].length;
}

/**
 * The text's words, each with the punctuation that follows it (and any that opens it, like ¿), trimmed. Breaks
 * fall only after a space that follows a word, so joining with single spaces gives the text back.
 */
export function targetWords(text: string, language: string): string[] {
  const words: string[] = [];
  let current = '';
  let hasWord = false;
  for (const part of new Intl.Segmenter(language, { granularity: 'word' }).segment(text)) {
    // A new word (or the mark that opens it) after a space starts the next unit.
    if (hasWord && /\s$/u.test(current) && /\S/u.test(part.segment)) {
      words.push(current.trim());
      current = '';
      hasWord = false;
    }
    current += part.segment;
    hasWord ||= part.isWordLike === true;
  }
  if (current.trim() !== '') words.push(current.trim());
  return words;
}

const ms = (time: RationalTime) => RationalTime.toSeconds(time) * 1000;

/** The cue's spoken time: its words' durations (never under 1 ms, so a cue always gets a share). */
function wordTimeMs(cue: CaptionCue): number {
  return Math.max(
    1,
    cue.words.reduce((sum, word) => sum + ms(word.range.duration), 0),
  );
}

/** Words the cue can show at `minWordMs` each, capped by the cue schema. */
function capacity(cue: CaptionCue): number {
  const fits = Math.floor(ms(cue.range.duration) / TRANSLATE_CONFIG.minWordMs);
  return Math.min(TRANSLATE_CONFIG.maxCueWords, Math.max(1, fits));
}

/**
 * Boundaries (word indexes where each cue starts, plus the end) from the time shares: each word goes to the cue
 * its grapheme midpoint falls in.
 */
function idealBoundaries(words: readonly string[], cues: readonly CaptionCue[], language: string): number[] {
  const weights = cues.map(wordTimeMs);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const sizes = words.map((word) => graphemeCount(word, language));
  const totalSize = sizes.reduce((sum, s) => sum + s, 0);
  const shareEnds: number[] = [];
  let shared = 0;
  for (const weight of weights) shareEnds.push((shared += weight) / totalWeight);
  const owner: number[] = [];
  let before = 0;
  for (const size of sizes) {
    const middle = (before + size / 2) / totalSize;
    before += size;
    const index = shareEnds.findIndex((end) => middle <= end);
    owner.push(index < 0 ? cues.length - 1 : index);
  }
  return [0, ...cues.slice(1).map((_, i) => owner.filter((o) => o <= i).length), words.length];
}

/** Moves boundaries so cues keep under their capacity where neighbours have room, then gives every cue a word. */
function balance(bounds: number[], caps: readonly number[]): number[] {
  const b = [...bounds];
  const last = b.length - 1;
  const at = (i: number) => b[i] ?? 0;
  const cap = (i: number) => caps[i] ?? 1;
  for (let i = 0; i < last - 1; i++) b[i + 1] = Math.min(at(i + 1), at(i) + cap(i));
  for (let i = last - 1; i >= 1; i--) b[i] = Math.max(at(i), at(i + 1) - cap(i));
  if (at(last) >= last) {
    for (let i = 1; i < last; i++) b[i] = Math.max(at(i), at(i - 1) + 1);
    for (let i = last - 1; i >= 1; i--) b[i] = Math.min(at(i), at(i + 1) - 1);
  }
  return b;
}

/** One unit's translation shared over its cues (in timeline order). */
export function shareUnit(cues: readonly CaptionCue[], translated: string, language: string): CueText[] {
  const words = targetWords(translated, language);
  const bounds = balance(idealBoundaries(words, cues, language), cues.map(capacity));
  return cues.map((cue, i) => ({ cueId: cue.id, text: words.slice(bounds[i], bounds[i + 1]).join(' ') }));
}
