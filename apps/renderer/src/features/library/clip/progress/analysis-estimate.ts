// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Roughly how long a clip's analysis has left (LIB1-PROG), from what this Mac knows: each step's usual length here
 * (`typicalMs`, the library's mean of recent runs) and, for a step that runs, how far its job says it has got. Pure.
 *
 * - A running step with a fraction of at least 5% has left what it took so far, scaled: elapsed × (1 − f) / f.
 *   Below that a fraction says too little, so it has its usual length less what has passed, never under a tenth of
 *   it (a step that overruns is still going).
 * - A step still to come has its usual length.
 * - The steps add up, though some run side by side: an upper bound, as the import's estimate is.
 * - Unknown when any step to come has never run on this Mac: a guess there would be a number made up. Steps held
 *   for a model or the original don't count: nothing runs until it arrives, and the page says so instead.
 */
import type { AssetDetail } from '@taalcut/core';
import { MODEL_REASON, ORIGINAL_REASON } from './analysis-groups';

type Stage = AssetDetail['stages'][number];

/** A fraction from the job's own reports reads as progress once it is this far. */
const TRUSTED_FRACTION = 0.05;

export interface StageClock {
  /** Now, epoch ms. */
  readonly now: number;
  /** The live fraction a stage's job last reported (job.progress), else the one the library saved. */
  readonly fractionOf: (stage: Stage) => number | null;
}

const heldStage = (stage: Stage) =>
  stage.state === 'waiting' && (stage.reasonKey === MODEL_REASON || stage.reasonKey === ORIGINAL_REASON);

/** One step's time left in ms, or null when this Mac can't say. 0 for a step settled or failed. */
export function stageLeftMs(stage: Stage, clock: StageClock): number | null {
  if (stage.state === 'done' || stage.state === 'skipped' || stage.state === 'failed') return 0;
  if (stage.state !== 'running') return stage.typicalMs ?? null;
  const elapsed = stage.startedAt !== undefined ? Math.max(0, clock.now - stage.startedAt) : null;
  const fraction = clock.fractionOf(stage);
  if (fraction !== null && fraction >= 1) return 0;
  if (fraction !== null && fraction >= TRUSTED_FRACTION && elapsed !== null)
    return (elapsed * (1 - fraction)) / fraction;
  if (stage.typicalMs === undefined) return null;
  const passed = elapsed ?? 0;
  return Math.max(stage.typicalMs - passed, stage.typicalMs * 0.1);
}

/** The time left for these steps together, or null when any step that will run has no estimate. */
export function timeLeftMs(stages: readonly Stage[], clock: StageClock): number | null {
  let total = 0;
  for (const stage of stages) {
    if (heldStage(stage)) continue;
    const left = stageLeftMs(stage, clock);
    if (left === null) return null;
    total += left;
  }
  return total;
}

/**
 * The estimate as people read it: ten seconds at least, then seconds in fives, then whole minutes,
 * always rounded up so it never says less than is left. Null below a second, where there is nothing worth saying.
 */
export function roundedLeftMs(ms: number): number | null {
  if (ms < 1000) return null;
  const seconds = Math.ceil(ms / 1000);
  if (seconds <= 10) return 10_000;
  if (seconds < 60) return Math.ceil(seconds / 5) * 5_000;
  return Math.ceil(seconds / 60) * 60_000;
}
