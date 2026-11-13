// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Punch-ins on emphasis (P3-V9): a suggestion to the reframer, never an audio cut. At each emphasis of strength
 * at least `punchThreshold`, no sooner than `punchMinGapSeconds` after the last punch, the kept piece is split
 * and the part from the word until the piece ends (at most `punchSeconds`) plays punched in; the piece after it
 * plays at the normal framing, so punch-ins alternate in and out.
 */
import type { CleanupSettings, ClipReframe } from '@taalcut/core';
import type { Interval } from '../model/intervals';

/** A static punch-in about a talking head's face: just above the centre (0.5, 0.4) unless the clip follows the subject. */
export function punchReframe(current: ClipReframe | null, settings: CleanupSettings): ClipReframe {
  if (current && (current.mode === 'auto' || current.mode === 'subject')) return { ...current, scale: settings.punchScale };
  return { mode: 'centre', nudge: { x: 0, y: -0.1 }, scale: settings.punchScale };
}

export interface PunchInputs {
  readonly emphasis: readonly { readonly at: Interval; readonly strength: number }[];
  readonly pieces: readonly Interval[];
  /** Kept words, unpadded, in order; a punch starts and ends between words (at their pad when the gap allows). */
  readonly words: readonly Interval[];
  readonly padFrames: number;
  readonly fps: number;
  readonly minFrames: number;
}

/** A whole frame between two words: as close to `wanted` as the gap allows; `fallback` when no frame fits. */
function between(previousEnd: number | null, nextStart: number, wanted: number, fallback: number): number {
  const low = previousEnd === null ? Number.NEGATIVE_INFINITY : Math.ceil(previousEnd);
  const high = Math.floor(nextStart);
  if (low > high) return fallback;
  return Math.min(high, Math.max(low, wanted));
}

/** The latest cut after a word (its pad if the gap allows), after `from` and no later than `limit`; null when none. */
function wordEnd(words: readonly Interval[], pad: number, from: number, limit: number): number | null {
  const ends = words.flatMap((word, index) => {
    const next = words[index + 1];
    const end = next ? between(word.end, next.start, Math.ceil(word.end + pad), Number.NaN) : Math.ceil(word.end + pad);
    return Number.isNaN(end) || end <= from || end > limit ? [] : [end];
  });
  return ends.length === 0 ? null : Math.max(...ends);
}

export function punchRanges(inputs: PunchInputs, settings: CleanupSettings): Interval[] {
  const { pieces, words, fps, minFrames } = inputs;
  const out: Interval[] = [];
  const gap = settings.punchMinGapSeconds * fps;
  const longest = Math.round(settings.punchSeconds * fps);
  const strong = inputs.emphasis
    .filter((entry) => entry.strength >= settings.punchThreshold)
    .sort((a, b) => a.at.start - b.at.start);
  for (const entry of strong) {
    const piece = pieces.find((candidate) => entry.at.start >= candidate.start && entry.at.start < candidate.end);
    if (!piece) continue;
    // Between the word before and this one, at this word's pad when the gap allows.
    const previous = words.filter((word) => word.end <= entry.at.start).at(-1)?.end ?? null;
    const wanted = Math.floor(entry.at.start - inputs.padFrames);
    let start = Math.max(piece.start, between(previous, entry.at.start, wanted, Math.floor(entry.at.start)));
    if (start - piece.start < minFrames) start = piece.start;
    const last = out.at(-1);
    if (last && start - last.start < gap) continue;
    const limit = Math.min(piece.end, start + longest);
    let end = wordEnd(words, inputs.padFrames, start + minFrames, limit) ?? limit;
    if (piece.end - end < minFrames) end = piece.end;
    if (end - start < minFrames) continue;
    out.push({ start, end });
  }
  return out;
}

/** The kept pieces split at the punch-ins: every clip the plan makes, in order. */
export function segments(
  pieces: readonly Interval[],
  punches: readonly Interval[],
): { readonly span: Interval; readonly punched: boolean }[] {
  return pieces.flatMap((piece) => {
    const inside = punches.filter((punch) => punch.start >= piece.start && punch.end <= piece.end);
    const out: { span: Interval; punched: boolean }[] = [];
    let at = piece.start;
    for (const punch of inside) {
      if (punch.start > at) out.push({ span: { start: at, end: punch.start }, punched: false });
      out.push({ span: punch, punched: true });
      at = punch.end;
    }
    if (at < piece.end) out.push({ span: { start: at, end: piece.end }, punched: false });
    return out;
  });
}
