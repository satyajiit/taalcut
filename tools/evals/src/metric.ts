// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CUT_TOLERANCE_FRAMES, matchCuts, type CutMatch } from './match';
import { type FrameRate, type GoldenReel, type PredictionReel } from './schema';

/** Share of true cuts that must match before a reel clears the breakdown bar. */
export const REEL_BAR = 0.9;

/**
 * Gate criterion 3: this share of reels must clear the per-reel bar
 * (cut times within 2 frames). The plan's "≥ 85% of the 50 reels".
 */
export const GATE3_REEL_SHARE = 0.85;

export interface CutScores {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  withinToleranceShare: number;
  meetsBar: boolean;
}

export interface ReelScore extends CutScores {
  reelId: string;
  synthetic: boolean;
  frameRate: FrameRate;
  truthCuts: number[];
  predictedCuts: number[];
  matches: CutMatch[];
  missedTruths: number[];
  unmatchedPredictions: number[];
}

export interface AggregateScore extends CutScores {
  reelsMeetingBar: number;
  reelCount: number;
  reelsMeetingBarShare: number;
}

/** Gate criterion 3 on the headline (share of reels at the per-reel bar). */
export interface Gate3 {
  criterion: 3;
  perReelBar: number;
  reelShareBar: number;
  reelsMeetingBarShare: number;
  pass: boolean;
  /** False when any reel is synthetic. Synthetic numbers are not a gate result. */
  claimed: boolean;
}

export interface EvalReport {
  toleranceFrames: number;
  bar: number;
  synthetic: boolean;
  gate3: Gate3;
  aggregate: AggregateScore;
  reels: ReelScore[];
}

/**
 * Precision is 1 when there are no predictions, recall is 1 when there are no
 * truths. Both empty is a perfect vacuous score. F1 is 0 when P and R are both 0.
 */
export function cutScores(tp: number, fp: number, fn: number): CutScores {
  const predicted = tp + fp;
  const truths = tp + fn;
  const precision = predicted === 0 ? 1 : tp / predicted;
  const recall = truths === 0 ? 1 : tp / truths;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const withinToleranceShare = truths === 0 ? 1 : tp / truths;
  return {
    tp,
    fp,
    fn,
    precision,
    recall,
    f1,
    withinToleranceShare,
    meetsBar: withinToleranceShare >= REEL_BAR,
  };
}

export function scoreReel(reel: GoldenReel, prediction: PredictionReel): ReelScore {
  if (prediction.reelId !== reel.reelId) {
    throw new Error(`Prediction ${prediction.reelId} does not match golden reel ${reel.reelId}`);
  }
  const matched = matchCuts(reel.cuts, prediction.cuts, CUT_TOLERANCE_FRAMES);
  return {
    reelId: reel.reelId,
    synthetic: reel.synthetic,
    frameRate: reel.frameRate,
    truthCuts: [...reel.cuts],
    predictedCuts: [...prediction.cuts],
    matches: matched.matches,
    missedTruths: matched.missedTruths,
    unmatchedPredictions: matched.unmatchedPredictions,
    ...cutScores(matched.matches.length, matched.unmatchedPredictions.length, matched.missedTruths.length),
  };
}

export function scoreAll(pairs: readonly { reel: GoldenReel; prediction: PredictionReel }[]): EvalReport {
  if (pairs.length === 0) throw new Error('No reels to score');
  const reels = pairs.map((pair) => scoreReel(pair.reel, pair.prediction));
  const tp = reels.reduce((sum, reel) => sum + reel.tp, 0);
  const fp = reels.reduce((sum, reel) => sum + reel.fp, 0);
  const fn = reels.reduce((sum, reel) => sum + reel.fn, 0);
  const reelsMeetingBar = reels.filter((reel) => reel.meetsBar).length;
  const reelsMeetingBarShare = reelsMeetingBar / reels.length;
  const synthetic = reels.some((reel) => reel.synthetic);
  return {
    toleranceFrames: CUT_TOLERANCE_FRAMES,
    bar: REEL_BAR,
    synthetic,
    gate3: {
      criterion: 3,
      perReelBar: REEL_BAR,
      reelShareBar: GATE3_REEL_SHARE,
      reelsMeetingBarShare,
      pass: reelsMeetingBarShare >= GATE3_REEL_SHARE,
      claimed: !synthetic,
    },
    aggregate: {
      ...cutScores(tp, fp, fn),
      reelsMeetingBar,
      reelCount: reels.length,
      reelsMeetingBarShare,
    },
    reels,
  };
}
