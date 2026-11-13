// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The indexing bench (IX-B1): refuse to start under the free-space floor (disk-floor.ts, IX3-B5), check the mac
 * helper (on-screen text, mac-helper.ts) before anything else, build the test app once, index the footage `runs`
 * times through the indexing e2e at the forced tier, read each run (run-summary.json, the timeline), remove the Core
 * ML compiles each run created (compile-cleanup.ts, IX3-B5) and write the runs together as median and spread
 * (summary.json, summary.md), copied to the orchestration folder when asked.
 *
 * Run it under the machine's video-encoder lock; it starts nothing else heavy meanwhile.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeJson, writeText } from '../../files';
import { aggregateRuns, type BenchSummary } from './aggregate';
import { budgetWarnings, checkBudgets, type BudgetFile } from './budgets';
import {
  compileCleanupLine,
  compileCleanupOf,
  compilesSummaryLine,
  ownHelpers,
  removeRunCompiles,
  snapshotCompiles,
  watchHelpers,
  type CompileCache,
  type CompileSnapshot,
  type HelperSightings,
} from './compile-cleanup';
import { lowDisk, lowDiskMessage, type DiskSpace } from './disk-floor';
import { readRunFallbacks } from './fallbacks';
import { runTextRecall } from './text-recall';
import type { FootageProvider } from './footage';
import { benchLayout, RUN_FILES, type BenchLayout } from './layout';
import {
  macHelperEnv,
  preflightMacHelper,
  readOcrSetup,
  writeOcrSetup,
  type HelperProbe,
  type OcrSetup,
} from './mac-helper';
import { readTextShots } from './ocr';
import type { AnalyseOptions, RunOptions } from './options';
import { readProcessSamples, readRunRecord, type RunRecord } from './run-record';
import { summariseRun, type FinishLines, type RunSummary } from './run-summary';
import type { Shell, ShellStep } from './shell';
import { summaryMarkdown } from './summary-markdown';

export interface BenchDeps {
  readonly shell: Shell;
  /** The checkout the bench builds and runs. */
  readonly repoRoot: string;
  readonly footage: FootageProvider;
  readonly now: () => Date;
  readonly log: (line: string) => void;
  /** Reads a run's stage rows into its finish lines, writing timeline.json and timeline.md (perf/timeline). */
  readonly analyse: (runDir: string, record: RunRecord) => FinishLines | null;
  /** The indexing budgets (tools/evals/perf/index-budgets.json) the summary is checked against, if any. */
  readonly budgets?: () => BudgetFile | null;
  /** Runs the mac helper's `--version` (the preflight). */
  readonly helper: HelperProbe;
  /** Free space on the volumes the bench writes to (the floor, disk-floor.ts). */
  readonly disk: DiskSpace;
  /** The mac helper's Core ML compile cache: each run's own compiles are removed after it (compile-cleanup.ts). */
  readonly compiles: CompileCache;
}

export interface BenchOutcome {
  readonly summary: BenchSummary;
  readonly summaryPath: string;
  /** Runs without a measurement, and runs whose e2e failed after measuring. */
  readonly failedRuns: readonly number[];
  readonly e2eFailedRuns: readonly number[];
}

/** NO_COLOR off as in `env -u NO_COLOR`: Playwright and the builds print what they print. */
const QUIET_COLOUR = { NO_COLOR: undefined } as const;

async function build(deps: BenchDeps, layout: BenchLayout): Promise<void> {
  const steps = [
    { what: 'renderer', args: ['--filter', '@taalcut/renderer', 'build'], env: {} },
    {
      what: 'test app',
      args: ['--filter', '@taalcut/desktop', 'build'],
      env: { TAALCUT_BUILD_FLAVOUR: 'test' },
    },
  ];
  for (const step of steps) {
    deps.log(`[bench] building the ${step.what} (${layout.buildLog})`);
    const code = await deps.shell.run({
      command: 'pnpm',
      args: step.args,
      cwd: deps.repoRoot,
      env: { ...QUIET_COLOUR, ...step.env },
      log: layout.buildLog,
    });
    if (code !== 0)
      throw new Error(`building the ${step.what} failed (exit ${code}); see ${layout.buildLog}`);
  }
}

