// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { loadLabelRows, loadPredictionRows } from '../labelled-files';
import { parseNamed } from '../schema';

const idSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id must be lowercase words separated by hyphens');

export const searchLanguageSchema = z.enum(['en', 'hi', 'es', 'pt-BR']);

const rangeSchema = z
  .object({
    startFrame: z.number().int().nonnegative(),
    endFrame: z.number().int().positive(),
  })
  .strict()
  .superRefine((range, ctx) => {
    if (range.endFrame <= range.startFrame) {
      ctx.addIssue({
        code: 'custom',
        path: ['endFrame'],
        message: 'endFrame must be greater than startFrame',
      });
    }
  });

export const searchShotSchema = z
  .object({
    asset: z.string().min(1),
    range: rangeSchema.optional(),
  })
  .strict();

const filtersSchema = z
  .object({
    orientation: z.enum(['landscape', 'portrait', 'square']).optional(),
    minFrames: z.number().int().nonnegative().optional(),
    maxFrames: z.number().int().positive().optional(),
    minQuality: z.number().min(0).max(1).optional(),
    capturedAfter: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    capturedBefore: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

/** One labelled query. A file is an array of these, one file per library. */
export const searchQuerySchema = z
  .object({
    queryId: idSchema,
    language: searchLanguageSchema,
    library: z.string().min(1),
    text: z.string().min(1),
    filters: filtersSchema.optional(),
    relevant: z.array(searchShotSchema).min(1),
    synthetic: z.boolean(),
  })
  .strict();

export const searchLabelFileSchema = z.array(searchQuerySchema).min(1);

export const searchPredictionSchema = z
  .object({
    queryId: idSchema,
    results: z.array(
      z
        .object({
          asset: z.string().min(1),
          range: rangeSchema,
        })
        .strict(),
    ),
  })
  .strict();

export type SearchQueryLabel = z.infer<typeof searchQuerySchema>;
export type SearchPrediction = z.infer<typeof searchPredictionSchema>;

export function searchJsonSchema(): unknown {
  return z.toJSONSchema(searchQuerySchema);
}

export function parseSearchQuery(input: unknown, label = 'search query'): SearchQueryLabel {
  return parseNamed(searchQuerySchema, input, label);
}

export function loadSearchLabels(dir: string): SearchQueryLabel[] {
  return loadLabelRows(dir, {
    what: 'search labels',
    schema: searchLabelFileSchema,
    idOf: (row) => row.queryId,
    idName: 'queryId',
  });
}

export function loadSearchPredictions(dir: string): Map<string, SearchPrediction> {
  // A file holds one prediction or a list of them.
  const schema = z
    .union([searchPredictionSchema, z.array(searchPredictionSchema)])
    .transform((data) => (Array.isArray(data) ? data : [data]));
  return loadPredictionRows(dir, { what: 'search predictions', schema, idOf: (row) => row.queryId });
}
