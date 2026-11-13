// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { appendJsonLines, readJsonLines } from '../jsonl';
import { type GrowthScore } from './score';

export const NO_APP_WIRED = 'no app wired';

export type SoakMode = 'full' | 'smoke';
export type SoakVerdict = 'pass' | 'fail' | 'missing';

const growthSchema = z
  .object({
    process: z.string(),
    early: z.number(),
    late: z.number(),
    ratio: z.number().nullable(),
  })
  .strict();

/** One soak result. Append-only JSONL, one object per line, same idea as a perf row. */
export const soakResultSchema = z
  .object({
    v: z.literal(1),
    scenario: z.string(),
    mode: z.enum(['full', 'smoke']),
    startedAt: z.string(),
    finishedAt: z.string(),
    synthetic: z.boolean(),
    growth: z.array(growthSchema),
    integrityFailures: z.array(z.string()),
    verdict: z.enum(['pass', 'fail', 'missing']),
    detail: z.string(),
  })
  .strict();

export type SoakResult = z.infer<typeof soakResultSchema>;

export function parseSoakResult(value: unknown): SoakResult {
  return soakResultSchema.parse(value);
}

export function buildSoakResult(input: {
  scenario: string;
  mode: SoakMode;
  startedAt: string;
  finishedAt: string;
  synthetic: boolean;
  growth: GrowthScore;
  integrityFailures: readonly string[];
  scenarioFailures: readonly string[];
}): SoakResult {
  const reasons = [
    ...input.scenarioFailures,
    ...input.integrityFailures,
    ...(input.growth.verdict === 'pass' ? [] : input.growth.reasons),
  ];
  let verdict: SoakVerdict = 'pass';
  if (
    input.scenarioFailures.length > 0 ||
    input.integrityFailures.length > 0 ||
    input.growth.verdict === 'fail'
  ) {
    verdict = 'fail';
  } else if (input.growth.verdict === 'missing') {
    verdict = 'missing';
  }
  return parseSoakResult({
    v: 1,
    scenario: input.scenario,
    mode: input.mode,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    synthetic: input.synthetic,
    growth: input.growth.growth,
    integrityFailures: [...input.integrityFailures],
    verdict,
    detail: reasons.length === 0 ? 'ok' : reasons.join('; '),
  });
}

export function unwiredSoakResult(input: {
  scenario: string;
  mode: SoakMode;
  startedAt: string;
  finishedAt: string;
  synthetic: boolean;
}): SoakResult {
  return parseSoakResult({
    v: 1,
    scenario: input.scenario,
    mode: input.mode,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    synthetic: input.synthetic,
    growth: [],
    integrityFailures: [],
    verdict: 'missing',
    detail: NO_APP_WIRED,
  });
}

/** Append JSONL. One object per line, no pretty print. Creates parent directories. */
export function appendSoakResults(path: string, rows: readonly SoakResult[]): void {
  appendJsonLines(
    path,
    rows.map((row) => parseSoakResult(row)),
  );
}

/** Parse every non-empty line. A bad line throws and names its 1-based line number. */
export function readSoakResults(path: string): SoakResult[] {
  return readJsonLines(path, parseSoakResult);
}
