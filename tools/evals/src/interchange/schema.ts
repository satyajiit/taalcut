// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { jsonFiles, readJson } from '../files';
import { parseNamed } from '../schema';

const idSchema = z.string().min(1);

export const interchangeLabelSchema = z
  .object({
    caseId: idSchema,
    synthetic: z.boolean(),
    clipCount: z.number().int().min(1).max(200),
  })
  .strict();

export const interchangeFormatSchema = z
  .object({
    format: z.enum(['otio', 'fcpxml']),
    maxCutDeltaFrames: z.number().nonnegative(),
    externalStatus: z.enum(['ok', 'failed', 'not available']),
    externalDetail: z.string().min(1),
  })
  .strict();

export const interchangePredictionSchema = z
  .object({
    caseId: idSchema,
    formats: z.array(interchangeFormatSchema).min(1),
  })
  .strict();

export const interchangeLabelFileSchema = z.array(interchangeLabelSchema).min(1);
export const interchangePredictionFileSchema = z.array(interchangePredictionSchema).min(1);

export type InterchangeLabel = z.infer<typeof interchangeLabelSchema>;
export type InterchangePrediction = z.infer<typeof interchangePredictionSchema>;
export type InterchangeFormatScore = z.infer<typeof interchangeFormatSchema>;

function loadRows<T extends { caseId: string }>(
  dir: string,
  schema: z.ZodType<T[]>,
  what: string,
): Map<string, T> {
  const files = jsonFiles(dir);
  if (files.length === 0) throw new Error(`No interchange ${what} (*.json) in ${dir}`);
  const out = new Map<string, T>();
  for (const { name, path } of files) {
    for (const row of parseNamed(schema, readJson(path), path)) {
      if (out.has(row.caseId)) throw new Error(`${name}: duplicate caseId ${row.caseId}`);
      out.set(row.caseId, row);
    }
  }
  return out;
}

export function loadInterchangeLabels(dir: string): InterchangeLabel[] {
  return [...loadRows(dir, interchangeLabelFileSchema, 'labels').values()];
}

export function loadInterchangePredictions(dir: string): Map<string, InterchangePrediction> {
  return loadRows(dir, interchangePredictionFileSchema, 'predictions');
}
