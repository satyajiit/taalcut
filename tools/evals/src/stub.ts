// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type GoldenReel, type PredictionReel } from './schema';

/**
 * Deterministic stand-in for breakdown. Most cuts land within ±2 frames.
 * The second cut is pushed +3 (a miss) only when the reel has at least four
 * true cuts, so a short reel can clear the 90% bar and a mid-length one can miss it.
 * One extra cut is appended where it matches nothing.
 */
export function stubPrediction(reel: GoldenReel): PredictionReel {
  const duration = reel.source.durationFrames;
  const truth = reel.cuts;
  const injectMiss = truth.length >= 4;
  const predicted: number[] = [];
  truth.forEach((frame, index) => {
    let next = frame;
    if (injectMiss && index === 1) next = frame + 3;
    else if (index % 2 === 1) next = frame + 2;
    if (next < 0 || next >= duration) {
      throw new Error(`Stub cut ${next} falls outside reel ${reel.reelId} (duration ${duration})`);
    }
    predicted.push(next);
  });
  const extra = firstFreeFrame(truth, predicted, duration);
  if (extra !== null) predicted.push(extra);
  predicted.sort((a, b) => a - b);
  return { reelId: reel.reelId, cuts: predicted };
}

function firstFreeFrame(
  truth: readonly number[],
  predicted: readonly number[],
  duration: number,
): number | null {
  const occupied = [...truth, ...predicted];
  for (let frame = 0; frame < duration; frame += 1) {
    const blocked = occupied.some((other) => Math.abs(other - frame) <= 2);
    if (!blocked) return frame;
  }
  return null;
}
