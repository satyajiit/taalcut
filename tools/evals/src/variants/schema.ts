// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { loadLabelRows, loadPredictionRows } from '../labelled-files';

const idSchema = z.string().min(1);

export const variantLabelSchema = z
  .object({
    caseId: idSchema,
    synthetic: z.boolean(),
    /** How many variants the case asks for. */
    count: z.number().int().min(2).max(5),
    /**
     * Acceptable shot ids per slot, in slot order. Absent when the case has no casting labels:
     * the report then omits pickAcceptance.
     */
    acceptable: z.array(z.array(idSchema).min(1)).min(1).optional(),
  })
  .strict();

export const variantRowSchema = z
  .object({
    id: idSchema,
    /** Picks inside the hook window, joined. Identical strings are the same hook. */
    hook: z.string(),
    /** Shot id (or `asset:<id>`) per slot, timeline order. */
    picks: z.array(idSchema).min(1),
  })
  .strict();

export const variantPredictionSchema = z
  .object({
    caseId: idSchema,
    variants: z.array(variantRowSchema).min(1),
  })
  .strict();

export const variantLabelFileSchema = z.array(variantLabelSchema).min(1);
export const variantPredictionFileSchema = z.array(variantPredictionSchema).min(1);

export type VariantLabel = z.infer<typeof variantLabelSchema>;
export type VariantRow = z.infer<typeof variantRowSchema>;
export type VariantPrediction = z.infer<typeof variantPredictionSchema>;

export function loadVariantLabels(dir: string): VariantLabel[] {
  return loadLabelRows(dir, {
    what: 'variant labels',
    schema: variantLabelFileSchema,
    idOf: (row) => row.caseId,
    idName: 'caseId',
  });
}

export function loadVariantPredictions(dir: string): Map<string, VariantPrediction> {
  return loadPredictionRows(dir, {
    what: 'variant predictions',
    schema: variantPredictionFileSchema,
    idOf: (row) => row.caseId,
  });
}
