// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What one bench run of the indexing e2e wrote (apps/desktop/e2e/perf-index.ts, IX-B1), validated at the
 * boundary: index-bench.json (version 2: the machine and its tier, the footage, when Add folder was pressed and
 * when every stage had settled, per-stage times, the pipeline that ran) and index-processes.jsonl (the app's
 * process tree, the security agents and the background media daemons, once a second).
 */
import { z } from 'zod';
import { readJson } from '../../files';
import { readJsonLines } from '../../jsonl';
import { parseNamed } from '../../schema';

export const BENCH_TIERS = ['minimum', 'recommended', 'high'] as const;
export const benchTierSchema = z.enum(BENCH_TIERS);
export type BenchTier = z.output<typeof benchTierSchema>;

export const machineSchema = z.object({
  chip: z.string(),
  machineModel: z.string().nullable(),
  memoryBytes: z.number().nonnegative(),
  cpuCores: z.int().positive(),
  performanceCores: z.int().nullable(),
  efficiencyCores: z.int().nullable(),
  gpuCores: z.int().nullable(),
  neuralEngine: z.boolean(),
  os: z.string(),
  tierAssessed: benchTierSchema,
  /** Null when the run used the assessed tier. */
  tierForced: benchTierSchema.nullable(),
});
export type MachineFacts = z.output<typeof machineSchema>;

const stageTimingSchema = z.object({
  stage: z.string(),
  runs: z.int().nonnegative(),
  wallMs: z.number(),
  busyMs: z.number(),
});

export const pipelineSchema = z.object({
  stages: z.array(
    z.object({
      stage: z.string(),
      version: z.int(),
      needs: z.array(z.string()),
      appliesTo: z.array(z.string()),
      milestone: z.string().nullable(),
    }),
  ),
  kinds: z.record(z.string(), z.object({ resource: z.string(), lane: z.string().nullable() })),
});
export type PipelineGraph = z.output<typeof pipelineSchema>;

export const runRecordSchema = z.looseObject({
  v: z.literal(2),
  measuredAt: z.string(),
  loadAverageAtStart: z.array(z.number()),
  loadAverageAtEnd: z.array(z.number()),
  machine: machineSchema,
  footage: z.looseObject({
    set: z.string(),
    dir: z.string(),
    files: z.array(z.string()),
    videoSeconds: z.number().positive(),
  }),
  videoSeconds: z.number().positive(),
  files: z.int().nonnegative(),
  addedAt: z.number(),
  settledAt: z.number(),
  elapsedMs: z.number().nonnegative(),
  stagesWallMs: z.number(),
  stages: z.array(stageTimingSchema),
  vectors: z.record(z.string(), z.number()),
  minutesPerHourOfFootage: z.number(),
  pipeline: pipelineSchema,
  /** Commands the test did not issue: input from outside it (IX-B5). Older records have none. */
  foreignCommands: z.array(z.object({ name: z.string(), source: z.string(), at: z.number() })).default([]),
});
export type RunRecord = z.output<typeof runRecordSchema>;

export const parseRunRecord = (value: unknown, path = 'index-bench.json'): RunRecord =>
  parseNamed(runRecordSchema, value, path);

export const readRunRecord = (path: string): RunRecord => parseRunRecord(readJson(path), path);

const psRowSchema = z.object({
  pid: z.int(),
  ppid: z.int(),
  rssKb: z.number().nonnegative(),
  /** Cumulative CPU time as ps prints it ([dd-][hh:]mm:ss.cc). */
  cpu: z.string(),
  command: z.string(),
  vendor: z.string().optional(),
  /** A background macOS daemon (mediaanalysisd, photoanalysisd, spotlight); older samples have none. */
  daemon: z.string().optional(),
});
export type PsRow = z.output<typeof psRowSchema>;

export const processSampleSchema = z.object({
  at: z.number(),
  load: z.number().nonnegative(),
  mainPid: z.int(),
  /** Utility processes by name ('jobs', 'agent', ...). */
  utilities: z.record(z.string(), z.int()),
  rows: z.array(psRowSchema),
});
export type ProcessSample = z.output<typeof processSampleSchema>;

export const readProcessSamples = (path: string): ProcessSample[] =>
  readJsonLines(path, (value) => processSampleSchema.parse(value));
