// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `bench:index compare A B`: two bench summaries side by side (IX-B1). Each number shows both medians, the
 * change, and whether the change is bigger than the noise: when the two runs' [min, max] ranges overlap,
 * the change is "within noise" and claims nothing.
 */
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { readJson } from '../../files';
import { parseNamed } from '../../schema';
import { benchFallbacksSchema, fallbacksCompareLine } from './fallbacks';
import { benchLayout } from './layout';
import { benchOcrSchema, withoutOcr } from './ocr';
import { HEADLINE_MEASURES, pick, row, shown } from './summary-markdown';
import { round, spreadSchema, type Spread } from './stats';

/** The fields compare reads; the rest of summary.json passes through unchecked. */
const comparableSchema = z.looseObject({
  v: z.literal(1),
  label: z.string(),
  tier: z.string(),
  footage: z.string(),
  runsFinished: z.int(),
  /** The runs' accounting (aggregate.ts); the nightly rows read it (index-rows.ts). */
  runsAsked: z.int().optional(),
  failedRuns: z.array(z.int()).optional(),
  e2eFailedRuns: z.array(z.int()).optional(),
  noisyRuns: z.array(z.object({ run: z.int(), reasons: z.array(z.string()) })).optional(),
  videoSeconds: z.number().nullable().optional(),
  headline: z.record(z.string(), spreadSchema),
  stages: z.array(z.object({ stage: z.string(), busyMs: spreadSchema, wallMs: spreadSchema })),
  /** Absent before the mac helper preflight. */
  ocr: benchOcrSchema.optional(),
  /** Absent before IX3-B4. */
  fallbacks: benchFallbacksSchema.optional(),
});

/** What compare reads of a summary.json (aggregate.ts's BenchSummary fits it). */
export type Comparable = z.output<typeof comparableSchema>;

/** A summary.json path, or a label under the bench root. */
export function readSummary(ref: string, benchRoot: string): Comparable {
  const path = ref.endsWith('.json') ? ref : benchLayout(benchRoot, ref).summaryJson;
  if (!existsSync(path)) throw new Error(`no bench summary at ${path}`);
  return parseNamed(comparableSchema, readJson(path), path);
}

export type Verdict = 'better' | 'worse' | 'within noise' | '–';

export function verdictOf(before: Spread | null, after: Spread | null, better: 'lower' | 'higher'): Verdict {
  if (before === null || after === null) return '–';
  const overlap = after.min <= before.max && before.min <= after.max;
  if (overlap) return 'within noise';
  const lower = after.median < before.median;
  return lower === (better === 'lower') ? 'better' : 'worse';
}

function change(before: Spread | null, after: Spread | null, scale: number, places: number): string[] {
  if (before === null || after === null) return ['–', '–'];
  const delta = (after.median - before.median) * scale;
  const percent =
    before.median === 0 ? '–' : `${round(((after.median - before.median) / before.median) * 100, 0)}%`;
  return [`${delta > 0 ? '+' : ''}${round(delta, places)}`, percent];
}

const range = (spread: Spread | null, scale: number, places: number) =>
  spread === null
    ? '–'
    : `${shown(spread.median, scale, places)} [${shown(spread.min, scale, places)}–${shown(spread.max, scale, places)}]`;

export function compareMarkdown(before: Comparable, after: Comparable): string {
  const lines = [
    `# Indexing bench: ${before.label} → ${after.label}`,
    '',
    `Before: ${before.tier} tier, ${before.footage}, ${before.runsFinished} runs. ` +
      `After: ${after.tier} tier, ${after.footage}, ${after.runsFinished} runs.`,
    before.tier !== after.tier || before.footage !== after.footage
      ? '**Different tier or footage: the numbers are not comparable.**'
      : withoutOcr(before.ocr) !== withoutOcr(after.ocr)
        ? `**${withoutOcr(before.ocr) ? before.label : after.label} ran without OCR (no mac helper): ` +
          'the numbers are not comparable.**'
        : 'Median [min–max]; a change whose ranges overlap is within noise.',
    fallbacksCompareLine(before.fallbacks, after.fallbacks),
    '',
    row(['Number', 'Before', 'After', 'Change', 'Change %', 'Verdict']),
    row(['---', '---', '---', '---', '---', '---']),
    ...HEADLINE_MEASURES.map((by) => {
      const a = pick(before, by);
      const b = pick(after, by);
      return row([
        by.name,
        range(a, by.scale, by.places),
        range(b, by.scale, by.places),
        ...change(a, b, by.scale, by.places),
        verdictOf(a, b, by.better),
      ]);
    }),
    '',
    '## Stage busy time (s)',
    '',
    row(['Stage', 'Before', 'After', 'Change', 'Change %', 'Verdict']),
    row(['---', '---', '---', '---', '---', '---']),
    ...[...new Set([...before.stages, ...after.stages].map((stage) => stage.stage))].map((name) => {
      const a = before.stages.find((stage) => stage.stage === name)?.busyMs ?? null;
      const b = after.stages.find((stage) => stage.stage === name)?.busyMs ?? null;
      return row([
        name,
        range(a, 1 / 1000, 1),
        range(b, 1 / 1000, 1),
        ...change(a, b, 1 / 1000, 1),
        verdictOf(a, b, 'lower'),
      ]);
    }),
  ];
  return `${lines.join('\n')}\n`;
}
