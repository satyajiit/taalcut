// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template search labels and predictions (LRN1-TPL). A query is what someone would type to find a template, with
 * the templates (files of one template library folder) they would call right; `kind` says what the query leans on:
 * the template's words, its meaning as a whole, or one slot. Labels live in
 * `labels/template-search/<library>/<queryId>.json`, predictions in `<out>/<library>/<queryId>.json`.
 */
import { z } from 'zod';
import { loadLabelRows, loadPredictionRows } from '../labelled-files';

const idSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id must be lowercase words separated by hyphens');

export const TEMPLATE_QUERY_KINDS = ['words', 'meaning', 'slot'] as const;
export type TemplateQueryKind = (typeof TEMPLATE_QUERY_KINDS)[number];

export const templateQuerySchema = z
  .object({
    queryId: idSchema,
    library: z.string().min(1),
    synthetic: z.boolean(),
    text: z.string().min(1).max(200),
    kind: z.enum(TEMPLATE_QUERY_KINDS),
    /** Template files of the library someone would call right. */
    relevant: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type TemplateQuery = z.infer<typeof templateQuerySchema>;

export const templateSearchPredictionSchema = z
  .object({
    queryId: idSchema,
    library: z.string().min(1),
    /** Template files, best first. */
    results: z.array(z.string().min(1)),
    degraded: z.enum(['keyword-only']).nullable(),
    fusion: z.string().min(1),
    /** The embedding space the template index was in. */
    space: z.string().min(1),
  })
  .strict();
export type TemplateSearchPrediction = z.infer<typeof templateSearchPredictionSchema>;

const keyOf = (row: { library: string; queryId: string }) => `${row.library}/${row.queryId}`;

/** The queries in a label folder: each `*.json` holds a list of them (labelled-files.ts). */
export const loadTemplateQueries = (dir: string): TemplateQuery[] =>
  loadLabelRows(dir, {
    what: 'template search queries',
    schema: z.array(templateQuerySchema),
    idOf: keyOf,
    idName: 'query',
  });

/** Predictions by `library/queryId`, from a folder of lists (predictTemplateSearch writes one, predictions.json). */
export const loadTemplateSearchPredictions = (dir: string): Map<string, TemplateSearchPrediction> =>
  loadPredictionRows(dir, {
    what: 'template search predictions',
    schema: z.array(templateSearchPredictionSchema),
    idOf: keyOf,
  });
