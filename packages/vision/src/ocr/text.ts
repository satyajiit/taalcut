// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Text and box helpers shared by the OCR engines, the router and the tracker. */
import { overlapArea, type NormalisedBox, type TextScript } from '@taalcut/core';

/** NFC, trimmed, inner whitespace collapsed to one space: how every engine's text is compared and stored. */
export function normaliseText(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/** Levenshtein distance over Unicode scalars (so a Devanagari matra counts as one edit). */
export function levenshtein(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  let curr = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[y.length] ?? 0;
}

/** 1 − normalised Levenshtein on normalised text: 1 is identical, 0 shares nothing. */
export function textSimilarity(a: string, b: string): number {
  const x = normaliseText(a);
  const y = normaliseText(b);
  const longest = Math.max(Array.from(x).length, Array.from(y).length);
  if (longest === 0) return 1;
  return 1 - levenshtein(x, y) / longest;
}

export function boxArea(box: NormalisedBox): number {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

/** Intersection over union of two top-left boxes. */
export function boxIou(a: NormalisedBox, b: NormalisedBox): number {
  const intersection = overlapArea(a, b);
  const union = boxArea(a) + boxArea(b) - intersection;
  return union <= 0 ? 0 : intersection / union;
}

/** How much of the smaller box lies inside the larger (1: one holds the other). */
export function boxContainment(a: NormalisedBox, b: NormalisedBox): number {
  const smaller = Math.min(boxArea(a), boxArea(b));
  return smaller <= 0 ? 0 : overlapArea(a, b) / smaller;
}

/** The smallest box holding both. */
export function boxUnion(a: NormalisedBox, b: NormalisedBox): NormalisedBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Clamps a box into the unit square, so it passes core's boxSchema. */
export function clampBox(box: NormalisedBox): NormalisedBox {
  const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  const x = clamp(box.x);
  const y = clamp(box.y);
  return { x, y, width: clamp(Math.min(box.width, 1 - x)), height: clamp(Math.min(box.height, 1 - y)) };
}

const DEVANAGARI = /\p{Script=Devanagari}/u;
const LATIN = /\p{Script=Latin}/u;
const LETTER = /\p{L}|\p{M}/u;

/** Which script dominates the letters: Devanagari, Latin, or other (digits and symbols alone are 'other'). */
export function scriptOf(text: string): TextScript {
  let devanagari = 0;
  let latin = 0;
  let letters = 0;
  for (const char of text) {
    if (!LETTER.test(char)) continue;
    letters++;
    if (DEVANAGARI.test(char)) devanagari++;
    else if (LATIN.test(char)) latin++;
  }
  if (letters === 0) return 'other';
  if (devanagari >= latin && devanagari > 0) return 'devanagari';
  if (latin > 0 && latin >= letters / 2) return 'latin';
  return 'other';
}

/** 'pt-BR' → 'pt': the base subtag, lower case, the way OCR engines name languages. */
export function baseLanguage(tag: string): string {
  return (tag.split('-')[0] ?? tag).toLowerCase();
}
