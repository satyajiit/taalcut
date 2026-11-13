// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { readJson } from '../../files';
import { sourceOf } from './digest';
import { parseWith } from './parse';
import { type EvalInput, type SearchLanguageRow, type SourceRef } from './types';

const SUITES = [
  'search',
  'casting',
  'render',
  'reframe',
  'variants',
  'voice',
  'router',
  'interchange',
  'cleanup',
] as const;

const metricSchema = z.looseObject({
  name: z.string(),
  value: z.number().finite(),
  better: z.enum(['higher', 'lower']),
});

const suiteSchema = z.looseObject({
  suite: z.enum(SUITES),
  synthetic: z.boolean(),
  metrics: z.array(metricSchema),
});

const SEARCH_LANGUAGES = ['overall', 'en', 'hi', 'es', 'pt-BR'] as const;

const searchSchema = z.looseObject({
  suite: z.literal('search'),
  synthetic: z.boolean(),
  metrics: z.array(metricSchema),
  languages: z.array(
    z.looseObject({
      language: z.enum(SEARCH_LANGUAGES),
      queries: z.number().int().nonnegative(),
      hitAt5: z.number().finite(),
    }),
  ),
});

/** The breakdown runner's report (FORMAT.md). Its headline is the share of reels at the per-reel bar. */
const breakdownSchema = z.looseObject({
  synthetic: z.boolean(),
  aggregate: z.looseObject({
    reelCount: z.number().int().nonnegative(),
    reelsMeetingBar: z.number().int().nonnegative(),
    withinToleranceShare: z.number().min(0).max(1),
  }),
  reels: z.array(z.looseObject({ missedTruths: z.array(z.number()) })),
});

function walkJson(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read ${dir}: ${message}`, { cause: error });
  }
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) paths.push(...walkJson(path));
    else if (entry.isFile() && entry.name.endsWith('.json')) paths.push(path);
  }
  return paths.sort();
}

function oneMetric(
  metrics: readonly { name: string; value: number }[],
  name: string,
  where: string,
): number | null {
  const found = metrics.filter((metric) => metric.name === name);
  if (found.length > 1) throw new Error(`${where} has more than one ${name} metric`);
  const metric = found[0];
  return metric === undefined ? null : metric.value;
}

function takeSearch(rows: SearchLanguageRow[], source: SourceRef, where: string): EvalInput['search'] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.language)) throw new Error(`${where} repeats language ${row.language}`);
    seen.add(row.language);
  }
  return { rows, source };
}

export function loadEvalReports(dir: string): EvalInput {
  const sources: SourceRef[] = [];
  let synthetic = false;
  let search: EvalInput['search'] = null;
  let casting: EvalInput['casting'] = null;
  let render: EvalInput['render'] = null;
  let breakdown: EvalInput['breakdown'] = null;

  for (const path of walkJson(dir)) {
    const value = readJson(path);
    const record = z.looseObject({ suite: z.string().optional() }).safeParse(value);
    if (!record.success) throw new Error(`${path} is not valid: ${record.error.message}`);
    if (record.data.suite !== undefined) {
      const suite = parseWith(suiteSchema, value, path);
      const source = sourceOf(path, suite.synthetic);
      sources.push(source);
      synthetic = synthetic || suite.synthetic;
      if (suite.suite === 'search') {
        if (search !== null) throw new Error(`${path} is a second search report`);
        const parsed = parseWith(searchSchema, value, path);
        search = takeSearch(parsed.languages, source, path);
      } else if (suite.suite === 'casting') {
        if (casting !== null) throw new Error(`${path} is a second casting report`);
        casting = { pickAcceptance: oneMetric(suite.metrics, 'pickAcceptance', path), source };
      } else if (suite.suite === 'render') {
        if (render !== null) throw new Error(`${path} is a second render report`);
        render = { qaFirstPass: oneMetric(suite.metrics, 'qaFirstPass', path), source };
      }
      continue;
    }
    const parsed = parseWith(breakdownSchema, value, path);
    if (breakdown !== null) throw new Error(`${path} is a second breakdown report`);
    const source = sourceOf(path, parsed.synthetic);
    sources.push(source);
    synthetic = synthetic || parsed.synthetic;
    breakdown = {
      reelsMeetingBar: parsed.aggregate.reelsMeetingBar,
      reels: parsed.aggregate.reelCount,
      cutShare: parsed.aggregate.withinToleranceShare,
      missedEmpty: parsed.reels.filter((reel) => reel.missedTruths.length === 0).length,
      source,
    };
  }

  return { kind: 'present', sources, synthetic, search, casting, render, breakdown };
}
