// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The two finish lines per asset (IX-R1, core's index milestones), kept in
 * `asset_index_state` (`searchable_at`, `complete_at`) by the jobs process's
 * pipeline. An asset is searchable when every searchable stage that applies
 * to its kind is done or skipped, and complete when every stage is; the time
 * stored is the last of those stages' finishes (the job events' times), so
 * it doesn't depend on when the sweep noticed. A failed or missing row keeps
 * the line open. A kind no searchable stage applies to (a stage list from
 * before round IX, or a test's) becomes searchable when it is complete.
 *
 * A sweep compares the rows with what is stored and writes what changed. The
 * first looks at every asset and announces nothing: a backfill for assets
 * that got there before (indexed before round IX, or before a restart). Each
 * later one looks only at assets whose rows any process changed since the
 * previous sweep began (less a margin for other processes' late commits;
 * the `updated_at` index), and announces new arrivals in
 * `library.indexMilestone`. Losing a line (a re-index, a new stage) is
 * stored and never announced.
 */
import {
  checkIndexStageMilestones,
  indexStageMilestone,
  INDEX_MILESTONES,
  type AssetId,
  type AssetKind,
  type EventBus,
  type IndexMilestone,
  type IndexStageDefinition,
  type Result,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { SqlRow, SqlValue } from '../driver/types';
import { attemptWrite } from '../repositories/shared';
import { registerIndexStages } from './stage-registry';

export interface MilestoneTrackerDeps {
  readonly db: LibraryDatabase;
  readonly events: EventBus;
  /** The registered stages; checked with core's checkIndexStageMilestones (a bug throws). */
  readonly stages: readonly Pick<IndexStageDefinition, 'stage' | 'needs' | 'appliesTo' | 'milestone'>[];
  /** Rows changed this long before the previous sweep began are looked at again. Default 10 s. */
  readonly marginMs?: number;
}

export interface MilestoneSweep {
  /** Assets that reached each line in this sweep (announced, unless it was the first sweep). */
  readonly reached: Readonly<Record<IndexMilestone, readonly AssetId[]>>;
  /** How many assets lost a line in this sweep. */
  readonly cleared: number;
}

export interface MilestoneTracker {
  sweep(): Result<MilestoneSweep>;
}

/** At most this many ids per event (core's indexMilestoneEventSchema). */
const EVENT_IDS = 1000;
const DEFAULT_MARGIN_MS = 10_000;

interface Evaluated {
  readonly id: AssetId;
  readonly searchableAt: number | null;
  readonly completeAt: number | null;
  readonly openSearchable: number;
  readonly openAll: number;
  readonly searchableLast: number | null;
  readonly completeLast: number | null;
}

/**
 * Per candidate asset: its stored times, how many of the stages that apply to its kind are open (a missing row is
 * open), and the last finish among them. `want` is [kind, stage, searchable 0/1] for every registered stage.
 */
const evaluate = (candidates: string) => `
  WITH want AS MATERIALIZED (
    SELECT json_extract(value, '$[0]') AS kind, json_extract(value, '$[1]') AS stage,
      json_extract(value, '$[2]') AS searchable
    FROM json_each(?))
  SELECT a.id AS id, m.searchable_at AS searchableAt, m.complete_at AS completeAt,
    SUM(w.searchable = 1 AND coalesce(x.state NOT IN ('done', 'skipped'), 1)) AS openSearchable,
    SUM(coalesce(x.state NOT IN ('done', 'skipped'), 1)) AS openAll,
    MAX(CASE WHEN w.searchable = 1 THEN x.finished_at END) AS searchableLast,
    MAX(x.finished_at) AS completeLast
  FROM assets a JOIN want w ON w.kind = a.kind
    LEFT JOIN asset_index_state m ON m.asset_id = a.id
    LEFT JOIN asset_index_stages x ON x.asset_id = a.id AND x.stage = w.stage
  WHERE a.id IN (${candidates})
  GROUP BY a.id`;

const EVERY_ASSET = evaluate('SELECT id FROM assets');
const CHANGED_SINCE = evaluate('SELECT asset_id FROM asset_index_stages WHERE updated_at >= ?');

const numberOrNull = (value: SqlValue | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

function evaluated(row: SqlRow): Evaluated {
  return {
    id: String(row.id) as AssetId,
    searchableAt: numberOrNull(row.searchableAt),
    completeAt: numberOrNull(row.completeAt),
    openSearchable: Number(row.openSearchable ?? 0),
    openAll: Number(row.openAll ?? 0),
    searchableLast: numberOrNull(row.searchableLast),
    completeLast: numberOrNull(row.completeLast),
  };
}

/**
 * The time to store: null while the line is open; else the last finish, or what is stored already (or now) when no
 * finish was recorded, so a sweep without new facts never moves it.
 */
function lineTime(open: number, last: number | null, stored: number | null, now: number): number | null {
  if (open > 0) return null;
  return last ?? stored ?? now;
}

type StageOfKind = readonly [kind: AssetKind, stage: string, searchable: 0 | 1];

/** [kind, stage, searchable] per stage and kind it applies to; a kind without a searchable stage counts them all. */
function wanted(stages: MilestoneTrackerDeps['stages']): StageOfKind[] {
  const rows = stages.flatMap((stage) =>
    stage.appliesTo.map((kind): StageOfKind => [
      kind,
      stage.stage,
      indexStageMilestone(stage) === 'searchable' ? 1 : 0,
    ]),
  );
  const searchableKinds = new Set(rows.filter((row) => row[2] === 1).map((row) => row[0]));
  return rows.map(([kind, stage, searchable]) => [kind, stage, searchableKinds.has(kind) ? searchable : 1]);
}

/**
 * Opens again the finish lines that reset stages count toward, at once for every process (stage-rows' `reset`, in
 * its transaction): complete always, searchable when a reset stage is a searchable one in the registry.
 * `stages.which` is a condition on `x.stage` taking one parameter, `stages.chosen`; `assetIds` is a JSON array.
 */
export function reopenMilestones(
  db: LibraryDatabase,
  assetIds: string,
  stages: { readonly which: string; readonly chosen: string },
): void {
  const { which, chosen } = stages;
  db.driver
    .prepare(
      `UPDATE asset_index_state AS m SET complete_at = NULL,
       searchable_at = CASE WHEN EXISTS (
         SELECT 1 FROM asset_index_stages x JOIN index_stages s ON s.stage = x.stage
         WHERE x.asset_id = m.asset_id AND s.milestone = 'searchable' AND ${which}) THEN NULL ELSE m.searchable_at END
       WHERE m.asset_id IN (SELECT value FROM json_each(?))
         AND (m.complete_at IS NOT NULL OR m.searchable_at IS NOT NULL)
         AND EXISTS (SELECT 1 FROM asset_index_stages x WHERE x.asset_id = m.asset_id AND ${which})`,
    )
    .run(chosen, assetIds, chosen);
}

/** Reached in this sweep: newly, or again after its stages ran anew (a later finish). */
const arrived = (before: number | null, after: number | null) =>
  after !== null && (before === null || after > before);

export function createMilestoneTracker(deps: MilestoneTrackerDeps): MilestoneTracker {
  const { db, events } = deps;
  checkIndexStageMilestones(deps.stages);
  const want = JSON.stringify(wanted(deps.stages));
  const margin = deps.marginMs ?? DEFAULT_MARGIN_MS;
  let lastStart: number | undefined;

  function announce(milestone: IndexMilestone, ids: readonly AssetId[]): void {
    for (let i = 0; i < ids.length; i += EVENT_IDS)
      events.emit('library.indexMilestone', { milestone, assetIds: ids.slice(i, i + EVENT_IDS) });
  }

  function store(rows: readonly Evaluated[]): MilestoneSweep {
    const now = db.clock();
    const reached: Record<IndexMilestone, AssetId[]> = { searchable: [], complete: [] };
    let cleared = 0;
    const write = db.driver.prepare(
      `INSERT INTO asset_index_state (asset_id, searchable_at, complete_at) VALUES (?, ?, ?)
       ON CONFLICT (asset_id) DO UPDATE SET searchable_at = excluded.searchable_at, complete_at = excluded.complete_at`,
    );
    db.transaction(() => {
      for (const row of rows) {
        const searchableAt = lineTime(row.openSearchable, row.searchableLast, row.searchableAt, now);
        const completeAt = lineTime(row.openAll, row.completeLast, row.completeAt, now);
        if (searchableAt === row.searchableAt && completeAt === row.completeAt) continue;
        write.run(row.id, searchableAt, completeAt);
        if (arrived(row.searchableAt, searchableAt)) reached.searchable.push(row.id);
        if (arrived(row.completeAt, completeAt)) reached.complete.push(row.id);
        if (
          (row.searchableAt !== null && searchableAt === null) ||
          (row.completeAt !== null && completeAt === null)
        )
          cleared++;
      }
    });
    return { reached, cleared };
  }

  return {
    sweep() {
      const started = db.clock();
      const first = lastStart === undefined;
      const swept = attemptWrite(db, 'asset', () => {
        const rows = first
          ? db.driver.prepare(EVERY_ASSET).all(want)
          : db.driver.prepare(CHANGED_SINCE).all(want, (lastStart ?? started) - margin);
        return store(rows.map(evaluated));
      });
      if (!swept.ok) return swept;
      lastStart = started;
      if (!first)
        for (const milestone of INDEX_MILESTONES) announce(milestone, swept.value.reached[milestone]);
      return swept;
    },
  };
}

/**
 * The pipeline's side (indexing-pipeline.ts): at start it registers the stage list other processes read
 * (stage-registry.ts) and runs the silent backfill sweep; after every step it sweeps again. Failures are logged:
 * the next step's sweep picks up what this one missed.
 */
export function createPipelineMilestones(
  deps: MilestoneTrackerDeps & { readonly log: (message: string) => void },
) {
  const tracker = createMilestoneTracker(deps);
  const logged = (what: string, result: Result<unknown>) => {
    if (!result.ok) deps.log(`${what}: ${result.error.code}`);
  };
  const sweep = () => logged('milestones', tracker.sweep());
  return {
    start(): void {
      logged('stage registry', registerIndexStages(deps.db, deps.stages));
      sweep();
    },
    sweep,
  };
}
