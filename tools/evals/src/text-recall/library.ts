// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a stored library read as on-screen text (IX3-B1), from a library database the app wrote (each bench run keeps
 * its own as `index-library.sqlite`), opened read-only with plain SQLite: every shot of the files the eval scores,
 * with its time in the file and its stored `on_screen_text` (what search indexes). A library is refused, never
 * scored, when the number would not be the shipped pipeline's: a stage failed anywhere in it (as `predict:search`
 * refuses), a scored file is missing or its shots or on-screen text did not settle, or no OCR engine read anything
 * (a build without the mac helper stores no text, and 0 of 24 would be a setup fault scored as recall).
 */
import { DatabaseSync } from 'node:sqlite';
import { INDEX_STAGE_STATES, parseJsonWith } from '@taalcut/core';
import { z } from 'zod';

export interface StoredShot {
  readonly index: number;
  /** Seconds into the file. */
  readonly from: number;
  readonly to: number;
  /** The shot's stored on-screen text; empty when it has none. */
  readonly text: string;
}

export interface StoredText {
  readonly path: string;
  /** Each scored file's shots, in order. */
  readonly files: ReadonlyMap<string, readonly StoredShot[]>;
  /** OCR requests the library's `vision.ocr` rows report (null: rows from before the counters). */
  readonly ocrRequests: number | null;
}

export type LibraryRead =
  | { readonly kind: 'read'; readonly text: StoredText }
  | { readonly kind: 'refused'; readonly path: string; readonly reasons: readonly string[] };

/** The stages whose output this eval reads on each scored file. */
const READ_STAGES = ['vision.shots', 'vision.ocr'] as const;
const SETTLED = new Set(['done', 'skipped']);

const shotRowSchema = z.object({
  file: z.string(),
  idx: z.int().nonnegative(),
  start: z.number(),
  num: z.int().positive(),
  den: z.int().positive(),
  length: z.number(),
  lengthNum: z.int().positive(),
  lengthDen: z.int().positive(),
  text: z.string().nullable(),
});

const stageRowSchema = z.object({
  file: z.string(),
  stage: z.string(),
  state: z.enum(INDEX_STAGE_STATES),
  reason: z.string().nullable(),
  error: z.string().nullable(),
  output: z.string().nullable(),
});
type StageRow = z.output<typeof stageRowSchema>;

/** `vision.ocr`'s stored output: only its OCR counters matter here (vision SPEC "Counters"). */
const ocrOutputSchema = z.looseObject({
  ocr: z.looseObject({ requests: z.int().nonnegative() }).optional(),
});

/** A failed row's error as the library stores it (a TaalcutError's JSON): its code, else the text itself. */
const errorSchema = z.looseObject({ code: z.string() });
const errorCode = (error: string | null) =>
  error === null ? 'no error stored' : (parseJsonWith(errorSchema, error)?.code ?? error.slice(0, 120));

const columnNames = (db: DatabaseSync, table: string): string[] =>
  db
    .prepare('SELECT name FROM pragma_table_info(?)')
    .all(table)
    .map((row) => String(row.name));

function readShots(db: DatabaseSync): Map<string, StoredShot[]> {
  const rows = db
    .prepare(
      `SELECT a.original_filename AS file, s.index_in_asset AS idx, s.start_value AS start, s.start_rate_num AS num,
              s.start_rate_den AS den, s.duration_value AS length, s.duration_rate_num AS lengthNum,
              s.duration_rate_den AS lengthDen, s.on_screen_text AS text
         FROM shots s JOIN assets a ON a.id = s.asset_id ORDER BY a.original_filename, s.index_in_asset`,
    )
    .all()
    .map((row) => shotRowSchema.parse(row));
  const files = new Map<string, StoredShot[]>();
  for (const row of rows) {
    const from = (row.start * row.den) / row.num;
    const list = files.get(row.file) ?? [];
    files.set(row.file, list);
    list.push({
      index: row.idx,
      from,
      to: from + (row.length * row.lengthDen) / row.lengthNum,
      text: row.text?.trim() ?? '',
    });
  }
  return files;
}

function readStages(db: DatabaseSync): StageRow[] {
  return db
    .prepare(
      `SELECT a.original_filename AS file, st.stage AS stage, st.state AS state, st.reason_key AS reason,
              st.error AS error, st.output AS output
         FROM asset_index_stages st JOIN assets a ON a.id = st.asset_id ORDER BY a.original_filename, st.stage`,
    )
    .all()
    .map((row) => stageRowSchema.parse(row));
}

/** Why the library's text is not the shipped pipeline's, for the scored files; empty when it is. */
function refusals(
  stages: readonly StageRow[],
  shots: ReadonlyMap<string, unknown>,
  scored: readonly string[],
) {
  const reasons = stages
    .filter((row) => row.state === 'failed')
    .map((row) => `${row.stage} failed on ${row.file}: ${errorCode(row.error)}`);
  for (const file of scored) {
    if (!shots.has(file) && !stages.some((row) => row.file === file)) {
      reasons.push(`${file} is not in the library`);
      continue;
    }
    for (const stage of READ_STAGES) {
      const row = stages.find((candidate) => candidate.file === file && candidate.stage === stage);
      if (row === undefined) reasons.push(`${stage} never ran on ${file}`);
      else if (row.state === 'skipped')
        reasons.push(`${stage} skipped ${file} (${row.reason ?? 'no reason'})`);
      // A failed row is named above, with its error.
      else if (!SETTLED.has(row.state) && row.state !== 'failed')
        reasons.push(`${stage} on ${file} did not settle (${row.state})`);
    }
  }
  return reasons;
}

/** OCR requests summed over `vision.ocr`'s outputs; null when no output carries the counters. */
function ocrRequests(stages: readonly StageRow[]): number | null {
  const counts = stages
    .filter((row) => row.stage === 'vision.ocr' && row.output !== null)
    .map((row) => parseJsonWith(ocrOutputSchema, row.output ?? '')?.ocr?.requests)
    .filter((requests): requests is number => requests !== undefined);
  return counts.length === 0 ? null : counts.reduce((sum, requests) => sum + requests, 0);
}

/** Reads `path` for the files in `scored` (the manifest's files with on-screen lines). */
export function readStoredText(path: string, scored: readonly string[]): LibraryRead {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (!columnNames(db, 'shots').includes('on_screen_text'))
      return {
        kind: 'refused',
        path,
        reasons: ['its shots have no on-screen text column (an older library)'],
      };
    const shots = readShots(db);
    const stages = readStages(db);
    const reasons = refusals(stages, shots, scored);
    const requests = ocrRequests(stages);
    const anyText = [...shots.values()].some((list) => list.some((shot) => shot.text !== ''));
    if (requests === 0 || (requests === null && !anyText))
      reasons.push('no OCR engine read it (vision.ocr made no requests): indexed without the mac helper');
    if (reasons.length > 0) return { kind: 'refused', path, reasons };
    const files = new Map(scored.map((file) => [file, shots.get(file) ?? []]));
    return { kind: 'read', text: { path, files, ocrRequests: requests } };
  } finally {
    db.close();
  }
}