/** Reads one run's files into its summary and writes run-summary.json; null when the run measured nothing. */
export function analyseRun(
  runDir: string,
  run: number,
  deps: Pick<BenchDeps, 'analyse'>,
  ocr: OcrSetup | null,
): RunSummary | null {
  const recordPath = join(runDir, RUN_FILES.record);
  if (!existsSync(recordPath)) return null;
  const record = readRunRecord(recordPath);
  const processesPath = join(runDir, RUN_FILES.processes);
  const library = join(runDir, RUN_FILES.library);
  const summary = summariseRun({
    run,
    record,
    processes: existsSync(processesPath) ? readProcessSamples(processesPath) : [],
    finish: deps.analyse(runDir, record),
    textShots: existsSync(library) ? readTextShots(library) : null,
    helperExpected: ocr?.mode === 'helper',
    fallbacks: readRunFallbacks(join(runDir, RUN_FILES.fallbacks)),
    textRecall: runTextRecall(library, record.footage.dir),
  });
  writeJson(join(runDir, RUN_FILES.summary), summary);
  return summary;
}

function copySummary(layout: BenchLayout, copyTo: string, runs: readonly number[]): void {
  const target = join(copyTo, layout.label);
  mkdirSync(target, { recursive: true });
  copyFileSync(layout.summaryJson, join(target, 'summary.json'));
  copyFileSync(layout.summaryMarkdown, join(target, 'summary.md'));
  if (existsSync(layout.ocrSetup)) copyFileSync(layout.ocrSetup, join(target, 'ocr-setup.json'));
  for (const run of runs) {
    const from = layout.runDir(run);
    const to = join(target, `run-${run}`);
    mkdirSync(to, { recursive: true });
    for (const name of [
      RUN_FILES.record,
      RUN_FILES.summary,
      RUN_FILES.timeline,
      RUN_FILES.timelineMarkdown,
      RUN_FILES.compiles,
      RUN_FILES.fallbacks,
    ])
      if (existsSync(join(from, name))) copyFileSync(join(from, name), join(to, name));
  }
}

interface Finished {
  readonly label: string;
  readonly tier: RunOptions['tier'];
  readonly footage: string;
  readonly runsAsked: number;
  readonly summaries: readonly RunSummary[];
  readonly failedRuns: readonly number[];
  readonly e2eFailedRuns: readonly number[];
  readonly copyTo: string | null;
  readonly ocrSetup: OcrSetup | null;
}

function writeSummary(layout: BenchLayout, finished: Finished, deps: BenchDeps): BenchOutcome {
  const aggregated = aggregateRuns({
    label: finished.label,
    createdAt: deps.now().toISOString(),
    tier: finished.tier,
    footage: finished.footage,
    runsAsked: finished.runsAsked,
    runs: finished.summaries,
    failedRuns: finished.failedRuns,
    e2eFailedRuns: finished.e2eFailedRuns,
    ocrSetup: finished.ocrSetup,
  });
  const summary: BenchSummary = {
    ...aggregated,
    budgets: checkBudgets(aggregated, deps.budgets?.() ?? null),
  };
  for (const line of budgetWarnings(summary.budgets ?? null)) deps.log(`[bench] over budget: ${line}`);
  writeJson(layout.summaryJson, summary);
  const cleanups = [...finished.summaries.map((run) => run.run), ...finished.failedRuns]
    .sort((a, b) => a - b)
    .map((run) => ({ run, path: join(layout.runDir(run), RUN_FILES.compiles) }))
    .filter(({ path }) => existsSync(path))
    .map(({ run, path }) => ({ run, cleanup: compileCleanupOf(readJson(path)) }));
  writeText(layout.summaryMarkdown, `${summaryMarkdown(summary)}${compilesSummaryLine(cleanups)}`);
  if (finished.copyTo !== null)
    copySummary(
      layout,
      finished.copyTo,
      finished.summaries.map((run) => run.run),
    );
  deps.log(`[bench] ${layout.summaryMarkdown}`);
  return {
    summary,
    summaryPath: layout.summaryJson,
    failedRuns: finished.failedRuns,
    e2eFailedRuns: finished.e2eFailedRuns,
  };
}

