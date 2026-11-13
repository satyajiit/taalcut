// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Depth-first feeding (round IX, design B). Runnable rows go to the queue by asset, not stage after stage,
 * and each job carries its asset's import order as its order key, so among queued jobs of one priority the
 * queue takes the earliest-imported file's work first: that file becomes searchable while later ones are
 * still in flight. Assets someone waits for (`indexing.prioritise`) still go first, and their jobs are
 * raised to high, which beats any order key.
 */
import type { RunnableStage, StagePlan } from './stage-rows';

export interface FeedCandidate {
  readonly plan: StagePlan;
  /** The stage's place in pipeline order: an asset's stages go to the queue in that order. */
  readonly stageIndex: number;
  readonly row: RunnableStage;
}

/** The job's order key: the asset's place in import order (stage-rows.ts `importOrder`). */
export function importOrderKey(row: RunnableStage): number {
  return row.importOrder;
}

/** Boosted assets first, then by import order, each asset's stages in pipeline order. */
export function byFeedOrder(now: number): (a: FeedCandidate, b: FeedCandidate) => number {
  const boosted = (c: FeedCandidate) => (c.row.boostedUntil !== null && c.row.boostedUntil > now ? 1 : 0);
  return (a, b) =>
    boosted(b) - boosted(a) || a.row.importOrder - b.row.importOrder || a.stageIndex - b.stageIndex;
}
