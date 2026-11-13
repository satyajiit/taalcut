// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Indexing progress (core's IndexingStatus and ImportStatus) read from the
 * stage rows alone, so any process with the database can answer it: the
 * jobs process for `indexing.status` and the `library.indexing` event, the
 * agent process for the `library.importStatus` tool. An asset counts once,
 * as failed (any stage failed), else active (one queued or running), else
 * done (all done or skipped), else waiting. A stage's rows that wait for their
 * model to download (model-missing.ts) are counted apart as well, so an import
 * can say what waits for a download (UX3-IDX). The ETA is each stage's mean
 * recent duration times what is left of it, summed: an upper bound, since
 * stages on different pools run side by side. `searchable` (round IX) counts
 * across those states: assets whose stored `searchable_at` is set
 * (asset_index_state, milestones.ts). Stage order and milestones come from the stages the
 * pipeline registered (stage-registry.ts) when the caller passes no order.
 */
import type { ImportStatus, IndexingStatus, JobId, SourceId } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { USER_IMPORTED_ASSET_SQL } from '../profile/filters';
import { MODEL_MISSING_REASON } from './model-missing';
import { ORIGINAL_OFFLINE } from './stage-rows';
import { milestoneOf, readStageRegistry } from './stage-registry';

/** SPEC's recommended stage order, for display when the caller has no definitions (the agent process). */
export const DEFAULT_STAGE_ORDER = [
  'library.hash',
  'media.normalise',
  'media.thumbnail',
  'vision.shots',
  'vision.analyse',
  'vision.ocr',
  'vision.embed',
  'vision.embedOcr',
  'audio.language',
  'audio.transcript',
  'vision.embedText',
  'media.proxy',
  'media.filmstrip',
  'media.previews',
  'vision.contactSheet',
  'vision.describe',
] as const;

export interface StatusOptions {
  /** Stage names in pipeline order (unknown ones follow, by name). Default: the registered order, else the SPEC's. */
  readonly order?: readonly string[];
  readonly paused: boolean;
  /** Always include this source (the importStatus tool asks about one). */
  readonly sourceId?: SourceId;
  /** Recent durations averaged per stage. Default 20. */
  readonly window?: number;
}

const HOUR = 3_600_000;
/** A Wi-Fi source that got a file this recently is still receiving. */
const RECEIVING_MS = 60_000;

interface Counts {
  assets: number;
  done: number;
  active: number;
  waiting: number;
  failed: number;
  searchable: number;
  /** LIB1-PROG: of `waiting`, the assets held for their model or their original. */
  held: number;
}
type AssetState = Exclude<keyof Counts, 'assets' | 'searchable' | 'held'>;
const zero = (): Counts => ({ assets: 0, done: 0, active: 0, waiting: 0, failed: 0, searchable: 0, held: 0 });

interface StateRow {
  s: AssetState;
  n: number;
  searchable: number | null;
  held: number | null;
}

function add(counts: Counts, row: StateRow): void {
  counts[row.s] = row.n;
  counts.assets += row.n;
  counts.searchable += row.searchable ?? 0;
  counts.held += row.held ?? 0;
}

/**
 * Per asset: its state, whether it is searchable, and (LIB1-PROG) whether a waiting asset is held: a row of it
 * waits for its model or its original, so nothing runs for it until that arrives. The milestone state is joined
 * after grouping (one lookup per asset, not per stage row).
 */
const ASSET_STATES = `
  SELECT g.asset_id AS asset_id, g.s AS s, m.searchable_at IS NOT NULL AS searchable,
    g.s = 'waiting' AND g.held > 0 AS held FROM (
    SELECT x.asset_id AS asset_id,
      CASE WHEN SUM(x.state = 'failed') > 0 THEN 'failed'
        WHEN SUM(x.state IN ('queued', 'running')) > 0 THEN 'active'
        WHEN SUM(x.state IN ('done', 'skipped')) = COUNT(*) THEN 'done'
        ELSE 'waiting' END AS s,
      SUM(x.state = 'waiting' AND x.reason_key IN ('${MODEL_MISSING_REASON}', '${ORIGINAL_OFFLINE}')) AS held
    FROM asset_index_stages x JOIN assets a ON a.id = x.asset_id
    WHERE a.trashed_at IS NULL AND ${USER_IMPORTED_ASSET_SQL} GROUP BY x.asset_id) g
  LEFT JOIN asset_index_state m ON m.asset_id = g.asset_id`;

/** Mean duration (ms) of each stage's latest finished runs. */
export function stageDurations(db: LibraryDatabase, window = 20): Map<string, number> {
  const rows = db.driver
    .prepare(
      `SELECT stage, AVG(ms) AS mean FROM (
         SELECT stage, finished_at - started_at AS ms,
           ROW_NUMBER() OVER (PARTITION BY stage ORDER BY finished_at DESC) AS n
         FROM asset_index_stages
         WHERE state = 'done' AND started_at IS NOT NULL AND finished_at >= started_at)
       WHERE n <= ? GROUP BY stage`,
    )
    .all(window) as { stage: string; mean: number }[];
  return new Map(rows.map((r) => [r.stage, r.mean]));
}

