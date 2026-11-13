// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the indexing bench keeps things, all under one bench root (one folder for the IT admin to exclude
 * from endpoint scanning, bench/av-exclusions.md):
 *
 *   <root>/footage/<set>/            generated footage (smoke: the e2e library cache; ix-v1: tools/bench-footage)
 *   <root>/work/                     each run's app data (userData, the library, caches), deleted after the run
 *   <root>/runs/<label>/build.log    the one build of the test app
 *   <root>/runs/<label>/ocr-setup.json  the mac helper the app ran with, or why none (mac-helper.ts)
 *   <root>/runs/<label>/run-<n>/     what run n wrote: index-bench.json, index-library.sqlite, metrics, the log,
 *                                    and its analysis (run-summary.json, timeline.json, timeline.md)
 *   <root>/runs/<label>/summary.json the runs together: median and spread (summary.md for people)
 */
import { join } from 'node:path';

export interface BenchLayout {
  readonly root: string;
  readonly footage: (set: string) => string;
  readonly work: string;
  readonly label: string;
  readonly labelDir: string;
  readonly buildLog: string;
  readonly ocrSetup: string;
  readonly runDir: (run: number) => string;
  readonly summaryJson: string;
  readonly summaryMarkdown: string;
}

export function benchLayout(root: string, label: string): BenchLayout {
  const labelDir = join(root, 'runs', label);
  return {
    root,
    footage: (set) => join(root, 'footage', set),
    work: join(root, 'work'),
    label,
    labelDir,
    buildLog: join(labelDir, 'build.log'),
    ocrSetup: join(labelDir, 'ocr-setup.json'),
    runDir: (run) => join(labelDir, `run-${run}`),
    summaryJson: join(labelDir, 'summary.json'),
    summaryMarkdown: join(labelDir, 'summary.md'),
  };
}

/** The files a run leaves behind, by name. */
export const RUN_FILES = {
  record: 'index-bench.json',
  library: 'index-library.sqlite',
  processes: 'index-processes.jsonl',
  metrics: 'index-metrics.jsonl',
  log: 'run.log',
  summary: 'run-summary.json',
  timeline: 'timeline.json',
  timelineMarkdown: 'timeline.md',
  /** The app's compute.fallback events, one JSON line each (fallbacks.ts). */
  fallbacks: 'compute-fallbacks.jsonl',
  /** The Core ML compiles the bench removed after the run (compile-cleanup.ts). */
  compiles: 'compile-cleanup.json',
} as const;
