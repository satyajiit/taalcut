// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A speech analysis seen through one clip, and the word guard (P3-V9), as @taalcut/timeline's speech-spans.ts,
 * word-guard.ts and punch-ins.ts make them: every range in the clip's own frames; fillers, the long part of each
 * long pause and the earlier take of each retake may go; every kept word, padded, is taken out of every removal,
 * so no word is clipped; punch-ins on strong emphasis split the kept pieces.
 */
import {
  coveredFrames as covered,
  mergeSpans as merge,
  RationalTime,
  subtractSpans as subtract,
  type CleanupSettings,
  type ClipReframe,
  type FrameRate,
  type FrameSpan as Interval,
  type SpeechCleanupAnalysis,
  type TimeRange,
} from '@taalcut/core';

export type { Interval };

export const complement = (removals: readonly Interval[], total: number): Interval[] =>
  subtract([{ start: 0, end: total }], removals);

export interface ClipWindow {
  readonly sourceStart: RationalTime;
  /** Its length on the timeline, canvas frames. */
  readonly frames: number;
  readonly canvas: FrameRate;
}

export interface SpeechSpans {
  readonly speechFrames: number;
  readonly fillers: readonly Interval[];
  readonly pauses: readonly Interval[];
  readonly retakes: readonly Interval[];
  readonly keptWords: readonly Interval[];
  readonly emphasis: readonly { readonly at: Interval; readonly strength: number }[];
}

const fps = (rate: FrameRate) => rate.num / rate.den;
const inside = (interval: Interval, frames: number) => interval.end > 0 && interval.start < frames;

export function speechSpans(
  analysis: SpeechCleanupAnalysis,
  window: ClipWindow,
  settings: CleanupSettings,
): SpeechSpans {
  const origin = RationalTime.toSeconds(window.sourceStart);
  const perSecond = fps(window.canvas);
  const toFrames = (span: TimeRange): Interval => ({
    start: (RationalTime.toSeconds(span.start) - origin) * perSecond,
    end: (RationalTime.toSeconds(span.start) + RationalTime.toSeconds(span.duration) - origin) * perSecond,
  });
  const keepHalf = ((settings.keepPauseMs / 1000) * perSecond) / 2;
  const speech = merge(analysis.speech.map(toFrames).filter((span) => inside(span, window.frames)));
  const fillers = settings.fillers
    ? analysis.fillers.map((filler) => toFrames(filler.range)).filter((span) => inside(span, window.frames))
    : [];
  const pauses = settings.pauses
    ? analysis.pauses
        .filter((pause) => RationalTime.toSeconds(pause.range.duration) * 1000 > settings.pauseThresholdMs)
        .map((pause) => toFrames(pause.range))
        .map((span) => ({ start: span.start + keepHalf, end: span.end - keepHalf }))
        .filter((span) => span.end > span.start && inside(span, window.frames))
    : [];
  const retakes = settings.retakes
    ? analysis.retakes.map((retake) => toFrames(retake.earlier)).filter((span) => inside(span, window.frames))
    : [];
  const fillerWords = new Set(
    analysis.fillers.flatMap((filler) => (filler.wordIndex === null ? [] : [filler.wordIndex])),
  );
  const words = analysis.words.map((word) => toFrames(word.range));
  const kept = new Set<number>();
  words.forEach((word, index) => {
    if (!inside(word, window.frames)) return;
    if (settings.fillers && fillerWords.has(index)) return;
    const middle = { start: (word.start + word.end) / 2, end: (word.start + word.end) / 2 + 1e-9 };
    if (retakes.some((take) => covered(middle, [take]) > 0)) return;
    kept.add(index);
  });
  const ambiguous = analysis.ambiguous
    .map((entry) => toFrames(entry.range))
    .filter((span) => inside(span, window.frames));
  return {
    speechFrames: covered({ start: 0, end: window.frames }, speech),
    fillers,
    pauses,
    retakes,
    keptWords: [...[...kept].flatMap((index) => words[index] ?? []), ...ambiguous],
    emphasis: analysis.emphasis
      .filter((entry) => kept.has(entry.wordIndex))
      .map((entry) => ({ at: toFrames(entry.range), strength: entry.strength })),
  };
}

