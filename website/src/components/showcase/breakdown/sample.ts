// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { DEFAULT_REEL_ID, reelById } from '#content/reels';
import { SAMPLE_ROLL } from '../auto-pick/roll';
import { toFrame } from '../timecode';

/**
 * The breakdown the reel-breakdown page shows: the hero's reel, read from #content/reels so the two pages agree. Its
 * slots are the reel's real shots (their times, and the cut the scene detector wasn't sure of), each named from what
 * its frames show; its music beats come from its audio. The text on screen is the reel's own: the two lines over its
 * first shot, timed by eye from its frames at a fifth of a second. Nothing here is invented: the reel's cuts are
 * hard cuts, so the plate shows no transitions until Taalcut's own breakdown (`timing: 'breakdown'`) lists some.
 */

export type Doubt = 'cut' | 'transition';

/** Text spans that overlap in time sit on rows of their own: each span's row, first fit, in order. */
export function textRows(texts: readonly TextSpan[]): number[] {
  const ends: number[] = [];
  return texts.map((t) => {
    const row = ends.findIndex((end) => end <= t.start);
    const at = row === -1 ? ends.length : row;
    ends[at] = t.end;
    return at;
  });
}

export interface SampleCut {
  readonly id: string;
  /** Seconds on the reel's clock. */
  readonly at: number;
  /** What Taalcut isn't sure of here (review-checks.ts: cutUnsure, cutMaybeTransition). */
  readonly doubt?: Doubt;
}

export interface SampleShot {
  /** The shot in two words: what its frames show (the roll's words for its clip). */
  readonly word: string;
  /** The camera-roll clip whose frames it shows (#content/reels). */
  readonly clipId: string;
}

export interface TextSpan {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export interface SampleBreakdown {
  readonly title: string;
  readonly duration: number;
  readonly tempo: number;
  readonly beats: readonly number[];
  readonly cuts: readonly SampleCut[];
  readonly shots: readonly SampleShot[];
  readonly texts: readonly TextSpan[];
}

/** The doubts in the app's own words (packages/ui/src/templates/review-checks.ts). */
export const DOUBT_WORDS: Record<Doubt, string> = {
  cut: 'Taalcut isn’t sure this is a cut',
  transition: 'This may be one shot with a whip pan, not a cut',
};

/** The reel's own text on screen: a question in a chat bubble over the first shot, and its answer (reference.mp4). */
const REEL_TEXTS = [
  ['How’s Vietnam?', 0, 5.5],
  ['Well…', 4.4, 5.5],
] as const;

export function sampleBreakdown(): SampleBreakdown {
  const reel = reelById(DEFAULT_REEL_ID);
  const { slots, durationSec: duration } = reel;
  const cuts = slots.slice(1).map((slot, i): SampleCut => ({
    id: `cut-${i + 1}`,
    at: toFrame(slot.start),
    ...(slot.uncertainCut ? { doubt: 'cut' as const } : {}),
  }));
  const shots = slots.map((slot, i): SampleShot => ({
    word: SAMPLE_ROLL.find((c) => c.id === slot.pick.clipId)?.short ?? `Shot ${i + 1}`,
    clipId: slot.pick.clipId,
  }));
  return {
    title: reel.title,
    duration,
    tempo: reel.tempo,
    beats: reel.beats,
    cuts,
    shots,
    texts: REEL_TEXTS.map(([text, start, end]) => ({
      text,
      start: Math.min(start, duration),
      end: Math.min(end, duration),
    })).filter((t) => t.end > t.start),
  };
}