/** The stall reports (`vt-stall-*.md`) in `dir`. */
const stallReports = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir).filter((name) => /^vt-stall-.*\.md$/.test(name)) : [];

interface Prepared {
  readonly ocr: OcrSetup;
  /** Every run's environment but its own folder (TAALCUT_PERF_DIR). */
  readonly env: ShellStep['env'];
}

/** A fresh label, the mac helper (before anything else: a bench without it must not start), footage, the build. */
async function prepare(options: RunOptions, deps: BenchDeps, layout: BenchLayout): Promise<Prepared> {
  if (existsSync(layout.labelDir) && readdirSync(layout.labelDir).length > 0)
    throw new Error(`${layout.labelDir} already holds a bench; pick another --label`);
  const low = lowDiskBefore(options, deps);
  if (low !== null) throw new Error(low);
  const ocr = await preflightMacHelper(deps.helper, deps.repoRoot, options.macHelper);
  deps.log(
    ocr.helper === null
      ? `[bench] without OCR: ${ocr.reason ?? 'no mac helper'}`
      : `[bench] mac helper ${ocr.helper.version}: ${ocr.helper.path}`,
  );
  mkdirSync(layout.labelDir, { recursive: true });
  writeOcrSetup(layout.ocrSetup, ocr);
  const footageEnv = await deps.footage.prepare(options.footage, layout, options.stallDir);
  if (options.build) await build(deps, layout);
  return {
    ocr,
    env: {
      ...QUIET_COLOUR,
      ...footageEnv,
      ...macHelperEnv(ocr, layout.labelDir),
      TAALCUT_INDEX_BENCH: '1',
      TAALCUT_TEST_HARDWARE_TIER: options.tier,
      TAALCUT_BENCH_WORK: layout.work,
      TAALCUT_VT_STALL_DIR: options.stallDir,
    },
  };
}

/** Why the bench may not run now (too little disk), or null. */
function lowDiskBefore(options: RunOptions, deps: BenchDeps): string | null {
  const low = lowDisk(deps.disk, [options.benchRoot, deps.compiles.root], options.minFreeGb);
  return low === null ? null : lowDiskMessage(low);
}

/**
 * Removes the compiles the run created and keeps what went (or why nothing did) in the run's folder. The run's own
 * mac helpers are the ones seen under the bench while it went, and the ones its app's process samples put under the
 * app (IX3-F10); every other helper seen during the run keeps the compiles in place.
 */
async function cleanCompiles(
  deps: BenchDeps,
  before: CompileSnapshot,
  runDir: string,
  run: number,
  helpers: HelperSightings,
) {
  const samples = join(runDir, RUN_FILES.processes);
  const app = ownHelpers(existsSync(samples) ? readProcessSamples(samples) : []);
  const own = [...new Set([...helpers.own, ...app])];
  const cleanup = await removeRunCompiles(deps.compiles, before, {
    end: deps.now().getTime(),
    own,
    seen: helpers.seen,
  });
  writeJson(join(runDir, RUN_FILES.compiles), cleanup);
  deps.log(compileCleanupLine(run, cleanup));
}

interface RunContext {
  readonly options: RunOptions;
  readonly deps: BenchDeps;
  readonly layout: BenchLayout;
  readonly prepared: Prepared;
}

/** One run: the indexing e2e in the run's folder, its analysis (null: unreadable), then its compiles removed. */
async function indexOnce(run: number, context: RunContext) {
  const { options, deps, layout, prepared } = context;
  const runDir = layout.runDir(run);
  mkdirSync(runDir, { recursive: true });
  const compiles = options.keepCompiles ? null : snapshotCompiles(deps.compiles, deps.now().getTime());
  // Another mac helper during the run shares the compile cache: then the run's compiles stay (IX3-F5 H1, IX3-F10).
  const watch = compiles === null ? null : watchHelpers(deps.compiles);
  deps.log(`[bench] run ${run} of ${options.runs}: ${options.tier} tier, ${options.footage} (${runDir})`);
  let helpers: HelperSightings = { seen: [], own: [] };
  const code = await runIndexing(deps, prepared, runDir).finally(() => {
    helpers = watch?.stop() ?? helpers;
  });
  const summary = analyseRun(runDir, run, deps, prepared.ocr);
  if (compiles !== null) await cleanCompiles(deps, compiles, runDir, run, helpers);
  return { e2eFailed: code !== 0, summary };
}

