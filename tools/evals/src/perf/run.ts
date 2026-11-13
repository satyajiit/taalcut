// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { dirname, join } from 'node:path';
import { type PerfSystem } from '../adapters/types';
import { writeText } from '../files';
import { baselineOf, regressionOf } from './baseline';
import { DEFAULT_RUNNER_ALLOWLIST, ghCommandClient, reportRegression, type GhClient } from './issue';
import { appendRows, readRows, rowsFromSample, sampleMedian, type PerfRunMeta } from './measure';
import { type PerfRow } from './schema';
import { renderTrends } from './trends';

export interface ReportedRegression {
  metric: string;
  runnerId: string;
  value: number;
  baseline: number;
  worseBy: number;
  action: 'dry-run' | 'created' | 'commented' | 'skipped';
  command: string;
}

export interface RunPerfOptions {
  system: PerfSystem;
  outPath: string;
  trendsPath?: string;
  meta: PerfRunMeta;
  /** Rows measured elsewhere and appended with this run's (the indexing bench's, index-rows.ts). */
  extraRows?: readonly PerfRow[];
  /** Default behaviour is dry-run. Issues are filed only when this is true. */
  fileIssues: boolean;
  runnerAllowlist?: readonly string[];
  client?: GhClient;
  /**
   * Optional publisher (for example a git push of the orphan branch).
   * Omitted means this function does not touch git.
   */
  publish?: (info: { outPath: string; trendsPath: string; rows: PerfRow[] }) => Promise<void> | void;
}

export interface RunPerfResult {
  rows: PerfRow[];
  regressions: ReportedRegression[];
  trendsMarkdown: string;
}

function dryRunClient(): GhClient {
  const refuse = (name: string): Promise<never> =>
    Promise.reject(new Error(`gh ${name} is not called unless fileIssues is set`));
  return {
    listOpen: () => refuse('list'),
    create: () => refuse('create'),
    comment: () => refuse('comment'),
  };
}

function percentLabel(worseBy: number): string {
  if (!Number.isFinite(worseBy)) return '+Infinity%';
  return `+${Math.round(worseBy * 100)}%`;
}

function regressionBody(row: PerfRow, baseline: number, worseBy: number): string {
  return [
    `${row.metric} is ${percentLabel(worseBy)} worse than baseline ${baseline} ${row.unit} (value ${row.value}).`,
    `Runner ${row.runner.id} (${row.runner.chip}, ${row.runner.memoryGb} GB, macOS ${row.runner.macos}).`,
    `Commit ${row.commit} at ${row.date}. Footage ${row.footage}. Synthetic ${row.synthetic}.`,
    `Build ${row.build.flavour} ${row.build.version}.`,
  ].join(' ');
}

export async function runPerf(options: RunPerfOptions): Promise<RunPerfResult> {
  const { meta, outPath } = options;
  const sample = await sampleMedian(options.system, { footage: meta.footage, runnerId: meta.runner.id });
  const built = [...rowsFromSample(sample, meta), ...(options.extraRows ?? [])];
  appendRows(outPath, built);
  const stored = readRows(outPath);
  if (stored.length < built.length) {
    throw new Error(`${outPath} has ${stored.length} rows after appending ${built.length}`);
  }
  const history = stored.slice(0, stored.length - built.length);
  const fresh = stored.slice(stored.length - built.length);
  const allowlist = options.runnerAllowlist ?? DEFAULT_RUNNER_ALLOWLIST;
  const client = options.client ?? (options.fileIssues ? ghCommandClient() : dryRunClient());
  const regressions: ReportedRegression[] = [];
  for (const row of fresh) {
    const baseline = baselineOf(history, row);
    if (baseline === undefined) continue;
    const verdict = regressionOf(baseline, row.value, row.better);
    if (!verdict.regresses) continue;
    const title = `Perf: ${row.metric} on ${row.runner.id} ${percentLabel(verdict.worseBy)}`;
    const body = regressionBody(row, baseline, verdict.worseBy);
    // A noisy run's number is shown, never filed: the slowdown may be the noise's.
    const report = row.noisy
      ? { action: 'skipped' as const, command: `skipped: noisy run (${row.noisy.join('; ')})` }
      : await reportRegression({
          client,
          fileIssues: options.fileIssues,
          runnerAllowlist: allowlist,
          runnerId: row.runner.id,
          metric: row.metric,
          title,
          body,
        });
    regressions.push({
      metric: row.metric,
      runnerId: row.runner.id,
      value: row.value,
      baseline,
      worseBy: verdict.worseBy,
      action: report.action,
      command: report.command,
    });
  }
  const trendsPath = options.trendsPath ?? join(dirname(outPath), 'TRENDS.md');
  const trendsMarkdown = renderTrends(stored);
  writeText(trendsPath, trendsMarkdown);
  if (options.publish !== undefined) {
    await options.publish({ outPath, trendsPath, rows: fresh });
  }
  return { rows: fresh, regressions, trendsMarkdown };
}
