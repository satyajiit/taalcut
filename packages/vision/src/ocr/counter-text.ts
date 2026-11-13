// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Text that changes in place (IX-O4): clocks, timers, counters and scores.
 * Their box stays while their digits tick, so two readings in about the same
 * place are the same text when both are mostly digits: the box decides, not
 * the reading. Vision misreads a running clock's separators and digits often
 * (bench footage and the in-place fixtures: "00:00:01.500", "00-00:01.500",
 * "00800805. 000", "GG: G5:91.555", or only its last part, "01.500"), so a
 * reading's shape is no guide; a box that overlaps (IoU ≥ trackIou) or holds
 * the other (containment ≥ counterContainment) is. Such a track is one
 * OnScreenText for as long as it stays on screen, instead of a new track (and
 * a new edge bisection) at every tick or misread. The cost: two different
 * numbers shown one after the other in the same place ("$20", then "$45")
 * are one text, stored as its most confident reading.
 */
import type { NormalisedBox } from '@taalcut/core';
import { VISION_CONFIG } from '../config';
import { boxContainment, boxIou, normaliseText } from './text';

const DIGIT = /\p{Nd}/u;
const ALNUM = /[\p{L}\p{Nd}]/u;

/** Digits are at least `counterDigitShare` of the text's letters and digits. */
export function isCounter(text: string): boolean {
  let digits = 0;
  let alnum = 0;
  for (const char of normaliseText(text)) {
    if (!ALNUM.test(char)) continue;
    alnum++;
    if (DIGIT.test(char)) digits++;
  }
  return digits > 0 && digits / alnum >= VISION_CONFIG.ocr.counterDigitShare;
}

export interface Placed {
  readonly text: string;
  readonly box: NormalisedBox;
}

/** Two readings of one counter: both counters, in about the same place. */
export function sameCounter(a: Placed, b: Placed): boolean {
  const { trackIou, counterContainment } = VISION_CONFIG.ocr;
  return (
    isCounter(a.text) &&
    isCounter(b.text) &&
    (boxIou(a.box, b.box) >= trackIou || boxContainment(a.box, b.box) >= counterContainment)
  );
}
