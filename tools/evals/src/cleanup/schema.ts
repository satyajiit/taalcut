// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { jsonFiles, readJson } from '../files';
import { parseNamed } from '../schema';

const idSchema = z.string().min(1);

export const frameRangeSchema = z
  .object({
    start: z.number(),
    end: z.number(),
  })
  .strict()
  .refine((range) => range.end > range.start, { message: 'end must be after start' });

export const cleanupLabelSchema = z
  .object({
    caseId: idSchema,
    synthetic: z.boolean(),
    fps: z.number().int().positive(),
    clipFrames: z.number().int().positive(),
    fillers: z.array(frameRangeSchema),
    pauses: z.array(frameRangeSchema),
    /** Kept words. A filler that sits inside one of these is not removed. */
    words: z.array(frameRangeSchema),
  })
  .strict();

export const cleanupPredictionSchema = z
  .object({
    caseId: idSchema,
    removals: z.array(frameRangeSchema),
  })
  .strict();

export const cleanupLabelFileSchema = z.array(cleanupLabelSchema).min(1);
export const cleanupPredictionFileSchema = z.array(cleanupPredictionSchema).min(1);

export type FrameRange = z.infer<typeof frameRangeSchema>;
export type CleanupLabel = z.infer<typeof cleanupLabelSchema>;
export type CleanupPrediction = z.infer<typeof cleanupPredictionSchema>;

function loadRows<T extends { caseId: string }>(
  dir: string,
  schema: z.ZodType<T[]>,
  what: string,
): Map<string, T> {
  const files = jsonFiles(dir);
  if (files.length === 0) throw new Error(`No cleanup ${what} (*.json) in ${dir}`);
  const out = new Map<string, T>();
  for (const { name, path } of files) {
    for (const row of parseNamed(schema, readJson(path), path)) {
      if (out.has(row.caseId)) throw new Error(`${name}: duplicate caseId ${row.caseId}`);
      out.set(row.caseId, row);
    }
  }
  return out;
}

export function loadCleanupLabels(dir: string): CleanupLabel[] {
  return [...loadRows(dir, cleanupLabelFileSchema, 'labels').values()];
}

export function loadCleanupPredictions(dir: string): Map<string, CleanupPrediction> {
  return loadRows(dir, cleanupPredictionFileSchema, 'predictions');
}
