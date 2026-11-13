// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the self-hosted runner's benchmarks leave behind, read into one
 * PerfSample: the library database the app's indexing pipeline filled (its
 * stage rows' start and finish times, `pipelineTimings`), the preview and
 * render benchmarks' JSON, and `app.getAppMetrics()` sampled each second as
 * JSON lines. Every input is required; a missing or malformed one is an
 * error naming the file, never a zero.
 */
import { readFileSync } from 'node:fs';
import { openDatabase, pipelineTimings, type LibraryDatabase } from '@taalcut/library';
import { z } from 'zod';
import { parseNamed } from '../schema';

export const previewSchema = z
  .object({
    medianFps: z.number().nonnegative(),
    p5Fps: z.number().nonnegative(),
    droppedFrames: z.int().nonnegative(),
  })
  .strict();

export const renderSchema = z.object({ seconds: z.number().positive() }).strict();

/** Electron's ProcessMetric, the fields used here. Memory is in kilobytes. */
const processMetricSchema = z.looseObject({
  type: z.string(),
  name: z.string().optional(),
  serviceName: z.string().optional(),
  memory: z.looseObject({
    workingSetSize: z.number().nonnegative(),
    peakWorkingSetSize: z.number().nonnegative(),
  }),
});
const metricsLineSchema = z.union([
  z.array(processMetricSchema),
  z.looseObject({ metrics: z.array(processMetricSchema) }),
]);

/** A benchmark output's text; a missing file says which. */
function readText(path: string, what: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`${what}: ${path} is missing`);
  }
}

function parseFile<T>(path: string, schema: z.ZodType<T>, what: string): T {
  return parseNamed(schema, JSON.parse(readText(path, what)), `${what}: ${path}`);
}

export const readPreview = (path: string) => parseFile(path, previewSchema, 'preview benchmark');
export const readRender = (path: string) => parseFile(path, renderSchema, 'render benchmark');

/** 'Taalcut jobs' → 'jobs'; the browser process is 'main', a tab 'renderer'. */
function processKey(metric: z.output<typeof processMetricSchema>): string {
  if (metric.type === 'Browser') return 'main';
  if (metric.type === 'Tab') return 'renderer';
  const name = metric.name ?? metric.serviceName;
  if (metric.type === 'Utility' && name) return name.replace(/^Taalcut\s+/i, '').toLowerCase();
  return metric.type.toLowerCase();
}

/** Peak resident bytes per process over every sample (processes sharing a key are summed per sample). */
export function peakMemory(jsonLines: string, path = 'app metrics'): Record<string, number> {
  const peaks: Record<string, number> = {};
  let samples = 0;
  for (const [n, line] of jsonLines.split('\n').entries()) {
    if (line.trim() === '') continue;
    const parsed = parseNamed(metricsLineSchema, JSON.parse(line), `${path}:${n + 1}`);
    const metrics = Array.isArray(parsed) ? parsed : parsed.metrics;
    const sample: Record<string, number> = {};
    for (const metric of metrics) {
      const key = processKey(metric);
      const kb = Math.max(metric.memory.workingSetSize, metric.memory.peakWorkingSetSize);
      sample[key] = (sample[key] ?? 0) + kb * 1024;
    }
    for (const [key, bytes] of Object.entries(sample)) peaks[key] = Math.max(peaks[key] ?? 0, bytes);
    samples += 1;
  }
  if (samples === 0) throw new Error(`${path}: no app.getAppMetrics() samples`);
  return peaks;
}

export function readPeakMemory(path: string): Record<string, number> {
  return peakMemory(readText(path, 'app metrics'), path);
}

export interface IndexBenchmark {
  /** Minutes the pipeline took, scaled to one hour of footage. */
  readonly indexMinutes: number;
  readonly wallMs: number;
  readonly footageSeconds: number;
  readonly assets: number;
  readonly completeAssets: number;
}

/** Wall clock of the stage rows finished since `since`, per hour of the footage those assets hold. */
export function indexBenchmark(db: LibraryDatabase, since: number): IndexBenchmark {
  const timings = pipelineTimings(db, since);
  if (timings.wallMs <= 0) throw new Error('library database: no index stage finished in the window');
  const footage = db.driver
    .prepare(
      `SELECT coalesce(sum(a.duration_value * 1.0 * a.duration_rate_den / a.duration_rate_num), 0) AS s
       FROM assets a WHERE a.duration_value IS NOT NULL AND a.duration_rate_num > 0 AND EXISTS (
         SELECT 1 FROM asset_index_stages x WHERE x.asset_id = a.id AND x.state = 'done' AND x.finished_at >= ?)`,
    )
    .get(since);
  const footageSeconds = Number(footage?.s ?? 0);
  if (footageSeconds <= 0) throw new Error('library database: the indexed assets hold no timed footage');
  return {
    indexMinutes: (timings.wallMs / 60_000) * (3600 / footageSeconds),
    wallMs: timings.wallMs,
    footageSeconds,
    assets: timings.assets,
    completeAssets: timings.completeAssets,
  };
}

/** Opens a copy of the app's library.db (as the app does) and reads the index benchmark from it. */
export function readIndexBenchmark(path: string, since: number): IndexBenchmark {
  const opened = openDatabase({ path, onCorruption: 'fail' });
  if (!opened.ok) throw new Error(`library database: ${path}: ${opened.error.code}`);
  try {
    return indexBenchmark(opened.value, since);
  } finally {
    opened.value.close();
  }
}
