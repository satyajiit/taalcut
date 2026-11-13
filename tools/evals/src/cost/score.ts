// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { type SuiteEnvelope } from '../envelope';

/** Actual cost at or above this is judged as a percentage. Below it, as cents. */
export const COST_PERCENT_FLOOR_USD = 0.01;
export const COST_RELATIVE_BAND = 0.3;
export const COST_ABSOLUTE_BAND_USD = 0.003;

const recordedSchema = z
  .object({
    type: z.literal('estimate.recorded'),
    estimateId: z.string().min(1),
    stepId: z.string().min(1).optional(),
    toolCallId: z.string().min(1).optional(),
    estimate: z.object({ usd: z.number().nonnegative(), tokens: z.number().optional() }).strict(),
    lines: z
      .array(
        z
          .object({
            provider: z.string(),
            model: z.string(),
            usd: z.number().optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

const settledSchema = z
  .object({
    type: z.literal('estimate.settled'),
    estimateId: z.string().min(1),
    actual: z.object({ usd: z.number().nonnegative() }).strict(),
  })
  .strict();

const eventSchema = z.union([recordedSchema, settledSchema]);

export interface CostOutlier {
  estimateId: string;
  stepId: string | null;
  models: string[];
  estimateUsd: number;
  actualUsd: number;
  reason: string;
}

export interface CostReport {
  checked: number;
  pass: boolean;
  synthetic: boolean;
  outliers: CostOutlier[];
  envelope: SuiteEnvelope;
}

function eventsIn(value: unknown, path: string): z.infer<typeof eventSchema>[] {
  const list = Array.isArray(value) ? value : [value];
  return list.map((item, index) => {
    const parsed = eventSchema.safeParse(item);
    if (!parsed.success) throw new Error(`${path} event ${index} is not estimate.recorded or estimate.settled`);
    return parsed.data;
  });
}

export function loadRunEvents(dir: string): z.infer<typeof eventSchema>[] {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read run logs ${dir}: ${message}`, { cause: error });
  }
  if (names.length === 0) throw new Error(`No run logs (*.json) in ${dir}`);
  return names.flatMap((name) => eventsIn(JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown, name));
}

function withinBand(estimateUsd: number, actualUsd: number): { ok: boolean; reason: string } {
  const error = Math.abs(actualUsd - estimateUsd);
  if (actualUsd >= COST_PERCENT_FLOOR_USD) {
    const denom = estimateUsd === 0 ? actualUsd : estimateUsd;
    const relative = error / denom;
    return {
      ok: relative <= COST_RELATIVE_BAND,
      reason: `${(relative * 100).toFixed(1)}% off (band ±30%)`,
    };
  }
  return {
    ok: error <= COST_ABSOLUTE_BAND_USD,
    reason: `$${error.toFixed(4)} off (band ±$${COST_ABSOLUTE_BAND_USD} under $${COST_PERCENT_FLOOR_USD})`,
  };
}

export function scoreCostEvents(events: readonly z.infer<typeof eventSchema>[]): CostReport {
  const recorded = new Map<string, z.infer<typeof recordedSchema>>();
  const settled = new Map<string, z.infer<typeof settledSchema>>();
  for (const event of events) {
    if (event.type === 'estimate.recorded') recorded.set(event.estimateId, event);
    else settled.set(event.estimateId, event);
  }
  const outliers: CostOutlier[] = [];
  let checked = 0;
  for (const [id, record] of recorded) {
    const end = settled.get(id);
    if (end === undefined) {
      outliers.push({
        estimateId: id,
        stepId: record.stepId ?? null,
        models: record.lines.map((line) => line.model),
        estimateUsd: record.estimate.usd,
        actualUsd: Number.NaN,
        reason: 'no estimate.settled',
      });
      continue;
    }
    checked += 1;
    const band = withinBand(record.estimate.usd, end.actual.usd);
    if (!band.ok) {
      outliers.push({
        estimateId: id,
        stepId: record.stepId ?? null,
        models: record.lines.map((line) => line.model),
        estimateUsd: record.estimate.usd,
        actualUsd: end.actual.usd,
        reason: band.reason,
      });
    }
  }
  for (const [id, end] of settled) {
    if (!recorded.has(id)) {
      outliers.push({
        estimateId: id,
        stepId: null,
        models: [],
        estimateUsd: Number.NaN,
        actualUsd: end.actual.usd,
        reason: 'no estimate.recorded',
      });
    }
  }
  const pass = outliers.length === 0 && checked > 0;
  return {
    checked,
    pass,
    synthetic: false,
    outliers,
    envelope: {
      suite: 'cost',
      synthetic: false,
      claimed: checked > 0,
      gate: {
        id: 'X1',
        pass,
        detail: pass
          ? `${checked} estimates inside the band`
          : outliers.map((item) => `${item.estimateId} (${item.stepId ?? 'no step'}): ${item.reason}`).join('; '),
      },
      metrics: [
        { name: 'estimatesChecked', value: checked, better: 'higher' },
        { name: 'outliers', value: outliers.length, better: 'lower' },
      ],
    },
  };
}

export function scoreCostDir(dir: string): CostReport {
  return scoreCostEvents(loadRunEvents(dir));
}
