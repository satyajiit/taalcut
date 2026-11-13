// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { z } from 'zod';
import { jsonFiles, readJson } from '../files';
import { parseNamed } from '../schema';

const idSchema = z.string().min(1);

export const routerGoldenRunSchema = z
  .object({
    taskId: idSchema,
    promptTokens: z.number().nonnegative(),
    passed: z.boolean(),
    routerInputTokens: z.number().nonnegative().optional(),
  })
  .strict();

/** `golden.json`. `off` and `on` are both absent when no golden set was measured. */
export const routerLabelSchema = z
  .object({
    caseId: idSchema,
    synthetic: z.boolean(),
    off: z.array(routerGoldenRunSchema).optional(),
    on: z.array(routerGoldenRunSchema).optional(),
  })
  .strict()
  .refine((value) => (value.off === undefined) === (value.on === undefined), {
    message: 'off and on are set together',
  });

export const routerFamilySchema = z
  .object({
    family: idSchema,
    n: z.number().int().nonnegative(),
    matches: z.number().int().nonnegative(),
  })
  .strict();

/** Counts from `routerReport`: the scorer applies the bars, it does not re-pair events. */
export const routerPredictionSchema = z
  .object({
    caseId: idSchema,
    n: z.number().int().nonnegative(),
    matches: z.number().int().nonnegative(),
    families: z.array(routerFamilySchema),
    tokens: z
      .object({ full: z.number().nonnegative(), routed: z.number().nonnegative() })
      .strict()
      .nullable(),
    flips: z.number().int().nonnegative(),
    /** True when a golden set was given (equal success can be 1 only then). */
    measured: z.boolean(),
  })
  .strict();

export const routerLabelFileSchema = routerLabelSchema;
export const routerPredictionFileSchema = z.array(routerPredictionSchema).min(1);

export type RouterLabel = z.infer<typeof routerLabelSchema>;
export type RouterPrediction = z.infer<typeof routerPredictionSchema>;
export type RouterFamilyCount = z.infer<typeof routerFamilySchema>;

export function loadRouterLabel(dir: string): RouterLabel {
  return parseNamed(routerLabelSchema, readJson(join(dir, 'golden.json')), join(dir, 'golden.json'));
}

/** Event-log JSON arrays. `golden.json` is not a log. */
export function loadRouterLogFiles(dir: string): { name: string; events: unknown[] }[] {
  const logsDir = join(dir, 'logs');
  const files = jsonFiles(logsDir);
  if (files.length === 0) throw new Error(`No router logs (*.json) in ${logsDir}`);
  return files.map(({ name, path }) => {
    const events = parseNamed(z.array(z.unknown()), readJson(path), path);
    return { name, events };
  });
}

export function loadRouterPredictions(dir: string): Map<string, RouterPrediction> {
  const files = jsonFiles(dir);
  if (files.length === 0) throw new Error(`No router predictions (*.json) in ${dir}`);
  const out = new Map<string, RouterPrediction>();
  for (const { name, path } of files) {
    for (const row of parseNamed(routerPredictionFileSchema, readJson(path), path)) {
      if (out.has(row.caseId)) throw new Error(`${name}: duplicate caseId ${row.caseId}`);
      out.set(row.caseId, row);
    }
  }
  return out;
}
