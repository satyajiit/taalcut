// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * indexing.e2e.ts's opt-in bench output (P3-R1, IX-B1). With TAALCUT_PERF_DIR
 * set, while the folder indexes: app metrics each second
 * (index-metrics.jsonl), the app's process tree and the security agents each
 * second (index-processes.jsonl, perf-processes.ts); then index-bench.json
 * records the machine and the tier it ran at, the footage, when Add folder
 * was pressed and when every stage had settled, each stage's wall and busy
 * time, the minutes one hour of the same mix would take at that rate, the
 * load average, the pipeline that ran (perf-pipeline.ts) and any commands
 * the test did not issue (input from outside it, IX-B5). The library is
 * copied to index-library.sqlite for the timeline (tools/evals' bench
 * analysis) and for `perf --library-db`. Without the variable nothing runs.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ElectronApplication } from '@playwright/test';
import { libraryPath } from '../src/shared/library-path';
import { sampleAppMetrics, type MetricsSampler } from './app-metrics';
import type { IndexFootage } from './indexing-footage';
import { foreignCommands, type StageTiming } from './indexing-support';
import { machineFacts, type MachineFacts } from './perf-machine';
import { pipelineGraph } from './perf-pipeline';
import { recordProcesses, type ProcessRecorder } from './perf-processes';

/** index-bench.json's shape; tools/evals' bench analysis reads it (perf/bench/run-record.ts). */
const INDEX_BENCH_VERSION = 2;

export interface IndexRun {
  readonly videoSeconds: number;
  readonly files: number;
  /** Epoch ms when the test pressed Add folder. */
  readonly addedAt: number;
  /** Epoch ms when the test saw every stage row settled (polled every 2 s). */
  readonly settledAt: number;
  /** From Add folder until every stage settled. */
  readonly elapsedMs: number;
  /** First stage start to last stage finish. */
  readonly stagesWallMs: number;
  readonly stages: readonly StageTiming[];
  readonly vectors: Readonly<Record<string, number>>;
}

export interface IndexPerf {
  finish(run: IndexRun, userData: string): Promise<void>;
}

const rounded = (values: readonly number[]) => values.map((value) => Math.round(value * 10) / 10);

/** A consistent copy of the app's library (VACUUM INTO reads it as one snapshot, WAL included). */
function copyLibrary(userData: string, to: string): void {
  rmSync(to, { force: true });
  const db = new DatabaseSync(libraryPath(userData), { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${to.replaceAll("'", "''")}'`);
  } finally {
    db.close();
  }
}

interface Started {
  readonly out: string;
  readonly footage: IndexFootage;
  readonly machine: MachineFacts;
  readonly loadAtStart: readonly number[];
  readonly metrics: MetricsSampler;
  readonly processes: ProcessRecorder;
}

async function writeIndexBench(started: Started, run: IndexRun, userData: string): Promise<void> {
  const [metrics, processes] = await Promise.all([started.metrics.stop(), started.processes.stop()]);
  copyLibrary(userData, join(started.out, 'index-library.sqlite'));
  const report = {
    v: INDEX_BENCH_VERSION,
    measuredAt: new Date().toISOString(),
    loadAverageAtStart: rounded(started.loadAtStart),
    loadAverageAtEnd: rounded(loadavg()),
    machine: started.machine,
    footage: {
      set: started.footage.set,
      dir: started.footage.dir,
      files: started.footage.files,
      videoSeconds: started.footage.videoSeconds,
    },
    ...run,
    minutesPerHourOfFootage: Math.round((run.elapsedMs / 60_000) * (3600 / run.videoSeconds) * 10) / 10,
    pipeline: pipelineGraph(),
    foreignCommands: foreignCommands(userData),
    metricsSamples: metrics.samples,
    processSamples: processes.samples,
  };
  writeFileSync(join(started.out, 'index-bench.json'), `${JSON.stringify(report, null, 2)}\n`);
}

export async function startIndexPerf(
  app: ElectronApplication,
  userData: string,
  footage: IndexFootage,
): Promise<IndexPerf | null> {
  const out = process.env.TAALCUT_PERF_DIR;
  if (!out) return null;
  mkdirSync(out, { recursive: true });
  const started: Started = {
    out,
    footage,
    machine: await machineFacts(userData),
    loadAtStart: loadavg(),
    metrics: sampleAppMetrics(app, join(out, 'index-metrics.jsonl')),
    processes: recordProcesses(app, join(out, 'index-processes.jsonl')),
  };
  return { finish: (run, data) => writeIndexBench(started, run, data) };
}
