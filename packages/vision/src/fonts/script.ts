// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Script of an OCR string. Candidates are never compared across scripts. */
export type FontScript = 'devanagari' | 'latin';

const DEVANAGARI: readonly (readonly [number, number])[] = [
  [0x0900, 0x097f],
  [0xa8e0, 0xa8ff],
  [0x1cd0, 0x1cff],
];

function isDevanagari(cp: number): boolean {
  return DEVANAGARI.some(([start, end]) => cp >= start && cp <= end);
}

/** ASCII letters plus Latin-1 letters. Multiplication (×) and division (÷) are not letters. */
function isLatinLetter(cp: number): boolean {
  if (cp >= 0x41 && cp <= 0x5a) return true;
  if (cp >= 0x61 && cp <= 0x7a) return true;
  if (cp >= 0x00c0 && cp <= 0x00d6) return true;
  if (cp >= 0x00d8 && cp <= 0x00f6) return true;
  return cp >= 0x00f8 && cp <= 0x00ff;
}

function isDigit(cp: number): boolean {
  return cp >= 0x30 && cp <= 0x39;
}

/**
 * Devanagari if any code point is in the Devanagari, Devanagari Extended or Vedic
 * Extensions blocks (even when Latin letters are mixed in). Otherwise Latin letters,
 * or digits with no letters. Empty or symbols only → null, and the match is withheld.
 */
export function scriptOf(text: string): FontScript | null {
  let latin = false;
  let digit = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (isDevanagari(cp)) return 'devanagari';
    if (isLatinLetter(cp)) latin = true;
    else if (isDigit(cp)) digit = true;
  }
  if (latin || digit) return 'latin';
  return null;
}
