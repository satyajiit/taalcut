// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library database read while the app indexes (a second, read-only
 * connection; the real renderer exposes no client to the test): stage rows
 * per state, failures with their errors, per-stage timings from the rows'
 * started_at and finished_at, and what indexing stored (facts, previews,
 * shots, transcripts, vectors, the two finish lines).
 */
import { libraryRows } from './library-rows';

function read<T>(userData: string, sql: string, ...params: (string | number)[]): T[] {
  return libraryRows(userData, sql, ...params) as T[];
}

export interface StageRow {
  readonly assetId: string;
  readonly fileName: string;
  readonly stage: string;
  readonly state: string;
  readonly reasonKey: string | null;
  readonly error: string | null;
  /** The job's own error, with the developer detail the stage row leaves out. */
  readonly jobError: string | null;
  readonly jobId: string | null;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
  readonly attempts: number;
  readonly jobState: string | null;
}

export function stageRows(userData: string): StageRow[] {
  return read<StageRow>(
    userData,
    `SELECT s.asset_id AS assetId, a.original_filename AS fileName, s.stage, s.state, s.reason_key AS reasonKey,
            s.error, j.error AS jobError, s.job_id AS jobId, s.started_at AS startedAt,
            s.finished_at AS finishedAt, s.attempts, j.state AS jobState
       FROM asset_index_stages s JOIN assets a ON a.id = s.asset_id LEFT JOIN jobs j ON j.id = s.job_id
      ORDER BY a.original_filename, s.stage`,
  );
}

export function assetCount(userData: string): number {
  return read<{ n: number }>(userData, 'SELECT count(*) AS n FROM assets')[0]?.n ?? 0;
}

const ACTIVE = new Set(['waiting', 'queued', 'running']);

/**
 * A description held for the model that describes (LIB1-FIX): the seed has no Qwen3.5 4B, and on a Mac with a
 * describing model the stage waits for it instead of storing `not_yet`. Nothing else is coming for it.
 */
const MODEL_MISSING = 'library.stage.modelMissing';
const heldForDescriber = (row: StageRow) =>
  row.stage === 'vision.describe' && row.state === 'waiting' && row.reasonKey === MODEL_MISSING;

export interface IndexProgress {
  readonly assets: number;
  readonly active: number;
  readonly done: number;
  readonly failed: readonly StageRow[];
  /** Descriptions held for the describing model, which the seed doesn't install. */
  readonly held: number;
  readonly settled: boolean;
}

export function indexProgress(userData: string, expectedAssets: number): IndexProgress {
  const rows = stageRows(userData);
  const assets = assetCount(userData);
  const held = rows.filter(heldForDescriber).length;
  const active = rows.filter((row) => ACTIVE.has(row.state)).length - held;
  const failed = rows.filter((row) => row.state === 'failed');
  return {
    assets,
    active,
    done: rows.filter((row) => row.state === 'done' || row.state === 'skipped').length,
    failed,
    held,
    settled: assets >= expectedAssets && rows.length > 0 && active === 0,
  };
}

export function describeFailures(rows: readonly StageRow[]): string {
  return rows
    .map((row) => {
      const raw = row.jobError ?? row.error;
      const error = raw ? (JSON.parse(raw) as { code?: string; detail?: string }) : {};
      return `${row.fileName} ${row.stage}: ${error.code ?? '?'} ${(error.detail ?? '').slice(0, 300)}`;
    })
    .join('\n');
}

