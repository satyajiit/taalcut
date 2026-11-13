// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { readJson } from '../files';
import { parseNamed } from '../schema';

const idSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'id must be lowercase words separated by hyphens');

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

export const castingShotSchema = z
  .object({
    asset: z.string().min(1),
    range: rangeSchema.optional(),
  })
  .strict();

const orderSchema = z
  .object({
    groups: z.record(z.string().min(1), z.array(castingShotSchema).min(1)),
    rules: z.array(z.object({ before: z.string().min(1), after: z.string().min(1) }).strict()),
  })
  .strict();

const templateSchema = z.union([
  z.object({ file: z.string().min(1) }).strict(),
  z
    .object({
      brief: z
        .object({
          text: z.string().min(1),
          formatId: z.string().min(1),
          targetSeconds: z.number().positive(),
        })
        .strict(),
    })
    .strict(),
]);

export const castingCaseSchema = z
  .object({
    caseId: idSchema,
    library: z.string().min(1),
    synthetic: z.boolean(),
    template: templateSchema,
    slots: z
      .array(
        z
          .object({
            slotIndex: z.number().int().nonnegative(),
            shotType: z.string().min(1).optional(),
            acceptable: z.array(castingShotSchema).min(1),
          })
          .strict(),
      )
      .min(1),
    order: orderSchema.nullable(),
  })
  .strict();

export const castingWeightsSchema = z
  .object({
    version: z.string().min(1),
    intent: z.number().min(0).max(1),
    motion: z.number().min(0).max(1),
    quality: z.number().min(0).max(1),
    subject: z.number().min(0).max(1),
    energy: z.number().min(0).max(1),
  })
  .strict();

const pickSchema = z
  .object({
    slotIndex: z.number().int().nonnegative(),
    asset: z.string().min(1),
    range: rangeSchema.optional(),
  })
  .strict();

export const castingPredictionSchema = z
  .object({
    caseId: idSchema,
    variants: z
      .array(
        z
          .object({
            picks: z.array(pickSchema),
            alternates: z.array(
              z
                .object({ slotIndex: z.number().int().nonnegative(), shots: z.array(castingShotSchema) })
                .strict(),
            ),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type CastingCase = z.infer<typeof castingCaseSchema>;
export type CastingOrder = NonNullable<CastingCase['order']>;
export type CastingPrediction = z.infer<typeof castingPredictionSchema>;
export type CastingWeightsFile = z.infer<typeof castingWeightsSchema>;

export function castingJsonSchema(): unknown {
  return z.toJSONSchema(castingCaseSchema);
}

function byName(left: { name: string }, right: { name: string }): number {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

/** Labels and predictions live in `labels/casting/<library>/<caseId>.json`. */
function walkJson(dir: string): { name: string; path: string }[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read ${dir}: ${message}`, { cause: error });
  }
  const found: { name: string; path: string }[] = [];
  for (const entry of [...entries].sort(byName)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkJson(path));
    else if (entry.isFile() && entry.name.endsWith('.json')) found.push({ name: entry.name, path });
  }
  return found;
}

export function loadCastingCases(dir: string): CastingCase[] {
  const files = walkJson(dir);
  if (files.length === 0) throw new Error(`No casting cases (*.json) in ${dir}`);
  const cases = files.map((file) => parseNamed(castingCaseSchema, readJson(file.path), file.path));
  const seen = new Set<string>();
  for (const item of cases) {
    const key = `${item.library}/${item.caseId}`;
    if (seen.has(key)) throw new Error(`Duplicate casting case ${key}`);
    seen.add(key);
  }
  return cases;
}

export function loadCastingPredictions(dir: string): Map<string, CastingPrediction> {
  const files = walkJson(dir);
  if (files.length === 0) throw new Error(`No casting predictions (*.json) in ${dir}`);
  const byId = new Map<string, CastingPrediction>();
  for (const file of files) {
    const row = parseNamed(castingPredictionSchema, readJson(file.path), file.path);
    if (byId.has(row.caseId)) throw new Error(`Duplicate prediction for ${row.caseId} (${file.path})`);
    byId.set(row.caseId, row);
  }
  return byId;
}

export function parseCastingWeights(input: unknown, label = 'casting weights'): CastingWeightsFile {
  return parseNamed(castingWeightsSchema, input, label);
}
