// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The runs of one bench label together (IX-B1): every headline number and every stage's busy and wall time
 * as median and spread over all runs that finished. Noisy runs stay in (never cherry-picked) and are named,
 * with why; failed runs are named too. Whether the bench read on-screen text is stated with it (ocr.ts).
 */
import type { BudgetReport } from './budgets';
import { benchFallbacks, type BenchFallbacks } from './fallbacks';
import type { OcrSetup } from './mac-helper';
import { benchOcr, type BenchOcr } from './ocr';
import type { FootageSet } from './options';
import type { BenchTier, MachineFacts } from './run-record';
import type { RunSummary } from './run-summary';
import { spreadOf, type Spread } from './stats';

export interface BenchSummary {
  readonly v: 1;
  readonly label: string;
  readonly createdAt: string;
  readonly tier: BenchTier;
  readonly footage: FootageSet | string;
  readonly videoSeconds: number | null;
  readonly files: number | null;
  readonly machine: MachineFacts | null;
  readonly tierAssessed: BenchTier | null;
  readonly runsAsked: number;
  readonly runsFinished: number;
  /** Runs that measured nothing (no index-bench.json). */
  readonly failedRuns: readonly number[];
  /** Runs whose e2e failed after measuring (a later check, e.g. search); their numbers count. */
  readonly e2eFailedRuns: readonly number[];
  readonly noisyRuns: readonly { readonly run: number; readonly reasons: readonly string[] }[];
  readonly headline: {
    readonly searchableMinPerHour: Spread | null;
    readonly completeMinPerHour: Spread | null;
    readonly elapsedMinPerHour: Spread | null;
    readonly jobsTreePeakBytes: Spread | null;
    readonly agentTreePeakBytes: Spread | null;
    readonly securityMeanCpuPercent: Spread | null;
    readonly securityMaxCpuPercent: Spread | null;
    readonly backgroundMeanCpuPercent: Spread | null;
    readonly backgroundMaxCpuPercent: Spread | null;
    readonly loadMean: Spread | null;
  };
  readonly stages: readonly {
    readonly stage: string;
    readonly busyMs: Spread | null;
    readonly wallMs: Spread | null;
  }[];
  /** Whether the app read on-screen text (the mac helper), as set up and as the runs show. */
  readonly ocr: BenchOcr;
  /** The app's CPU fallbacks by kind and the runs they showed in (IX3-B4). */
  readonly fallbacks: BenchFallbacks;
  readonly runs: readonly RunSummary[];
  /** The medians against index-budgets.json (IX-B4), added by the runner; null when there is no budget. */
  readonly budgets?: BudgetReport | null;
}

export interface AggregateInput {
  readonly label: string;
  readonly createdAt: string;
  readonly tier: BenchTier;
  readonly footage: FootageSet | string;
  readonly runsAsked: number;
  readonly runs: readonly RunSummary[];
  readonly failedRuns: readonly number[];
  readonly e2eFailedRuns: readonly number[];
  /** What the runner checked before the runs; null for a bench from before that check. */
  readonly ocrSetup: OcrSetup | null;
}

export function aggregateRuns(input: AggregateInput): BenchSummary {
  const { runs } = input;
  const first = runs[0];
  const of = (pick: (run: RunSummary) => number | null | undefined) => spreadOf(runs.map(pick));
  const stageNames = [...new Set(runs.flatMap((run) => run.stages.map((stage) => stage.stage)))];
  return {
    v: 1,
    label: input.label,
    createdAt: input.createdAt,
    tier: input.tier,
    footage: input.footage,
    videoSeconds: first?.footage.videoSeconds ?? null,
    files: first?.footage.files ?? null,
    machine: first?.machine ?? null,
    tierAssessed: first?.tier.assessed ?? null,
    runsAsked: input.runsAsked,
    runsFinished: runs.length,
    failedRuns: input.failedRuns,
    e2eFailedRuns: input.e2eFailedRuns,
    noisyRuns: runs
      .filter((run) => run.noise.noisy)
      .map((run) => ({ run: run.run, reasons: run.noise.reasons })),
    headline: {
      searchableMinPerHour: of((run) => run.searchableMinPerHour),
      completeMinPerHour: of((run) => run.completeMinPerHour),
      elapsedMinPerHour: of((run) => run.elapsedMinPerHour),
      jobsTreePeakBytes: of((run) => run.memory.jobs?.treePeakBytes),
      agentTreePeakBytes: of((run) => run.memory.agent?.treePeakBytes),
      securityMeanCpuPercent: of((run) => run.security?.meanPercent),
      securityMaxCpuPercent: of((run) => run.security?.maxPercent),
      backgroundMeanCpuPercent: of((run) => run.background?.meanPercent),
      backgroundMaxCpuPercent: of((run) => run.background?.maxPercent),
      loadMean: of((run) => run.load.mean),
    },
    stages: stageNames.map((stage) => {
      const rows = runs.map((run) => run.stages.find((row) => row.stage === stage));
      return {
        stage,
        busyMs: spreadOf(rows.map((row) => row?.busyMs)),
        wallMs: spreadOf(rows.map((row) => row?.wallMs)),
      };
    }),
    ocr: benchOcr(
      input.ocrSetup,
      runs.map((run) => run.ocr),
    ),
    // Summaries from before IX3-B4 have no field: not recorded.
    fallbacks: benchFallbacks(runs.map((run) => run.fallbacks ?? null)),
    runs,
  };
}
