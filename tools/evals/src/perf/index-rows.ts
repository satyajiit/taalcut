// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The indexing bench in the nightly results (IX-B4): a bench summary.json (`pnpm bench:index`, median of its
 * runs) becomes one row per number, in minutes per hour of footage, so the nightly baseline and its 10 % rule
 * apply to them like every other metric: `index-searchable-1h:<set>`, `index-complete-1h:<set>` and
 * `index-busy-1h:<set>:<stage>`. The same summary is checked against the indexing budgets, which warn.
 *
 * Only a whole bench stands for a night (IX-F3): every run asked for finished, measured and passed its e2e checks.
 * The bench keeps a failed run's numbers for whoever reads its summary; a night's median doesn't. A noisy run stays
 * in the median (design G) and its reasons go on every row, so the baseline and the 10 % rule see them.
 */
import { measuresOf, type Budgetable } from './bench/budgets';
import { metricRow, type PerfRunMeta } from './measure';
import type { PerfRow } from './schema';

/** A bench summary with its runs' accounting (absent in summaries written before the bench kept it). */
export interface NightlyBench extends Budgetable {
  readonly runsAsked?: number;
  readonly runsFinished?: number;
  readonly failedRuns?: readonly number[];
  readonly e2eFailedRuns?: readonly number[];
  readonly noisyRuns?: readonly { readonly run: number; readonly reasons: readonly string[] }[];
}

const runList = (runs: readonly number[]) => `run${runs.length === 1 ? '' : 's'} ${runs.join(', ')}`;

/** Why the summary can't be a night's number; empty when it can. */
export function unusableBench(summary: NightlyBench): string[] {
  const reasons: string[] = [];
  const { runsAsked, runsFinished, failedRuns = [], e2eFailedRuns = [] } = summary;
  if (runsAsked === undefined || runsFinished === undefined)
    reasons.push('it does not say how many runs finished');
  else if (runsFinished < runsAsked) reasons.push(`${runsFinished} of ${runsAsked} runs finished`);
  if (failedRuns.length > 0) reasons.push(`${runList(failedRuns)} measured nothing`);
  if (e2eFailedRuns.length > 0) reasons.push(`${runList(e2eFailedRuns)} failed the e2e checks`);
  return reasons;
}

export function indexRows(summary: NightlyBench, meta: PerfRunMeta): PerfRow[] {
  const unusable = unusableBench(summary);
  if (unusable.length > 0)
    throw new Error(`bench summary ${summary.label} can't be a nightly number: ${unusable.join('; ')}`);
  const measures = measuresOf(summary);
  if (measures === null) throw new Error(`bench summary ${summary.label} has no footage length`);
  const set = summary.footage;
  const noisy = (summary.noisyRuns ?? []).map((run) => `run ${run.run}: ${run.reasons.join(', ')}`);
  const minutes = (metric: string, value: number) =>
    metricRow(meta, { metric, unit: 'minutes', better: 'lower', value, noisy });
  const rows: PerfRow[] = [];
  if (measures.searchableMinPerHour !== null)
    rows.push(minutes(`index-searchable-1h:${set}`, measures.searchableMinPerHour));
  if (measures.completeMinPerHour !== null)
    rows.push(minutes(`index-complete-1h:${set}`, measures.completeMinPerHour));
  for (const [stage, value] of Object.entries(measures.stageBusyMinPerHour).sort(([a], [b]) =>
    a.localeCompare(b),
  ))
    rows.push(minutes(`index-busy-1h:${set}:${stage}`, value));
  return rows;
}
