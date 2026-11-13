// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { appendJsonLines, readJsonLines } from '../jsonl';
import { type PerfMeasureInput, type PerfSample, type PerfSystem } from '../adapters/types';
import { median } from './baseline';
import { parsePerfRow, type PerfRow } from './schema';

export const PERF_SUITE = 'perf';
/** SPEC: each benchmark runs three times; the median is the result. */
export const PERF_SAMPLE_RUNS = 3;

export interface PerfRunMeta {
  runner: PerfRow['runner'];
  commit: string;
  date: string;
  synthetic: boolean;
  footage: PerfRow['footage'];
  build: PerfRow['build'];
}

export interface MetricSpec {
  metric: string;
  unit: string;
  better: PerfRow['better'];
  value: number;
  /** Why a run behind the number was noisy. */
  noisy?: readonly string[];
}

export function metricRow(meta: PerfRunMeta, spec: MetricSpec): PerfRow {
  return parsePerfRow({
    v: 1,
    suite: PERF_SUITE,
    metric: spec.metric,
    unit: spec.unit,
    value: spec.value,
    better: spec.better,
    runner: meta.runner,
    commit: meta.commit,
    date: meta.date,
    synthetic: meta.synthetic,
    footage: meta.footage,
    build: meta.build,
    ...(spec.noisy && spec.noisy.length > 0 ? { noisy: [...spec.noisy] } : {}),
  });
}

/** One row per fixed metric, plus `memory:<process>` for each key of `memoryBytes`. */
export function rowsFromSample(sample: PerfSample, meta: PerfRunMeta): PerfRow[] {
  const specs: MetricSpec[] = [
    { metric: 'index-1h', unit: 'minutes', better: 'lower', value: sample.indexMinutes },
    { metric: 'preview-fps', unit: 'fps', better: 'higher', value: sample.previewMedianFps },
    { metric: 'preview-fps-p5', unit: 'fps', better: 'higher', value: sample.previewP5Fps },
    { metric: 'dropped-frames', unit: 'frames', better: 'lower', value: sample.droppedFrames },
    { metric: 'render-60s', unit: 'seconds', better: 'lower', value: sample.renderSeconds },
  ];
  const rows = specs.map((spec) => metricRow(meta, spec));
  for (const [processName, bytes] of Object.entries(sample.memoryBytes)) {
    rows.push(
      metricRow(meta, { metric: `memory:${processName}`, unit: 'bytes', better: 'lower', value: bytes }),
    );
  }
  return rows;
}

/** Median of `runs` measurements. Memory is the median of each process key. */
export async function sampleMedian(
  system: PerfSystem,
  input: PerfMeasureInput,
  runs = PERF_SAMPLE_RUNS,
): Promise<PerfSample> {
  if (runs < 1) throw new Error('perf sample runs must be at least 1');
  const samples: PerfSample[] = [];
  for (let index = 0; index < runs; index += 1) samples.push(await system.measure(input));
  const mid = (pick: (sample: PerfSample) => number): number => median(samples.map(pick));
  const keys = new Set(samples.flatMap((sample) => Object.keys(sample.memoryBytes)));
  const memoryBytes: Record<string, number> = {};
  for (const key of [...keys].sort()) {
    memoryBytes[key] = median(samples.map((sample) => sample.memoryBytes[key] ?? 0));
  }
  return {
    indexMinutes: mid((sample) => sample.indexMinutes),
    previewMedianFps: mid((sample) => sample.previewMedianFps),
    previewP5Fps: mid((sample) => sample.previewP5Fps),
    droppedFrames: mid((sample) => sample.droppedFrames),
    renderSeconds: mid((sample) => sample.renderSeconds),
    memoryBytes,
  };
}

/** Append JSONL. One object per line, no pretty print. Creates parent directories. */
export function appendRows(path: string, rows: readonly PerfRow[]): void {
  appendJsonLines(path, rows);
}

/** Parse every non-empty line. A bad line throws and names its 1-based line number. */
export function readRows(path: string): PerfRow[] {
  return readJsonLines(path, parsePerfRow);
}
