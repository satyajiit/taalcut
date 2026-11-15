// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A sequence's place read again (LYR1): which of the place's pieces (text-zone.ts) are the sequence, and how its
 * words are cased. Pure.
 */
import type { SequenceRule } from './text-sequence';
import type { ZonePiece } from './text-zone';

/**
 * The pieces that are the sequence: the run round `core` (the frames the first pass chained), out through read
 * pieces short enough to be its words. An unread piece is one of them only between its words: no longer than the
 * longest word so far, and with two read pieces in a row beyond it. One read piece beyond a pause is as easily a
 * sign that sits where the words did (the owner's reel had one, two shots after its last word), and the picture
 * before or after the words is not a word.
 */
export function sequenceRun(
  pieces: readonly ZonePiece[],
  core: { readonly start: number; readonly end: number },
  rule: SequenceRule,
): ZonePiece[] {
  const length = (piece: ZonePiece) => piece.end - piece.start;
  const inCore = pieces.map(
    (piece) => piece.text !== null && piece.start < core.end && piece.end > core.start,
  );
  let from = inCore.indexOf(true);
  let to = inCore.lastIndexOf(true);
  if (from < 0) return [];
  const longest = () =>
    Math.max(0, ...pieces.slice(from, to + 1).map((piece) => (piece.text === null ? 0 : length(piece))));
  const word = (at: number) => {
    const piece = pieces[at];
    return piece !== undefined && piece.text !== null && length(piece) <= rule.maxFrames;
  };
  const grow = (step: 1 | -1) => {
    for (;;) {
      const end = step > 0 ? to : from;
      const gap = pieces[end + step];
      const by = word(end + step)
        ? 1
        : gap && gap.text === null && length(gap) <= longest() && word(end + 2 * step) && word(end + 3 * step)
          ? 3
          : 0;
      if (by === 0) return;
      if (step > 0) to = end + by;
      else from = end - by;
    }
  };
  grow(-1);
  grow(1);
  return pieces.slice(from, to + 1);
}

type Lettering = 'upper' | 'lower' | 'first' | 'mixed';

/** How a spelling is cased: all capitals, none, the first letter only, or otherwise. One capital alone is `first`. */
function letteringOf(text: string): Lettering {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters === letters.toLowerCase()) return letters === letters.toUpperCase() ? 'mixed' : 'lower';
  if (letters.slice(1) === letters.slice(1).toLowerCase()) return 'first';
  return letters === letters.toUpperCase() ? 'upper' : 'mixed';
}

/**
 * A sequence is set in one lettering. Where most of its pieces share one and a piece was also read in it, that
 * spelling is the piece's: an engine that reads "leave" on one frame and "Leave" on the next is unsure of the case,
 * not of the word. Nothing is respelt that no frame read.
 */
export function settleCase(pieces: readonly ZonePiece[]): ZonePiece[] {
  const counts = new Map<Lettering, number>();
  const read = pieces.filter((piece) => piece.text !== null);
  for (const piece of read) {
    const lettering = letteringOf(piece.text!);
    counts.set(lettering, (counts.get(lettering) ?? 0) + 1);
  }
  const [most, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['mixed', 0];
  if (most === 'mixed' || count * 2 <= read.length) return [...pieces];
  return pieces.map((piece) => {
    if (piece.text === null || letteringOf(piece.text) === most) return piece;
    const other = piece.spellings.find((spelling) => letteringOf(spelling) === most);
    return other ? { ...piece, text: other } : piece;
  });
}
