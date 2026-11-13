// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Indexing budgets (IX-B4): per footage set and tier, the searchable and fully analysed minutes per hour of
 * footage and each stage's busy minutes per hour, kept in tools/evals/perf/index-budgets.json. A bench summary
 * is checked against them by its medians: within budget, over it but inside the file's stated tolerance, or
 * beyond the tolerance (and by more than the file's floor in minutes, so tiny stages do not warn on noise), which
 * warns. Budgets start from the IX baseline and only tighten: `bench:index budgets
 * <label> --write` lowers each budget to the label's median where that is lower, so a lane that made a stage
 * faster locks the gain in. `--reset` replaces them with the label's medians, for when the work measured changed
 * (the first baselines ran without the mac helper's OCR). Either takes only a bench that read on-screen text in
 * every run (ocr.ts).
 */
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { readJson, writeJson } from '../../files';
import { parseNamed } from '../../schema';
import { fallbackKeys, fallbacksBeyond, fallbacksRecorded, type BenchFallbacks } from './fallbacks';
import { fullOcr, type BenchOcr } from './ocr';
import { benchTierSchema } from './run-record';
import { minutesPerHour, round, type Spread } from './stats';

/** What a budget check reads of a bench summary (aggregate.ts's BenchSummary, or summary.json read by compare). */
export interface Budgetable {
  readonly label: string;
  readonly footage: string;
  readonly tier: string;
  readonly videoSeconds?: number | null;
  readonly headline: {
    readonly searchableMinPerHour?: Spread | null;
    readonly completeMinPerHour?: Spread | null;
  };
  readonly stages: readonly { readonly stage: string; readonly busyMs: Spread | null }[];
  /** Whether it read on-screen text; absent in summaries from before the mac helper preflight. */
  readonly ocr?: BenchOcr | null;
  /** The app's CPU fallbacks (IX3-B4); absent in summaries from before them. */
  readonly fallbacks?: BenchFallbacks | null;
}

const measuresSchema = z.object({
  searchableMinPerHour: z.number().positive().nullable(),
  completeMinPerHour: z.number().positive().nullable(),
  /** Busy minutes per hour of footage, by stage (each run's busy time summed over files). */
  stageBusyMinPerHour: z.record(z.string(), z.number().nonnegative()),
});

const budgetSchema = measuresSchema.extend({
  footage: z.string(),
  tier: benchTierSchema,
  /** The bench label the numbers last came from, and when they were set. */
  from: z.string(),
  setAt: z.string(),
  /**
   * The CPU fallback kinds (`<operation> (<reason>)`) the budget's bench had (IX3-B4): any other warns. Absent in
   * budgets set before them, which then check none.
   */
  cpuFallbacks: z.array(z.string()).optional(),
});
export type IndexBudget = z.output<typeof budgetSchema>;

export const budgetFileSchema = z.object({
  v: z.literal(1),
  /** How far past its budget a median may go before the bench warns, as a fraction (0.15 is 15 %). */
  tolerance: z.number().min(0).max(1),
  /** Minutes per hour a median must exceed its budget by, as well, before it warns (small stages are noisy). */
  floorMinPerHour: z.number().nonnegative().default(0.5),
  note: z.string().optional(),
  budgets: z.array(budgetSchema),
});
export type BudgetFile = z.output<typeof budgetFileSchema>;

export function readBudgetFile(path: string): BudgetFile | null {
  if (!existsSync(path)) return null;
  return parseNamed(budgetFileSchema, readJson(path), path);
}

export const writeBudgetFile = (path: string, file: BudgetFile): void => writeJson(path, file);

export const budgetFor = (file: BudgetFile | null, footage: string, tier: string): IndexBudget | null =>
  file?.budgets.find((budget) => budget.footage === footage && budget.tier === tier) ?? null;

export type BudgetVerdict = 'within' | 'over' | 'warn';

export interface BudgetCheck {
  /** `searchable`, `complete` or `busy <stage>`. */
  readonly measure: string;
  /** Minutes per hour of footage, the summary's median. */
  readonly value: number;
  readonly budget: number;
  /** (value − budget) / budget; negative is headroom. */
  readonly worseBy: number;
  readonly verdict: BudgetVerdict;
}

export interface BudgetReport {
  readonly footage: string;
  readonly tier: string;
  readonly from: string;
  readonly tolerance: number;
  readonly floorMinPerHour: number;
  readonly checks: readonly BudgetCheck[];
  /** CPU fallback kinds the budget's bench did not have; null when either side did not record them. */
  readonly newFallbacks: readonly string[] | null;
}

/** A summary's medians as minutes per hour: what a budget holds. */
export function measuresOf(summary: Budgetable): z.output<typeof measuresSchema> | null {
  const seconds = summary.videoSeconds;
  if (seconds === null || seconds === undefined || seconds <= 0) return null;
  const stageBusyMinPerHour: Record<string, number> = {};
  for (const stage of summary.stages)
    if (stage.busyMs !== null)
      stageBusyMinPerHour[stage.stage] = round(minutesPerHour(stage.busyMs.median, seconds), 2);
  return {
    searchableMinPerHour: summary.headline.searchableMinPerHour?.median ?? null,
    completeMinPerHour: summary.headline.completeMinPerHour?.median ?? null,
    stageBusyMinPerHour,
  };
}

function check(measure: string, value: number, budget: number, file: BudgetFile): BudgetCheck {
  const worseBy = budget === 0 ? (value > 0 ? Number.POSITIVE_INFINITY : 0) : (value - budget) / budget;
  const beyond = worseBy > file.tolerance && value - budget > file.floorMinPerHour;
  const verdict: BudgetVerdict = value <= budget ? 'within' : beyond ? 'warn' : 'over';
  return { measure, value, budget, worseBy: round(worseBy, 3), verdict };
}

/** The summary against its set's and tier's budget; null when there is none (or the summary has no footage length). */
export function checkBudgets(summary: Budgetable, file: BudgetFile | null): BudgetReport | null {
  const budget = budgetFor(file, summary.footage, summary.tier);
  const measures = measuresOf(summary);
  if (file === null || budget === null || measures === null) return null;
  const checks: BudgetCheck[] = [];
  const headline = [
    ['searchable', measures.searchableMinPerHour, budget.searchableMinPerHour],
    ['complete', measures.completeMinPerHour, budget.completeMinPerHour],
  ] as const;
  for (const [measure, value, limit] of headline)
    if (value !== null && limit !== null) checks.push(check(measure, value, limit, file));
  for (const [stage, value] of Object.entries(measures.stageBusyMinPerHour)) {
    const limit = budget.stageBusyMinPerHour[stage];
    if (limit !== undefined) checks.push(check(`busy ${stage}`, value, limit, file));
  }
  return {
    footage: budget.footage,
    tier: budget.tier,
    from: budget.from,
    tolerance: file.tolerance,
    floorMinPerHour: file.floorMinPerHour,
    checks,
    newFallbacks: fallbacksAgainst(budget, summary.fallbacks),
  };
}

/** The summary's fallback kinds the budget does not allow; null without a record on either side. */
function fallbacksAgainst(
  budget: IndexBudget,
  fallbacks: BenchFallbacks | null | undefined,
): string[] | null {
  if (budget.cpuFallbacks === undefined || !fallbacksRecorded(fallbacks)) return null;
  return fallbacksBeyond(fallbacks, budget.cpuFallbacks);
}

/**
 * The fallback kinds a budget allows after `summary`: its kinds when it recorded them in every run (only those the
 * old budget also allowed, unless `reset`); otherwise the old list.
 */
function allowedFallbacks(old: IndexBudget | null, summary: Budgetable): string[] | undefined {
  if (!fallbacksRecorded(summary.fallbacks)) return old?.cpuFallbacks;
  const kinds = fallbackKeys(summary.fallbacks);
  return old?.cpuFallbacks === undefined ? kinds : kinds.filter((key) => old.cpuFallbacks?.includes(key));
}

const lower = (old: number | null | undefined, next: number | null): number | null =>
  next === null ? (old ?? null) : old === null || old === undefined ? next : Math.min(old, next);

/**
 * The file with the summary's set and tier budget lowered to the summary's medians where those are lower (a new
 * stage gets its median; a stage the summary lacks keeps its budget). With no budget yet, or `reset`, the medians
 * become it. Throws for a summary that did not read on-screen text in every run.
 */
export function tightenBudgets(file: BudgetFile, summary: Budgetable, now: Date, reset = false): BudgetFile {
  const measures = measuresOf(summary);
  if (measures === null) throw new Error(`${summary.label} has no footage length; nothing to budget`);
  if (!fullOcr(summary.ocr))
    throw new Error(
      `${summary.label} did not read on-screen text in every run (no mac helper): budgets come only from ` +
        'benches with OCR',
    );
  const replaced = budgetFor(file, summary.footage, summary.tier);
  const old = reset ? null : replaced;
  const stages: Record<string, number> = { ...old?.stageBusyMinPerHour };
  for (const [stage, value] of Object.entries(measures.stageBusyMinPerHour))
    stages[stage] = lower(old?.stageBusyMinPerHour[stage], value) ?? value;
  const tier = benchTierSchema.parse(summary.tier);
  const fallbacks = allowedFallbacks(old, summary);
  const next: IndexBudget = {
    footage: summary.footage,
    tier,
    from: summary.label,
    setAt: now.toISOString(),
    searchableMinPerHour: lower(old?.searchableMinPerHour, measures.searchableMinPerHour),
    completeMinPerHour: lower(old?.completeMinPerHour, measures.completeMinPerHour),
    stageBusyMinPerHour: stages,
    ...(fallbacks === undefined ? {} : { cpuFallbacks: fallbacks }),
  };
  const others = file.budgets.filter((budget) => budget !== replaced);
  return { ...file, budgets: [...others, next] };
}

const percent = (fraction: number) =>
  Number.isFinite(fraction) ? `${fraction > 0 ? '+' : ''}${round(fraction * 100, 0)}%` : '+∞%';

/** The report as a markdown section (summary.md) and the warning lines the bench prints. */
export function budgetMarkdown(report: BudgetReport | null): string[] {
  if (report === null)
    return [
      '## Budgets',
      '',
      'No budget for this footage set and tier (tools/evals/perf/index-budgets.json).',
    ];
  return [
    '## Budgets',
    '',
    `${report.footage} at the ${report.tier} tier, from ${report.from}; minutes per hour of footage. ` +
      `Over budget by more than ${round(report.tolerance * 100, 0)}% and ${report.floorMinPerHour} min/h warns.`,
    '',
    '| Measure | Median | Budget | Change | Verdict |',
    '| --- | --- | --- | --- | --- |',
    ...report.checks.map(
      (item) =>
        `| ${item.measure} | ${item.value} | ${item.budget} | ${percent(item.worseBy)} | ${item.verdict} |`,
    ),
    '',
    report.newFallbacks === null
      ? 'CPU fallbacks: not checked (the budget or this bench has no record of them).'
      : report.newFallbacks.length === 0
        ? 'CPU fallbacks: none the budget’s bench did not have.'
        : `**CPU fallbacks the budget’s bench did not have: ${report.newFallbacks.join('; ')}.**`,
  ];
}

export const budgetWarnings = (report: BudgetReport | null): string[] => [
  ...(report?.checks ?? [])
    .filter((item) => item.verdict === 'warn')
    .map(
      (item) =>
        `${item.measure}: ${item.value} min/h is ${percent(item.worseBy)} over its budget of ${item.budget} ` +
        `(${report?.footage}, ${report?.tier})`,
    ),
  ...(report?.newFallbacks ?? []).map(
    (key) => `new CPU fallback ${key} (${report?.footage}, ${report?.tier}; its budget has none such)`,
  ),
];
