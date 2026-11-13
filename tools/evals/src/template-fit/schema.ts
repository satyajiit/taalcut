// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template fit labels and predictions (LRN1-TPL). A case is a footage set (clips of one library folder) and the
 * template it was shot for; a prediction is the fit's ranking of every template in that library, best first.
 * Labels live in `labels/template-fit/<library>/<caseId>.json`, predictions in `<out>/<library>/<caseId>.json`.
 */
import { z } from 'zod';
import { loadLabelRows, loadPredictionRows } from '../labelled-files';

const idSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id must be lowercase words separated by hyphens');

export const fitCaseSchema = z
  .object({
    caseId: idSchema,
    library: z.string().min(1),
    synthetic: z.boolean(),
    /** The footage set: clips of the library folder, as its manifest names them. */
    pool: z.array(z.string().min(1)).min(1),
    /** The template the footage was shot for: its file in the library folder. */
    best: z.string().min(1),
    note: z.string().optional(),
  })
  .strict();
export type FitCase = z.infer<typeof fitCaseSchema>;

export const fitRankSchema = z
  .object({
    template: z.string().min(1),
    slots: z.number().int().positive(),
    covered: z.number().int().nonnegative(),
    coverage: z.number().min(0).max(1),
    meanScore: z.number().nullable(),
  })
  .strict();
export type FitRank = z.infer<typeof fitRankSchema>;

export const fitPredictionSchema = z
  .object({
    caseId: idSchema,
    library: z.string().min(1),
    poolShots: z.number().int().nonnegative(),
    ranking: z.array(fitRankSchema),
  })
  .strict();
export type FitPrediction = z.infer<typeof fitPredictionSchema>;

const caseKey = (row: { library: string; caseId: string }) => `${row.library}/${row.caseId}`;

/** The footage sets in a label folder: each `*.json` holds a list of them (labelled-files.ts). */
export const loadFitCases = (dir: string): FitCase[] =>
  loadLabelRows(dir, {
    what: 'template fit cases',
    schema: z.array(fitCaseSchema),
    idOf: caseKey,
    idName: 'footage set',
  });

/** Predictions by `library/caseId`, from a folder of lists (predictFit writes one, predictions.json). */
export const loadFitPredictions = (dir: string): Map<string, FitPrediction> =>
  loadPredictionRows(dir, {
    what: 'template fit predictions',
    schema: z.array(fitPredictionSchema),
    idOf: caseKey,
  });
