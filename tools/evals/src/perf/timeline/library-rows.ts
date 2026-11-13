// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a bench run's library copy (index-library.sqlite) says about indexing (IX-B2): every asset's stage
 * rows with the job that ran each (its kind, resource class, and when it was queued, started and finished),
 * the library-wide indexing jobs that have no stage row (duplicate grouping, the folder scan), the per-asset
 * `searchable_at` and `complete_at` once the ready lane stores them (any table with an asset key and
 * `searchable_at`), and the decode counters a stage job reports in its output (`decodes`, the decode lane).
 * Read-only, with plain SQLite: the copy may come from a newer or older schema than this checkout's.
 */
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { parseNamed } from '../../schema';
import {
  decodeCountsSchema,
  ocrCountsSchema,
  outputField,
  type DecodeCounts,
  type OcrCounts,
} from './stage-output';

export type { DecodeCounts, OcrCounts } from './stage-output';

const nullableNumber = z.number().nullable();

const rawStageRowSchema = z.object({
  assetId: z.string(),
  file: z.string(),
  assetKind: z.string(),
  stage: z.string(),
  state: z.string(),
  reason: z.string().nullable(),
  startedAt: nullableNumber,
  finishedAt: nullableNumber,
  jobId: z.string().nullable(),
  jobKind: z.string().nullable(),
  resource: z.string().nullable(),
  queuedAt: nullableNumber,
  jobStartedAt: nullableNumber,
  jobFinishedAt: nullableNumber,
  /** The job's claim-order key (IX design B), null before the sched lane's column exists or for a job without one. */
  orderKey: nullableNumber,
  /** The output's `decodes` and `ocr`, as SQLite's json_extract gives them; null without one. */
  decodesJson: z.union([z.string(), z.number()]).nullable(),
  ocrJson: z.union([z.string(), z.number()]).nullable(),
});

export interface StageRow extends Omit<z.output<typeof rawStageRowSchema>, 'decodesJson' | 'ocrJson'> {
  readonly decodes: DecodeCounts | null;
  /** The output had `decodes` in another shape (left out of the counts, and counted as such). */
  readonly decodesUnreadable: boolean;
  readonly ocr: OcrCounts | null;
  readonly ocrUnreadable: boolean;
}

function stageRow({ decodesJson, ocrJson, ...row }: z.output<typeof rawStageRowSchema>): StageRow {
  const decodes = outputField(decodesJson, decodeCountsSchema);
  const ocr = outputField(ocrJson, ocrCountsSchema);
  return {
    ...row,
    decodes: decodes.value,
    decodesUnreadable: decodes.unreadable,
    ocr: ocr.value,
    ocrUnreadable: ocr.unreadable,
  };
}

const libraryJobSchema = z.object({
  kind: z.string(),
  resource: z.string(),
  state: z.string(),
  queuedAt: z.number(),
  startedAt: nullableNumber,
  finishedAt: nullableNumber,
});
export type LibraryJob = z.output<typeof libraryJobSchema>;

export interface LibraryRows {
  readonly stages: readonly StageRow[];
  readonly libraryJobs: readonly LibraryJob[];
  /** Per asset id, when the ready lane's stored value exists; null before that lane lands. */
  readonly storedSearchableAt: ReadonlyMap<string, number | null> | null;
  /** The same for `complete_at`. */
  readonly storedCompleteAt: ReadonlyMap<string, number | null> | null;
}

function parsed<T>(schema: z.ZodType<T>, rows: unknown[], what: string): T[] {
  return parseNamed(z.array(schema), rows, what);
}

const stageSql = (orderKey: boolean, output: boolean) => `
  SELECT s.asset_id AS assetId, a.original_filename AS file, a.kind AS assetKind, s.stage, s.state,
         s.reason_key AS reason, s.started_at AS startedAt, s.finished_at AS finishedAt, s.job_id AS jobId,
         j.kind AS jobKind, j.resource_class AS resource, j.created_at AS queuedAt,
         j.started_at AS jobStartedAt, j.finished_at AS jobFinishedAt,
         ${orderKey ? 'j.order_key' : 'NULL'} AS orderKey,
         ${output ? "json_extract(s.output, '$.decodes')" : 'NULL'} AS decodesJson,
         ${output ? "json_extract(s.output, '$.ocr')" : 'NULL'} AS ocrJson
    FROM asset_index_stages s JOIN assets a ON a.id = s.asset_id LEFT JOIN jobs j ON j.id = s.job_id
   ORDER BY a.original_filename, s.stage`;

/** Jobs no stage row points at, queued from just before Add folder on (the scan starts with the click). */
const LIBRARY_JOB_SQL = `
  SELECT kind, resource_class AS resource, state, created_at AS queuedAt, started_at AS startedAt,
         finished_at AS finishedAt
    FROM jobs
   WHERE created_at >= ? AND id NOT IN (SELECT job_id FROM asset_index_stages WHERE job_id IS NOT NULL)
   ORDER BY created_at`;

const columnSchema = z.object({ name: z.string() });

function columnsOf(db: DatabaseSync, table: string): string[] {
  const quoted = `"${table.replaceAll('"', '""')}"`;
  return parsed(columnSchema, db.prepare(`PRAGMA table_info(${quoted})`).all(), `${table} columns`).map(
    (column) => column.name,
  );
}
const storedSchema = z.object({
  assetId: z.string(),
  searchableAt: nullableNumber,
  completeAt: nullableNumber,
});

type Stored = Pick<LibraryRows, 'storedSearchableAt' | 'storedCompleteAt'>;

function storedMilestones(db: DatabaseSync): Stored {
  const tables = parsed(
    z.object({ name: z.string() }),
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND coalesce(sql, '') NOT LIKE 'CREATE VIRTUAL TABLE%' ORDER BY name`,
      )
      .all(),
    'library tables',
  );
  for (const { name } of tables) {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    const columns = columnsOf(db, name);
    if (!columns.includes('searchable_at')) continue;
    const key = columns.includes('asset_id') ? 'asset_id' : name === 'assets' ? 'id' : undefined;
    if (key === undefined) continue;
    const complete = columns.includes('complete_at') ? 'complete_at' : 'NULL';
    const rows = parsed(
      storedSchema,
      db
        .prepare(
          `SELECT ${key} AS assetId, searchable_at AS searchableAt, ${complete} AS completeAt FROM ${quoted}`,
        )
        .all(),
      `${name}.searchable_at`,
    );
    return {
      storedSearchableAt: new Map(rows.map((row) => [row.assetId, row.searchableAt])),
      storedCompleteAt:
        complete === 'NULL' ? null : new Map(rows.map((row) => [row.assetId, row.completeAt])),
    };
  }
  return { storedSearchableAt: null, storedCompleteAt: null };
}

/** `since`: epoch ms of Add folder; library-wide jobs queued a little before it (clock skew) still count. */
export function readLibraryRows(path: string, since: number): LibraryRows {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      stages: parsed(
        rawStageRowSchema,
        db
          .prepare(
            stageSql(
              columnsOf(db, 'jobs').includes('order_key'),
              columnsOf(db, 'asset_index_stages').includes('output'),
            ),
          )
          .all(),
        `${path}: stage rows`,
      ).map(stageRow),
      libraryJobs: parsed(libraryJobSchema, db.prepare(LIBRARY_JOB_SQL).all(since - 5000), `${path}: jobs`),
      ...storedMilestones(db),
    };
  } finally {
    db.close();
  }
}
