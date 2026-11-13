// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** listen-pick's labels (the golden queries) and predictions (each query's top 5 bank sounds), as JSON files. */
import { z } from 'zod';
import { jsonFiles, readJson } from '../files';
import { parseNamed } from '../schema';
import { PICK_FAMILY_NAMES } from './families';

const family = z.enum(PICK_FAMILY_NAMES as [string, ...string[]]);

export const pickLabelSchema = z
  .object({
    caseId: z.string().min(1),
    query: z.string().min(1).max(300),
    families: z.array(family).min(1).max(3),
    from: z.string().min(1),
  })
  .strict();

const pickedSchema = z
  .object({ soundId: z.string().min(1), category: z.string().min(1), upstreamId: z.string().min(1) })
  .strict();

export const pickPredictionSchema = z
  .object({
    caseId: z.string().min(1),
    /** The product's ranking: calibrated audio z plus the name. */
    top: z.array(pickedSchema).max(5),
    /** The audio alone, for the report. */
    audioTop: z.array(pickedSchema).max(5),
    dtype: z.enum(['int8', 'fp16']),
  })
  .strict();

export type PickLabel = z.infer<typeof pickLabelSchema>;
export type PickPrediction = z.infer<typeof pickPredictionSchema>;
export type Picked = z.infer<typeof pickedSchema>;

function loadRows<T extends { caseId: string }>(
  dir: string,
  schema: z.ZodType<T[]>,
  what: string,
): Map<string, T> {
  const files = jsonFiles(dir);
  if (files.length === 0) throw new Error(`No listen-pick ${what} (*.json) in ${dir}`);
  const out = new Map<string, T>();
  for (const { name, path } of files)
    for (const row of parseNamed(schema, readJson(path), path)) {
      if (out.has(row.caseId)) throw new Error(`${name}: duplicate caseId ${row.caseId}`);
      out.set(row.caseId, row);
    }
  return out;
}

export function loadPickLabels(dir: string): PickLabel[] {
  return [...loadRows(dir, z.array(pickLabelSchema).min(1), 'labels').values()];
}

export function loadPickPredictions(dir: string): Map<string, PickPrediction> {
  return loadRows(dir, z.array(pickPredictionSchema).min(1), 'predictions');
}