const EPSILON = 1e-6;

/** The removals once every padded kept word is out of them, on whole frames, none under `minFrames`. */
export function guardRemovals(
  candidates: readonly Interval[],
  keptWords: readonly Interval[],
  total: number,
  options: { readonly padFrames: number; readonly minFrames: number },
): Interval[] {
  const padded = keptWords.map((word) => ({
    start: word.start - options.padFrames,
    end: word.end + options.padFrames,
  }));
  const whole = subtract(candidates, padded)
    .map((span) => ({
      start: Math.max(0, Math.ceil(span.start - EPSILON)),
      end: Math.min(total, Math.floor(span.end + EPSILON)),
    }))
    .filter((span) => span.end - span.start >= options.minFrames);
  const pieces = complement(merge(whole), total).filter(
    (piece) => piece.end - piece.start >= options.minFrames || covered(piece, padded) > 0,
  );
  return complement(pieces, total);
}

/** A static punch-in about a face: just above the centre, unless the clip already follows its subject. */
export function punchReframe(current: ClipReframe | null, settings: CleanupSettings): ClipReframe {
  if (current && (current.mode === 'auto' || current.mode === 'subject'))
    return { ...current, scale: settings.punchScale };
  return { mode: 'centre', nudge: { x: 0, y: -0.1 }, scale: settings.punchScale };
}

export interface PunchInputs {
  readonly emphasis: SpeechSpans['emphasis'];
  readonly pieces: readonly Interval[];
  readonly words: readonly Interval[];
  readonly padFrames: number;
  readonly fps: number;
  readonly minFrames: number;
}

function between(previousEnd: number | null, nextStart: number, wanted: number, fallback: number): number {
  const low = previousEnd === null ? Number.NEGATIVE_INFINITY : Math.ceil(previousEnd);
  const high = Math.floor(nextStart);
  return low > high ? fallback : Math.min(high, Math.max(low, wanted));
}

function wordEnd(words: readonly Interval[], pad: number, from: number, limit: number): number | null {
  const ends = words.flatMap((word, index) => {
    const next = words[index + 1];
    const end = next
      ? between(word.end, next.start, Math.ceil(word.end + pad), Number.NaN)
      : Math.ceil(word.end + pad);
    return Number.isNaN(end) || end <= from || end > limit ? [] : [end];
  });
  return ends.length === 0 ? null : Math.max(...ends);
}

/** Punch-ins at strong emphasis, no sooner than `punchMinGapSeconds` apart, each at most `punchSeconds`. */
export function punchRanges(inputs: PunchInputs, settings: CleanupSettings): Interval[] {
  const { pieces, words, minFrames } = inputs;
  const out: Interval[] = [];
  const gap = settings.punchMinGapSeconds * inputs.fps;
  const longest = Math.round(settings.punchSeconds * inputs.fps);
  const strong = inputs.emphasis
    .filter((entry) => entry.strength >= settings.punchThreshold)
    .sort((a, b) => a.at.start - b.at.start);
  for (const entry of strong) {
    const piece = pieces.find(
      (candidate) => entry.at.start >= candidate.start && entry.at.start < candidate.end,
    );
    if (!piece) continue;
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
export function segments(pieces: readonly Interval[], punches: readonly Interval[]) {
  return pieces.flatMap((piece) => {
    const out: { span: Interval; punched: boolean }[] = [];
    let at = piece.start;
    for (const punch of punches.filter((each) => each.start >= piece.start && each.end <= piece.end)) {
      if (punch.start > at) out.push({ span: { start: at, end: punch.start }, punched: false });
      out.push({ span: punch, punched: true });
      at = punch.end;
    }
    if (at < piece.end) out.push({ span: { start: at, end: piece.end }, punched: false });
    return out;
  });
}
