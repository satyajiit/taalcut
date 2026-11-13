// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The nightly indexing benchmark's numbers (P2-L13, P2-Q4, gate criterion 10):
 * tools/evals indexes a sample library, then reads per-stage and total times
 * from the stage rows' `started_at` and `finished_at`.
 */
import type { LibraryDatabase } from '../db/database';

export interface StageTiming {
  readonly stage: string;
  /** Runs that finished done in the window. */
  readonly runs: number;
  /** Time spent in the stage's jobs, summed (they may overlap). */
  readonly totalMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
}

export interface PipelineTimings {
  readonly since: number;
  /** Assets with at least one stage finished in the window. */
  readonly assets: number;
  readonly stages: readonly StageTiming[];
  /** Wall clock from the first stage start to the last finish in the window (0 when nothing ran). */
  readonly wallMs: number;
  /** Assets with every stage done or skipped, for "the library is indexed" checks. */
  readonly completeAssets: number;
}

const percentile = (sorted: readonly number[], p: number) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;

export function pipelineTimings(db: LibraryDatabase, since: number): PipelineTimings {
  const rows = db.driver
    .prepare(
      `SELECT asset_id, stage, started_at, finished_at FROM asset_index_stages
       WHERE state = 'done' AND started_at IS NOT NULL AND finished_at >= ? AND finished_at >= started_at`,
    )
    .all(since) as { asset_id: string; stage: string; started_at: number; finished_at: number }[];
  const byStage = new Map<string, number[]>();
  for (const row of rows) {
    const list = byStage.get(row.stage) ?? [];
    list.push(row.finished_at - row.started_at);
    byStage.set(row.stage, list);
  }
  const stages = [...byStage.entries()]
    .map(([stage, list]) => {
      const sorted = [...list].sort((a, b) => a - b);
      const totalMs = sorted.reduce((sum, ms) => sum + ms, 0);
      return {
        stage,
        runs: sorted.length,
        totalMs,
        meanMs: Math.round(totalMs / sorted.length),
        p50Ms: percentile(sorted, 0.5),
        p95Ms: percentile(sorted, 0.95),
      };
    })
    .sort((a, b) => a.stage.localeCompare(b.stage));
  const first = Math.min(...rows.map((r) => r.started_at));
  const last = Math.max(...rows.map((r) => r.finished_at));
  const complete = db.driver
    .prepare(
      `SELECT COUNT(*) AS n FROM (SELECT asset_id FROM asset_index_stages GROUP BY asset_id
         HAVING SUM(state IN ('done', 'skipped')) = COUNT(*))`,
    )
    .get();
  return {
    since,
    assets: new Set(rows.map((r) => r.asset_id)).size,
    stages,
    wallMs: rows.length === 0 ? 0 : last - first,
    completeAssets: Number(complete?.n ?? 0),
  };
}
