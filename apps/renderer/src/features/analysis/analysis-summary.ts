// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the window bar's analysis indicator says (LIB1-PROG), from the indexing status alone: how many clips are
 * being analysed (not the ones held for a model or their original: nothing runs for them), how far the work in
 * hand has got, which part of it takes the longest, and roughly how long is left. Pure, so it is tested apart.
 */
import type { IndexingStatus } from '@taalcut/core';
import { groupOf, type AnalysisGroupKey } from '../library/clip/progress/analysis-groups';
import { analysingCount } from '../library/import-summary';

export interface AnalysisSummary {
  /** Clips running or waiting their turn. */
  readonly count: number;
  /** Clips held for a model or their original. */
  readonly held: number;
  readonly paused: boolean;
  /** How far the steps in hand have got, 0..1: done over done and left, across the sources at work. */
  readonly fraction: number;
  /** The part with the most steps left that can run, when there is one. */
  readonly slowest: AnalysisGroupKey | null;
  /** The library's estimate, while it runs. */
  readonly etaMs: number | null;
}

export function summariseAnalysis(status: IndexingStatus | null): AnalysisSummary | null {
  if (!status) return null;
  const count = analysingCount(status);
  let done = 0;
  let total = 0;
  const left = new Map<AnalysisGroupKey, number>();
  for (const source of status.sources) {
    for (const stage of source.stages) {
      done += stage.done;
      total += stage.done + stage.left;
      const runnable = stage.left - (stage.waitingForModel ?? 0);
      if (runnable <= 0) continue;
      const group = groupOf(stage.stage);
      left.set(group, (left.get(group) ?? 0) + runnable);
    }
  }
  let slowest: AnalysisGroupKey | null = null;
  for (const [group, steps] of left)
    if (slowest === null || steps > (left.get(slowest) ?? 0)) slowest = group;
  return {
    count,
    held: status.overall.held ?? 0,
    paused: status.paused,
    fraction: total > 0 ? Math.min(1, done / total) : 0,
    slowest: count > 0 ? slowest : null,
    etaMs: status.paused ? null : status.etaMs,
  };
}
