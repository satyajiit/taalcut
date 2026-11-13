// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `pnpm bench:index …` (IX-B1): the indexing bench's one command. See options.ts for the flags and
 * _orch/ix/bench/HOW-TO.md for how lanes use it.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeText } from '../../files';
import { cliArgs, isDirectRun } from '../../entry';
import {
  budgetMarkdown,
  budgetWarnings,
  checkBudgets,
  readBudgetFile,
  tightenBudgets,
  writeBudgetFile,
  type BudgetFile,
} from './budgets';
import { compareMarkdown, readSummary } from './compare';
import { nodeCompileCache } from './compile-cleanup';
import { nodeDiskSpace } from './disk-floor';
import { benchFootage } from './footage';
import { nodeHelperProbe } from './mac-helper';
import { parseBenchArgs, USAGE, type BudgetsOptions } from './options';
import { analyseTimeline } from '../timeline/report';
import { analyseLabel, runBench, type BenchDeps, type BenchOutcome } from './runner';
import { nodeShell } from './shell';

/** tools/evals/src/perf/bench → the checkout's root. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
/** The indexing budgets (IX-B4); lanes tighten them with `budgets <label> --write`. */
const BUDGET_FILE = join(REPO_ROOT, 'tools', 'evals', 'perf', 'index-budgets.json');
const EMPTY_BUDGETS: BudgetFile = { v: 1, tolerance: 0.15, floorMinPerHour: 0.5, budgets: [] };

function deps(): BenchDeps {
  return {
    shell: nodeShell(),
    repoRoot: REPO_ROOT,
    footage: benchFootage(),
    now: () => new Date(),
    log: (line) => console.log(line),
    analyse: analyseTimeline,
    budgets: () => readBudgetFile(BUDGET_FILE),
    helper: nodeHelperProbe(),
    disk: nodeDiskSpace(),
    compiles: nodeCompileCache(),
  };
}

/**
 * Prints the summary against its budget; `--write` tightens the budget to its medians, `--reset` replaces it with
 * them. Over budget warns, never fails; writing from a bench without OCR fails.
 */
function budgets(options: BudgetsOptions): number {
  const summary = readSummary(options.summary, options.benchRoot);
  const file = readBudgetFile(BUDGET_FILE) ?? EMPTY_BUDGETS;
  const report = checkBudgets(summary, file);
  console.log(budgetMarkdown(report).join('\n'));
  for (const line of budgetWarnings(report)) console.warn(`[bench] over budget: ${line}`);
  if (options.write || options.reset) {
    writeBudgetFile(BUDGET_FILE, tightenBudgets(file, summary, new Date(), options.reset));
    console.log(
      `[bench] ${summary.footage} at ${summary.tier}: budgets ${options.reset ? 'replaced' : 'set'} from ` +
        `${summary.label} in ${BUDGET_FILE}`,
    );
  }
  return 0;
}

function exitCode(outcome: BenchOutcome): number {
  console.log(`[bench] summary: ${outcome.summaryPath}`);
  if (outcome.failedRuns.length > 0)
    console.error(`[bench] runs that measured nothing: ${outcome.failedRuns.join(', ')}`);
  if (outcome.e2eFailedRuns.length > 0)
    console.error(`[bench] runs whose e2e failed: ${outcome.e2eFailedRuns.join(', ')} (see their run.log)`);
  return outcome.failedRuns.length > 0 || outcome.e2eFailedRuns.length > 0 ? 1 : 0;
}

export async function main(argv: string[]): Promise<number> {
  const args = cliArgs(argv);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  try {
    // pnpm runs the script in tools/evals; relative paths are the caller's (INIT_CWD).
    const cwd = process.env.INIT_CWD ?? process.cwd();
    const options = parseBenchArgs(args, { env: process.env, cwd, now: new Date() });
    if (options.command === 'compare') {
      const markdown = compareMarkdown(
        readSummary(options.before, options.benchRoot),
        readSummary(options.after, options.benchRoot),
      );
      if (options.out !== null) writeText(options.out, markdown);
      console.log(markdown);
      return 0;
    }
    if (options.command === 'budgets') return budgets(options);
    if (options.command === 'analyse') return exitCode(analyseLabel(options, deps()));
    return exitCode(await runBench(options, deps()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isDirectRun(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
