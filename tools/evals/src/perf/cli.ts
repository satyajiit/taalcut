// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runnerPerfSystem } from '../adapters/perf';
import { syntheticPerfSystem } from '../adapters/synthetic-perf';
import { cliArgs, isDirectRun } from '../entry';
import { budgetWarnings, checkBudgets, readBudgetFile } from './bench/budgets';
import { readSummary } from './bench/compare';
import { indexRows, unusableBench } from './index-rows';
import { DEFAULT_RUNNER_ALLOWLIST, ghCommandClient } from './issue';
import { type PerfRunMeta } from './measure';
import { runPerf } from './run';

/** tools/evals/perf/index-budgets.json, from tools/evals/src/perf. */
const DEFAULT_INDEX_BUDGETS = fileURLToPath(new URL('../../perf/index-budgets.json', import.meta.url));

const USAGE = [
  'Usage: perf --out <file.jsonl> --runner <id> [--synthetic] [--footage device-lab|synthetic]',
  '  [--file-issues] [--allow <id,id>] [--commit <sha>] [--chip <s>] [--memory-gb <n>]',
  '  [--macos <s>] [--trends <TRENDS.md>] [--index-summary <bench summary.json> [--index-budgets <json>]]',
  '  without --synthetic: --library-db <library.db> --preview <json> --render <json> --app-metrics <jsonl>',
  '  [--since <epoch ms>]',
].join('\n');

/** The runner's benchmark outputs (adapters/perf.ts); every one is required for a real run. */
function runnerSystem(values: Record<string, string | boolean | undefined>) {
  const text = (key: string) => (typeof values[key] === 'string' ? (values[key] as string) : undefined);
  const missing = ['library-db', 'preview', 'render', 'app-metrics'].filter((key) => text(key) === undefined);
  if (missing.length > 0) throw new Error(`${USAGE}\nmissing ${missing.map((key) => `--${key}`).join(', ')}`);
  const since = text('since') === undefined ? 0 : Number(text('since'));
  if (!Number.isFinite(since)) throw new Error('--since must be epoch milliseconds');
  return runnerPerfSystem({
    libraryDb: resolve(text('library-db')!),
    since,
    preview: resolve(text('preview')!),
    render: resolve(text('render')!),
    appMetrics: resolve(text('app-metrics')!),
  });
}

/**
 * The indexing bench's rows (index-rows.ts) and its budget warnings, when a summary is given. A bench that can't be
 * a night's number (a run failed, measured nothing or never ran) adds no rows and says why.
 */
function indexBench(summaryPath: string | undefined, budgetsPath: string | undefined, meta: PerfRunMeta) {
  if (summaryPath === undefined) return { rows: [], warnings: [], notUsed: null };
  const summary = readSummary(resolve(summaryPath), '');
  const unusable = unusableBench(summary);
  if (unusable.length > 0)
    return { rows: [], warnings: [], notUsed: `${summary.label}: ${unusable.join('; ')}` };
  const budgets = readBudgetFile(resolve(budgetsPath ?? DEFAULT_INDEX_BUDGETS));
  return {
    rows: indexRows(summary, meta),
    warnings: budgetWarnings(checkBudgets(summary, budgets)),
    notUsed: null,
  };
}

function footageOf(synthetic: boolean, raw: string | undefined): PerfRunMeta['footage'] {
  if (synthetic) return 'synthetic';
  if (raw === undefined || raw === 'device-lab') return 'device-lab';
  if (raw === 'synthetic') return 'synthetic';
  throw new Error('--footage must be device-lab or synthetic');
}

function memoryOf(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error('--memory-gb must be a number');
  return value;
}

function allowOf(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim() === '') return DEFAULT_RUNNER_ALLOWLIST;
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export async function main(argv: string[]): Promise<number> {
  try {
    const { values } = parseArgs({
      args: cliArgs(argv),
      options: {
        out: { type: 'string' },
        runner: { type: 'string' },
        synthetic: { type: 'boolean' },
        footage: { type: 'string' },
        'file-issues': { type: 'boolean' },
        allow: { type: 'string' },
        commit: { type: 'string' },
        chip: { type: 'string' },
        'memory-gb': { type: 'string' },
        macos: { type: 'string' },
        trends: { type: 'string' },
        'library-db': { type: 'string' },
        since: { type: 'string' },
        preview: { type: 'string' },
        render: { type: 'string' },
        'app-metrics': { type: 'string' },
        'index-summary': { type: 'string' },
        'index-budgets': { type: 'string' },
      },
      strict: true,
    });
    if (values.out === undefined || values.runner === undefined) {
      throw new Error(`${USAGE}\n--out and --runner are required`);
    }
    const synthetic = values.synthetic === true;
    const fileIssues = values['file-issues'] === true;
    const footage = footageOf(synthetic, values.footage);
    const meta: PerfRunMeta = {
      runner: {
        id: values.runner,
        chip: values.chip ?? 'unknown',
        memoryGb: memoryOf(values['memory-gb']),
        macos: values.macos ?? 'unknown',
      },
      commit: values.commit ?? process.env.GITHUB_SHA ?? 'unknown',
      date: new Date().toISOString(),
      synthetic,
      footage,
      build: { flavour: synthetic ? 'synthetic' : 'dev', version: '0.0.0' },
    };
    const system = synthetic ? syntheticPerfSystem() : runnerSystem(values);
    const index = indexBench(values['index-summary'], values['index-budgets'], meta);
    if (index.notUsed !== null) console.warn(`::warning title=Indexing bench not used::${index.notUsed}`);
    for (const line of index.warnings) console.warn(`::warning title=Indexing over budget::${line}`);
    const outPath = resolve(values.out);
    const result = await runPerf({
      system,
      outPath,
      trendsPath: values.trends === undefined ? undefined : resolve(values.trends),
      meta,
      extraRows: index.rows,
      fileIssues,
      runnerAllowlist: allowOf(values.allow),
      // `gh` is constructed only when --file-issues is set. The default is a dry run.
      client: fileIssues ? ghCommandClient() : undefined,
    });
    const regressionText =
      result.regressions.length === 0
        ? 'no regressions'
        : result.regressions.map((item) => `${item.metric} ${item.action}`).join(', ');
    console.log(`Wrote ${outPath} (${result.rows.length} rows); ${regressionText}; not publishing`);
    return 0;
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
