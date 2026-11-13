// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The label and prediction folders the evals read: every `*.json` in the folder holds a list of rows, each with
 * its id, checked with the eval's schema. An empty folder, or one id twice, stops the run with the eval's words.
 */
import type { z } from 'zod';
import { jsonFiles, readJson } from './files';
import { parseNamed } from './schema';

export interface RowFolder<T> {
  /** What the folder holds, as the error says it: "reframe labels". */
  readonly what: string;
  /** Each file's rows. */
  readonly schema: z.ZodType<T[]>;
  readonly idOf: (row: T) => string;
}

function filesIn(dir: string, what: string) {
  const files = jsonFiles(dir);
  if (files.length === 0) throw new Error(`No ${what} (*.json) in ${dir}`);
  return files;
}

/** Every row of every file, in file order; `idName` names the id in a duplicate's error ("clipId"). */
export function loadLabelRows<T>(dir: string, folder: RowFolder<T> & { readonly idName: string }): T[] {
  const rows = filesIn(dir, folder.what).flatMap((file) =>
    parseNamed(folder.schema, readJson(file.path), file.path),
  );
  const seen = new Set<string>();
  for (const row of rows) {
    const id = folder.idOf(row);
    if (seen.has(id)) throw new Error(`Duplicate ${folder.idName} ${id}`);
    seen.add(id);
  }
  return rows;
}

/** Every row by its id; a second prediction for one id names the file it came from. */
export function loadPredictionRows<T>(dir: string, folder: RowFolder<T>): Map<string, T> {
  const byId = new Map<string, T>();
  for (const file of filesIn(dir, folder.what)) {
    for (const row of parseNamed(folder.schema, readJson(file.path), file.path)) {
      const id = folder.idOf(row);
      if (byId.has(id)) throw new Error(`Duplicate prediction for ${id} (${file.path})`);
      byId.set(id, row);
    }
  }
  return byId;
}