/** The indexing e2e in the run's folder; its exit code. */
function runIndexing(deps: BenchDeps, prepared: Prepared, runDir: string): Promise<number> {
  return deps.shell.run({
    command: 'pnpm',
    args: ['exec', 'playwright', 'test', '--project=indexing', 'e2e/indexing.e2e.ts'],
    cwd: join(deps.repoRoot, 'apps', 'desktop'),
    // The test app writes every compute.fallback there (desktop main/compute-fallback-log.ts, IX3-B4).
    env: {
      ...prepared.env,
      TAALCUT_PERF_DIR: runDir,
      TAALCUT_COMPUTE_FALLBACK_LOG: join(runDir, RUN_FILES.fallbacks),
    },
    log: join(runDir, RUN_FILES.log),
  });
}

/** True (logged) when FFmpeg stalled during the run: no more media work on this Mac until someone has looked. */
function stalled(run: number, options: RunOptions, deps: BenchDeps, before: readonly string[]): boolean {
  const stalls = stallReports(options.stallDir).filter((name) => !before.includes(name));
  if (stalls.length === 0) return false;
  // brief-common "VideoToolbox stalls".
  deps.log(`[bench] FFmpeg stalled in run ${run} (left running, not killed): ${stalls.join(', ')}`);
  deps.log(`[bench] stopping: no further runs; see ${options.stallDir}`);
  return true;
}

export async function runBench(options: RunOptions, deps: BenchDeps): Promise<BenchOutcome> {
  const layout = benchLayout(options.benchRoot, options.label);
  const prepared = await prepare(options, deps, layout);
  const context: RunContext = { options, deps, layout, prepared };
  const summaries: RunSummary[] = [];
  const failedRuns: number[] = [];
  const e2eFailedRuns: number[] = [];
  const stallsBefore = stallReports(options.stallDir);
  for (let run = 1; run <= options.runs; run += 1) {
    const low = run > 1 ? lowDiskBefore(options, deps) : null;
    if (low !== null) {
      deps.log(`[bench] stopping before run ${run}: ${low}`);
      break;
    }
    const { e2eFailed, summary } = await indexOnce(run, context);
    if (e2eFailed) e2eFailedRuns.push(run);
    if (summary === null) failedRuns.push(run);
    else summaries.push(summary);
    if (stalled(run, options, deps, stallsBefore)) break;
  }
  return writeSummary(
    layout,
    {
      label: options.label,
      tier: options.tier,
      footage: options.footage,
      runsAsked: options.runs,
      summaries,
      failedRuns,
      e2eFailedRuns,
      copyTo: options.copyTo,
      ocrSetup: prepared.ocr,
    },
    deps,
  );
}

/** Reads every run of a label again (the analysis changed) and rewrites its summary. */
export function analyseLabel(options: AnalyseOptions, deps: BenchDeps): BenchOutcome {
  const layout = benchLayout(options.benchRoot, options.label);
  if (!existsSync(layout.labelDir)) throw new Error(`no bench at ${layout.labelDir}`);
  const runs = readdirSync(layout.labelDir)
    .map((name) => /^run-(\d+)$/.exec(name)?.[1])
    .filter((run): run is string => run !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  const ocr = readOcrSetup(layout.ocrSetup);
  const summaries: RunSummary[] = [];
  const failedRuns: number[] = [];
  for (const run of runs) {
    const summary = analyseRun(layout.runDir(run), run, deps, ocr);
    if (summary === null) failedRuns.push(run);
    else summaries.push(summary);
  }
  const first = summaries[0];
  return writeSummary(
    layout,
    {
      label: options.label,
      tier: first?.tier.used ?? 'recommended',
      footage: first?.footage.set ?? 'unknown',
      runsAsked: runs.length,
      summaries,
      failedRuns,
      e2eFailedRuns: [],
      copyTo: options.copyTo,
      ocrSetup: ocr,
    },
    deps,
  );
}
