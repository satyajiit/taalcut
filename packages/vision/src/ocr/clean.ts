// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A shot's on-screen text, cleaned before it is stored (LIB1-FIX). Indexing reads a sample a second, so text on
 * something that moves is a new track each sample: a two-line print on dancers' shirts can store a dozen texts for
 * one phrase, misreads seen once each ("tlger", "TIGFR" at 0.3, "TIGEN", "TIGERI", "（27") and the print's two lines
 * as two texts. A shot keeps what its reads agree on, in five steps:
 *
 * 1. **Lone junk goes:** a text seen in one sample under 0.5 confidence, or with under three letters and no digit.
 * 2. **Covered misreads go:** a low-confidence text that a confident one covers in place, at the same time or the
 *    next sample.
 * 3. **Blocks:** lines read together, one under the other, aligned and of a size, are one text ("TIGER" over
 *    "TEAM" is "TIGER TEAM").
 * 4. **One spelling:** reads of one phrase are one text, in the spelling their words agree on (clean-phrases.ts).
 * 5. **Fragments go:** a text whose words a longer text of the shot already holds ("TIGER" beside "TIGER TEAM").
 *
 * A merged text spans every sample that showed one of its reads: search, the agent and the text vectors read the
 * words, and the clip page's text lane the stretch. Captions and Hindi keep their words: a caption lasts more than
 * one sample, its lines join into one text, and letters count as written (a Devanagari conjunct is one letter).
 * The breakdown, which tracks frame-exact edges, doesn't clean: this is the indexing path's (read-shots.ts).
 */
import { RationalTime, type OnScreenText } from '@taalcut/core';
import { asOne, dropFragments, letterCount, oneSpelling } from './clean-phrases';
import { boxContainment, boxUnion, normaliseText } from './text';

export const OCR_CLEANING = {
  /** A text seen in one sample needs this confidence (Apple Vision answers 0.3, 0.5 or 1). */
  loneMinConfidence: 0.5,
  /** A text seen in one sample needs this many letters, unless it has a digit (a score, a price, a date). */
  loneMinLetters: 3,
  /** A confident text covers a low-confidence one when it holds this share of the smaller box. */
  cover: 0.5,
  /** Lines of one block overlap across by this share of the narrower line. */
  blockOverlap: 0.5,
  /** Lines of one block are at most this share of the smaller line's height apart. */
  blockGap: 0.6,
  /** Lines of one block are within this ratio of each other's height. */
  blockHeights: 2,
  /** Lines of one block were seen together for at least this share of the longer one's stretch. */
  blockTogether: 0.5,
} as const;

const DIGIT = /\p{Nd}/u;

/** The stretch in grid frames (every text of a shot is on the shot's grid). */
function framesOf(text: OnScreenText): { readonly from: number; readonly to: number } {
  const from = text.range.start.value;
  return { from, to: from + Math.max(1, text.range.duration.value) };
}

/** Seen in one sample: without a frame reader a track's stretch is its samples, so one sample is one frame. */
const lone = (text: OnScreenText) => text.range.duration.value <= 1;

/** Step 1. */
function isJunk(text: OnScreenText): boolean {
  if (!lone(text)) return false;
  if (text.confidence < OCR_CLEANING.loneMinConfidence) return true;
  return !DIGIT.test(text.text) && letterCount(text.text) < OCR_CLEANING.loneMinLetters;
}

/** At the same time or within one sample of it. */
function near(a: OnScreenText, b: OnScreenText, every: number): boolean {
  const x = framesOf(a);
  const y = framesOf(b);
  return x.from <= y.to + every && y.from <= x.to + every;
}

/** Step 2. */
function isCovered(text: OnScreenText, all: readonly OnScreenText[], every: number): boolean {
  if (text.confidence >= OCR_CLEANING.loneMinConfidence) return false;
  return all.some(
    (other) =>
      other !== text &&
      other.confidence >= OCR_CLEANING.loneMinConfidence &&
      boxContainment(text.box, other.box) >= OCR_CLEANING.cover &&
      near(text, other, every),
  );
}

/** `lower` is the next line of `upper`'s block: under it, aligned, of a size, and seen with it. */
function nextLine(upper: OnScreenText, lower: OnScreenText): boolean {
  const a = upper.box;
  const b = lower.box;
  const small = Math.min(a.height, b.height);
  if (small <= 0 || Math.max(a.height, b.height) > small * OCR_CLEANING.blockHeights) return false;
  if (b.y < a.y + a.height / 2 || b.y - (a.y + a.height) > small * OCR_CLEANING.blockGap) return false;
  const across = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  if (across < Math.min(a.width, b.width) * OCR_CLEANING.blockOverlap) return false;
  const x = framesOf(upper);
  const y = framesOf(lower);
  const together = Math.min(x.to, y.to) - Math.max(x.from, y.from);
  return together >= Math.max(x.to - x.from, y.to - y.from) * OCR_CLEANING.blockTogether;
}

/** Step 3: lines one under another become one text, top to bottom, its box around them all. */
function joinBlocks(texts: readonly OnScreenText[]): OnScreenText[] {
  const blocks: OnScreenText[][] = [];
  for (const text of [...texts].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
    const block = blocks.find((lines) => nextLine(lines[lines.length - 1]!, text));
    if (block) block.push(text);
    else blocks.push([text]);
  }
  return blocks.map((lines) => {
    if (lines.length === 1) return lines[0]!;
    const box = lines.slice(1).reduce((all, line) => boxUnion(all, line.box), lines[0]!.box);
    const joined = asOne(lines, normaliseText(lines.map((line) => line.text).join(' ')), {
      ...lines[0]!,
      box,
    });
    // A block is as sure as its least sure line.
    return { ...joined, confidence: Math.min(...lines.map((line) => line.confidence)) };
  });
}

/**
 * A shot's tracked texts, cleaned. `every` is the grid frames between samples: a covered misread must be seen at the
 * same time as the read that covers it, or one sample away.
 */
export function cleanShotText(texts: readonly OnScreenText[], every: number): OnScreenText[] {
  const real = texts.filter((text) => !isJunk(text));
  const clear = real.filter((text) => !isCovered(text, real, every));
  return dropFragments(oneSpelling(joinBlocks(clear))).sort(
    (a, b) => RationalTime.compare(a.range.start, b.range.start) || a.box.y - b.box.y || a.box.x - b.box.x,
  );
}
