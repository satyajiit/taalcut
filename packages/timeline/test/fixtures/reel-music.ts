// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: a reel's measured bars, stated, for the length tools' tests. The owner's test reel is 470 frames at 30 a
 * second with a bar of 2.15 s (two bars: 129 frames), the first bar line at 1.5 s and the drop on the bar line at
 * 10.1 s, where the creator's slot ends. The measurement itself is @taalcut/audio's (its bars tests); the whole
 * chain from samples to the mixed sound is the desktop's long1 test.
 */
import { ok } from '@taalcut/core';
import type { ReelBars, ReelMusic, ReelMusicSource } from '../../src/tools/reel-music';

export const BAR_SECONDS = 2.15;
export const FIRST_BAR = 1.5;
export const REEL_SECONDS = 470 / 30;

export function steadyBars(overrides: Partial<ReelBars> = {}): ReelBars {
  const lines: number[] = [];
  for (let at = FIRST_BAR; at < REEL_SECONDS - 0.5; at += BAR_SECONDS)
    lines.push(Math.round(at * 1000) / 1000);
  return {
    seconds: REEL_SECONDS,
    steady: true,
    bpm: 111.63,
    beatSeconds: BAR_SECONDS / 4,
    beatsPerBar: 4,
    barSeconds: BAR_SECONDS,
    sure: { pulse: 0.82, onBeat: 0.97, bar: 0.74, meter: 0.31, firstBeat: 0.88 },
    measuredAcrossBeats: 16,
    bars: lines.map((at, index) => ({
      at,
      levelDb: at >= 10.1 ? -14.2 : -18.3,
      fromBarBefore: index === 0 ? null : at === 10.1 ? 9.4 : 1.2,
    })),
    changes: [{ at: 10.1, levelDb: 4.1, bandsDb: 9.4 }],
    ...overrides,
  };
}

/** Bars that were not found: no steady pulse, with the numbers that say so. */
export const UNSTEADY: ReelBars = {
  seconds: REEL_SECONDS,
  steady: false,
  why: 'The sound is 0.06 like itself one beat later (0.15 is needed).',
  bpm: null,
  beatSeconds: null,
  beatsPerBar: null,
  barSeconds: null,
  sure: { pulse: 0.06, onBeat: 0, bar: 0, meter: 0, firstBeat: 0 },
  measuredAcrossBeats: 0,
  bars: [],
  changes: [],
};

/** The port over stated bars; `seams` records each seam asked for as [reel time, seconds back]. */
export function reelMusicOf(bars: ReelBars = steadyBars()): {
  source: ReelMusicSource;
  seams: [number, number][];
} {
  const seams: [number, number][] = [];
  const music: ReelMusic = {
    bars,
    seam: (at, back) => {
      seams.push([Math.round(at * 1000) / 1000, Math.round(back * 1000) / 1000]);
      return { apartDb: 1.4, levelDb: -0.3, overSeconds: 0.25 };
    },
  };
  return { source: async () => ok(music), seams };
}