function orderStages(names: Iterable<string>, order: readonly string[]): string[] {
  const rank = (name: string) => {
    const i = order.indexOf(name);
    return i === -1 ? order.length : i;
  };
  return [...new Set(names)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function eta(stages: readonly { stage: string; left: number }[], durations: Map<string, number>) {
  const left = stages.reduce((sum, s) => sum + s.left, 0);
  if (left === 0) return 0;
  if (!stages.some((s) => s.left > 0 && durations.has(s.stage))) return null;
  return Math.round(stages.reduce((sum, s) => sum + (durations.get(s.stage) ?? 0) * s.left, 0));
}

export function indexingStatus(db: LibraryDatabase, options: StatusOptions): IndexingStatus {
  const now = db.clock();
  const registry = readStageRegistry(db);
  const order = options.order ?? (registry.order.length > 0 ? registry.order : DEFAULT_STAGE_ORDER);
  const durations = stageDurations(db, options.window);
  const all = <T>(text: string, ...params: (string | number)[]) =>
    db.driver.prepare(text).all(...params) as T[];

  const overall = zero();
  for (const r of all<StateRow>(
    `SELECT s, COUNT(*) AS n, SUM(searchable) AS searchable, SUM(held) AS held FROM (${ASSET_STATES}) GROUP BY s`,
  ))
    add(overall, r);
  const overallStages = all<{ stage: string; left: number }>(
    `SELECT x.stage AS stage, SUM(x.state IN ('waiting', 'queued', 'running')) AS left
     FROM asset_index_stages x JOIN assets a ON a.id = x.asset_id
     WHERE a.trashed_at IS NULL AND ${USER_IMPORTED_ASSET_SQL} GROUP BY x.stage`,
  );

  const located = `(SELECT DISTINCT asset_id, source_id FROM asset_locations)`;
  const counts = new Map<string, Counts>();
  for (const r of all<StateRow & { source_id: string }>(
    `SELECT l.source_id, st.s, COUNT(*) AS n, SUM(st.searchable) AS searchable, SUM(st.held) AS held
     FROM (${ASSET_STATES}) st JOIN ${located} l USING (asset_id) GROUP BY l.source_id, st.s`,
  )) {
    const c = counts.get(r.source_id) ?? zero();
    add(c, r);
    counts.set(r.source_id, c);
  }
  const stageRows = all<{
    source_id: string;
    stage: string;
    done: number;
    left: number;
    failed: number;
    model: number;
    recent: number;
  }>(
    `SELECT l.source_id, x.stage, SUM(x.state IN ('done', 'skipped')) AS done,
       SUM(x.state IN ('waiting', 'queued', 'running')) AS left, SUM(x.state = 'failed') AS failed,
       SUM(x.state = 'waiting' AND x.reason_key IS ?) AS model, SUM(x.finished_at >= ?) AS recent
     FROM asset_index_stages x JOIN ${located} l USING (asset_id) GROUP BY l.source_id, x.stage`,
    MODEL_MISSING_REASON,
    now - HOUR,
  );
  const running = all<{ source_id: string; job_id: JobId }>(
    `SELECT DISTINCT l.source_id, x.job_id FROM asset_index_stages x JOIN ${located} l USING (asset_id)
     WHERE x.state = 'running' AND x.job_id IS NOT NULL`,
  );
  const sources = all<{ id: SourceId; kind: string; scan_state: string; last_seen: number | null }>(
    `SELECT s.id, s.kind, s.scan_state,
       (SELECT MAX(first_seen_at) FROM asset_locations l WHERE l.source_id = s.id) AS last_seen
     FROM sources s ORDER BY s.created_at, s.id`,
  );

  const statuses: ImportStatus[] = [];
  for (const source of sources) {
    if (
      (source.kind === 'generated' || source.kind === 'bundled') &&
      source.id !== options.sourceId
    ) {
      continue;
    }
    const mine = stageRows.filter((r) => r.source_id === source.id);
    const busy = mine.some((r) => r.left > 0 || r.failed > 0 || r.recent > 0);
    if (!busy && source.scan_state !== 'scanning' && source.id !== options.sourceId) continue;
    const c = counts.get(source.id) ?? zero();
    const stages = orderStages(
      mine.filter((r) => r.done + r.left + r.failed > 0).map((r) => r.stage),
      order,
    )
      .slice(0, 16)
      .map((stage) => {
        const r = mine.find((m) => m.stage === stage)!;
        const model = r.model > 0 ? { waitingForModel: r.model } : {};
        return {
          stage,
          done: r.done,
          left: r.left,
          failed: r.failed,
          ...model,
          ...milestoneOf(registry, stage),
        };
      });
    const left = c.active + c.waiting;
    const state: ImportStatus['state'] =
      source.scan_state === 'scanning'
        ? 'scanning'
        : source.kind === 'wifi_import' && source.last_seen !== null && now - source.last_seen < RECEIVING_MS
          ? 'receiving'
          : left > 0
            ? options.paused
              ? 'paused'
              : 'indexing'
            : c.failed > 0 || source.scan_state === 'error'
              ? 'failed'
              : 'done';
    statuses.push({
      sourceId: source.id,
      state,
      counts: c,
      stages,
      etaMs: eta(stages, durations),
      jobIds: running
        .filter((r) => r.source_id === source.id)
        .map((r) => r.job_id)
        .slice(0, 64),
      updatedAt: now,
    });
    if (statuses.length === 200) break;
  }
  return {
    paused: options.paused,
    overall,
    sources: statuses,
    etaMs: eta(overallStages, durations),
    updatedAt: now,
  };
}