/** What is still to finish, for a timeout's message: each stage row's state, reason and job state, by file. */
export function describePending(userData: string): string {
  const pending = stageRows(userData).filter((row) => ACTIVE.has(row.state));
  const counts = new Map<string, number>();
  for (const row of pending) {
    const key = `${row.stage} ${row.state}${row.reasonKey ? ` (${row.reasonKey})` : ''} job=${row.jobState ?? '-'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const lines = [...counts].map(([key, n]) => `  ${n} × ${key}`);
  return `${pending.length} stages still to finish:\n${lines.join('\n')}`;
}

export interface StageTiming {
  readonly stage: string;
  readonly runs: number;
  /** First start to last finish of the stage across the library. */
  readonly wallMs: number;
  /** Sum of each run's own time (runs overlap across pools). */
  readonly busyMs: number;
}

export function stageTimings(userData: string): StageTiming[] {
  return read<StageTiming>(
    userData,
    `SELECT stage, count(*) AS runs, max(finished_at) - min(started_at) AS wallMs,
            sum(finished_at - started_at) AS busyMs
       FROM asset_index_stages
      WHERE state = 'done' AND started_at IS NOT NULL AND finished_at IS NOT NULL
      GROUP BY stage ORDER BY min(started_at)`,
  );
}

/** First stage start to last stage finish, over the whole library. */
export function indexWallMs(userData: string): number {
  return (
    read<{ ms: number | null }>(
      userData,
      `SELECT max(finished_at) - min(started_at) AS ms FROM asset_index_stages WHERE started_at IS NOT NULL`,
    )[0]?.ms ?? 0
  );
}

export interface StoredAsset {
  readonly fileName: string;
  readonly kind: string;
  readonly language: string | null;
  readonly hasFacts: number;
  readonly thumbnails: number;
  readonly proxies: number;
  readonly shots: number;
  readonly analysed: number;
  readonly transcriptSegments: number | null;
  readonly transcriptLanguage: string | null;
}

export function storedAssets(userData: string): StoredAsset[] {
  return read<StoredAsset>(
    userData,
    `SELECT a.original_filename AS fileName, a.kind, a.language,
            (a.width IS NOT NULL) AS hasFacts,
            (SELECT count(*) FROM derived_files d WHERE d.asset_id = a.id AND d.kind = 'thumbnail') AS thumbnails,
            (SELECT count(*) FROM derived_files d WHERE d.asset_id = a.id AND d.kind = 'proxy') AS proxies,
            (SELECT count(*) FROM shots s WHERE s.asset_id = a.id) AS shots,
            (SELECT count(*) FROM shots s WHERE s.asset_id = a.id AND s.analysis IS NOT NULL) AS analysed,
            (SELECT json_array_length(t.transcript, '$.segments') FROM transcripts t WHERE t.asset_id = a.id)
              AS transcriptSegments,
            (SELECT t.language FROM transcripts t WHERE t.asset_id = a.id) AS transcriptLanguage
       FROM assets a ORDER BY a.original_filename`,
  );
}

/** Vectors in the active embedding space by item kind (frame, transcript, ocr, description). */
export function vectorKinds(userData: string, indexName: string): Record<string, number> {
  // A vec0 table needs sqlite-vec to read; its row-id shadow table is plain SQLite.
  const rows = read<{ kind: string; n: number }>(
    userData,
    `SELECT substr(id, 1, instr(id, ':') - 1) AS kind, count(*) AS n FROM "vec_${indexName}_rowids" GROUP BY kind`,
  );
  return Object.fromEntries(rows.map((row) => [row.kind, row.n]));
}

/**
 * Files whose two finish lines (IX-R1) aren't both stored, or are out of order (searchable after complete). A file
 * whose only unsettled stage is a description held for its model has no complete line yet, rightly (LIB1-FIX).
 */
export function openMilestones(userData: string): string[] {
  return read<{ fileName: string }>(
    userData,
    `SELECT a.original_filename AS fileName FROM assets a LEFT JOIN asset_index_state m ON m.asset_id = a.id
      WHERE m.searchable_at IS NULL OR m.searchable_at > m.complete_at
         OR (m.complete_at IS NULL AND EXISTS (
              SELECT 1 FROM asset_index_stages s WHERE s.asset_id = a.id AND s.state NOT IN ('done', 'skipped')
                AND NOT (s.stage = 'vision.describe' AND s.state = 'waiting' AND s.reason_key = '${MODEL_MISSING}')))
      ORDER BY a.original_filename`,
  ).map((row) => row.fileName);
}

/** Jobs by idempotency key, to show a stage didn't run twice. */
export function jobsByKey(userData: string): { key: string; runs: number }[] {
  return read<{ key: string; runs: number }>(
    userData,
    `SELECT idempotency_key AS key, count(*) AS runs FROM jobs WHERE idempotency_key IS NOT NULL
      GROUP BY idempotency_key`,
  );
}

export interface ForeignCommand {
  readonly name: string;
  readonly source: string;
  /** Epoch ms. */
  readonly at: number;
}

/**
 * Commands the test did not issue: it creates and starts a watched-folder import, so anything else in the
 * log came from outside it, such as a person or another agent clicking this window (IX-B5). Such a run's
 * window may not be on the Library, and its timing is not quiet.
 */
export function foreignCommands(userData: string): ForeignCommand[] {
  return read<ForeignCommand>(
    userData,
    `SELECT name, source, created_at AS at FROM commands WHERE name NOT IN ('library.addSource', 'imports.createDraft', 'imports.start') ORDER BY created_at`,
  );
}
