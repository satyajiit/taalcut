// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Audio's speech analysis (core's SpeechCleanupAnalysis) seen through one clip (P3-V9): every range in the
 * clip's own frames (0 is its first frame on the timeline, canvas rate, fractional while planning), and sorted
 * into what may go (fillers, the long part of each long pause, the earlier take of each retake), the words that
 * stay, and the emphasis on them. Ambiguous words ("like", "so") always stay.
 */
import {
  RationalTime,
  TimeRange,
  type CleanupSettings,
  type FrameRate,
  type SpeechCleanupAnalysis,
  type TimeRange as Range,
} from '@taalcut/core';
import { covered, merge, type Interval } from '../model/intervals';

export interface ClipWindow {
  /** The clip's in-point at the media's rate. */
  readonly sourceStart: RationalTime;
  /** Its length on the timeline, canvas frames. */
  readonly frames: number;
  readonly canvas: FrameRate;
}

export interface SpeechSpans {
  /** Frames of the clip with speech in them. */
  readonly speechFrames: number;
  readonly fillers: readonly Interval[];
  /** The part of each pause over the threshold that goes (the pause less what is kept of it). */
  readonly pauses: readonly Interval[];
  /** Earlier takes of retakes. */
  readonly retakes: readonly Interval[];
  readonly keptWords: readonly Interval[];
  readonly emphasis: readonly { readonly at: Interval; readonly strength: number }[];
}

const fps = (rate: FrameRate) => rate.num / rate.den;

export function clipFrames(window: ClipWindow) {
  const origin = RationalTime.toSeconds(window.sourceStart);
  const perSecond = fps(window.canvas);
  return (range: Range): Interval => {
    const start = (RationalTime.toSeconds(range.start) - origin) * perSecond;
    const end = (RationalTime.toSeconds(TimeRange.end(range)) - origin) * perSecond;
    return { start, end };
  };
}

const inside = (interval: Interval, frames: number) => interval.end > 0 && interval.start < frames;

export function speechSpans(
  analysis: SpeechCleanupAnalysis,
  window: ClipWindow,
  settings: CleanupSettings,
): SpeechSpans {
  const toFrames = clipFrames(window);
  const msFrames = (ms: number) => (ms / 1000) * fps(window.canvas);
  const all = { start: 0, end: window.frames };
  const speech = merge(analysis.speech.map(toFrames).filter((span) => inside(span, window.frames)));

  const fillers = settings.fillers
    ? analysis.fillers.map((filler) => toFrames(filler.range)).filter((span) => inside(span, window.frames))
    : [];
  const keepHalf = msFrames(settings.keepPauseMs) / 2;
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

  const fillerWords = new Set(analysis.fillers.flatMap((filler) => (filler.wordIndex === null ? [] : [filler.wordIndex])));
  const words = analysis.words.map((word) => toFrames(word.range));
  const kept = new Set<number>();
  words.forEach((word, index) => {
    if (!inside(word, window.frames)) return;
    if (settings.fillers && fillerWords.has(index)) return;
    const middle = { start: (word.start + word.end) / 2, end: (word.start + word.end) / 2 + 1e-9 };
    if (retakes.some((take) => covered(middle, [take]) > 0)) return;
    kept.add(index);
  });
  const ambiguous = analysis.ambiguous.map((entry) => toFrames(entry.range)).filter((span) => inside(span, window.frames));

  return {
    speechFrames: covered(all, speech),
    fillers,
    pauses,
    retakes,
    keptWords: [...[...kept].map((index) => words[index] as Interval), ...ambiguous],
    emphasis: analysis.emphasis
      .filter((entry) => kept.has(entry.wordIndex))
      .map((entry) => ({ at: toFrames(entry.range), strength: entry.strength })),
  };
}
