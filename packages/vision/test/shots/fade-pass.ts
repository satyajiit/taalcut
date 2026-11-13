// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Synthetic analysis-pass documents for the fade tests: a mean luma and a luma spread per frame, scdet's score per
 * frame (low, or high on the frames given as hard changes), statistics samples every third frame, and the black runs
 * blackdetect would report, as grid frames.
 */
import type { PassAnalysis } from '../../src/analysis/frame-pass';

export const FPS = 30;
/** The statistics samples' spacing at 30 fps (10 a second). */
export const EVERY = 3;

interface PassScript {
  readonly frames: number;
  /** Mean luma of each frame, 0–255. */
  readonly luma: (frame: number) => number;
  /** Luma spread of each frame (standard deviation); by default a faded picture's, 0.3 × its mean (black is flat). */
  readonly std?: (frame: number) => number;
  /** Frames scdet scores as a sudden change (40); every other frame scores 1. */
  readonly hard?: readonly number[];
  /** blackdetect's runs, first and last black frame; undefined: a document from before IX3-D2. */
  readonly blackRuns?: readonly (readonly [number, number])[];
}

export function passDoc(script: PassScript): PassAnalysis {
  const hard = new Set(script.hard ?? []);
  const std = script.std ?? ((frame: number) => 0.3 * script.luma(frame));
  const samples = [];
  for (let index = 0; index < script.frames; index += EVERY)
    samples.push({
      index,
      laplacianVariance: 100,
      mean: script.luma(index),
      std: std(index),
      dark: 0,
      bright: 0,
      black: script.luma(index) < 10,
      dHash: '0000000000000000',
    });
  return {
    version: 1,
    longSide: 256,
    every: EVERY,
    coarseEvery: EVERY,
    frames: script.frames,
    fine: Array.from({ length: script.frames }, (_, frame): [number, number] => [
      hard.has(frame) ? 40 : 1,
      1,
    ]),
    coarse: [],
    black: [],
    freeze: [],
    ...(script.blackRuns
      ? {
          blackRuns: script.blackRuns.map(([from, to]) => ({ startSec: from / FPS, endSec: (to + 1) / FPS })),
        }
      : {}),
    samples,
    frameChange: [],
  };
}

/** A lit picture (100) that fades out over `out` frames to black at `black`, holds, and fades in over `inn`. */
export function fadeLuma(at: { black: number; hold: number; out: number; inn: number }, lit = 100) {
  return (frame: number): number => {
    const end = at.black + at.hold;
    if (frame < at.black - at.out) return lit;
    if (frame < at.black) return (lit * (at.black - frame)) / at.out;
    if (frame < end) return 0;
    if (frame < end + at.inn) return (lit * (frame - end + 1)) / at.inn;
    return lit;
  };
}
