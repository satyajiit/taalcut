// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Keeping the slot context inside the model's context (LRN1-CTX). Each text is first held to its own cap;
 * when all of them together are still over the whole output's cap, every text is cut to the same level, the
 * largest one that fits: short texts stay whole and long ones are trimmed alike, so no slot loses its context
 * to a wordy neighbour. Lengths are in UTF-16 code units, as JavaScript and zod's `max` count them.
 */

const ELLIPSIS = '…';

/** `text` at most `max` characters, cut at a word boundary when one is near and marked with an ellipsis. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= ELLIPSIS.length) return '';
  const room = max - ELLIPSIS.length;
  const cut = text.slice(0, room);
  const space = cut.lastIndexOf(' ');
  // Prefer the last whole word unless that throws away more than a third of the room.
  const kept = space >= Math.ceil((room * 2) / 3) ? cut.slice(0, space) : cut;
  // Never end on half of a surrogate pair.
  const safe = /[\uD800-\uDBFF]$/u.test(kept) ? kept.slice(0, -1) : kept;
  return `${safe.trimEnd()}${ELLIPSIS}`;
}

/**
 * The largest per-text level `c` such that the texts, each cut to `min(length, c)`, fit in `total`; Infinity
 * when they already fit.
 */
export function levelFor(lengths: readonly number[], total: number): number {
  const sum = lengths.reduce((acc, length) => acc + length, 0);
  if (sum <= total) return Number.POSITIVE_INFINITY;
  const sorted = [...lengths].sort((a, b) => a - b);
  let spent = 0;
  for (const [index, length] of sorted.entries()) {
    const left = sorted.length - index;
    // Every text from here on gets the same share of what is left.
    const share = Math.floor((total - spent) / left);
    if (length > share) return share;
    spent += length;
  }
  return Number.POSITIVE_INFINITY;
}
