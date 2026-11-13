// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The app's CPU fallbacks in the bench (IX3-B4; round IX's open gap). ADR 0002 has every compute path log a CPU
 * choice as a `compute.fallback` event; the test app writes each one main sees to the file the bench names per run
 * (`TAALCUT_COMPUTE_FALLBACK_LOG`, `compute-fallbacks.jsonl`; desktop `main/compute-fallback-log.ts`). Per run: the
 * events, grouped by kind (operation and reason). Per bench: each kind and the runs it showed in. Compare names the
 * kinds the second bench has and the first had not, and budgets warn on kinds the budget's bench had not, so "no new
 * CPU fallbacks" is checked, not assumed. A run from before this (no file) is "not recorded", never "none".
 */
import { existsSync } from 'node:fs';
import { computeFallbackEventSchema } from '@taalcut/core';
import { z } from 'zod';
import { readJsonLines } from '../../jsonl';

const fallbackLineSchema = computeFallbackEventSchema.extend({ at: z.int().nonnegative() });

export const fallbackKindSchema = z.object({
  /** `<operation> (<reason>)`: what compare and budgets match on. */
  key: z.string(),
  operation: z.string(),
  reason: z.string(),
  wanted: z.array(z.string()),
  events: z.int().nonnegative(),
  /** One event's developer detail, as an example. */
  detail: z.string().optional(),
});
export type FallbackKind = z.output<typeof fallbackKindSchema>;

export interface RunFallbacks {
  readonly events: number;
  readonly kinds: readonly FallbackKind[];
}

export const benchFallbacksSchema = z.object({
  /** Runs that recorded their fallbacks, of the runs that finished. */
  recordedRuns: z.int().nonnegative(),
  runs: z.int().nonnegative(),
  kinds: z.array(
    fallbackKindSchema.extend({
      /** Runs it showed in. */
      runs: z.int().positive(),
    }),
  ),
});
export type BenchFallbacks = z.output<typeof benchFallbacksSchema>;

export const fallbackKey = (operation: string, reason: string): string => `${operation} (${reason})`;

/** A run's fallbacks from its file; null when the run recorded none (a run from before IX3-B4). */
export function readRunFallbacks(path: string): RunFallbacks | null {
  if (!existsSync(path)) return null;
  const lines = readJsonLines(path, (value) => fallbackLineSchema.parse(value));
  const kinds = new Map<string, FallbackKind>();
  for (const line of lines) {
    const key = fallbackKey(line.operation, line.reason);
    const seen = kinds.get(key);
    kinds.set(key, {
      key,
      operation: line.operation,
      reason: line.reason,
      wanted: [...new Set([...(seen?.wanted ?? []), ...line.wanted])],
      events: (seen?.events ?? 0) + 1,
      ...((seen?.detail ?? line.detail) === undefined ? {} : { detail: seen?.detail ?? line.detail }),
    });
  }
  return { events: lines.length, kinds: [...kinds.values()].sort((a, b) => a.key.localeCompare(b.key)) };
}

export function benchFallbacks(runs: readonly (RunFallbacks | null)[]): BenchFallbacks {
  const recorded = runs.filter((run): run is RunFallbacks => run !== null);
  const kinds = new Map<string, BenchFallbacks['kinds'][number]>();
  for (const run of recorded)
    for (const kind of run.kinds) {
      const seen = kinds.get(kind.key);
      kinds.set(kind.key, {
        ...kind,
        wanted: [...new Set([...(seen?.wanted ?? []), ...kind.wanted])],
        events: (seen?.events ?? 0) + kind.events,
        runs: (seen?.runs ?? 0) + 1,
      });
    }
  return {
    recordedRuns: recorded.length,
    runs: runs.length,
    kinds: [...kinds.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/** Whether every run recorded its fallbacks, so "none new" means something. */
export const fallbacksRecorded = (
  fallbacks: BenchFallbacks | null | undefined,
): fallbacks is BenchFallbacks =>
  fallbacks !== null &&
  fallbacks !== undefined &&
  fallbacks.runs > 0 &&
  fallbacks.recordedRuns === fallbacks.runs;

/** The kinds in `after` that `before` did not have; null when either did not record them in every run. */
export function newFallbacks(
  before: BenchFallbacks | null | undefined,
  after: BenchFallbacks | null | undefined,
): string[] | null {
  if (!fallbacksRecorded(before) || !fallbacksRecorded(after)) return null;
  return fallbacksBeyond(after, fallbackKeys(before));
}

export const fallbackKeys = (fallbacks: BenchFallbacks): string[] => fallbacks.kinds.map((kind) => kind.key);

/** The kinds in `fallbacks` that `known` does not list. */
export const fallbacksBeyond = (fallbacks: BenchFallbacks, known: readonly string[]): string[] =>
  fallbackKeys(fallbacks).filter((key) => !known.includes(key));

/** summary.md's line on CPU fallbacks. */
export function fallbacksLine(fallbacks: BenchFallbacks | null | undefined): string {
  if (fallbacks === null || fallbacks === undefined || fallbacks.recordedRuns === 0)
    return 'CPU fallbacks (compute.fallback): not recorded (runs from before IX3-B4).';
  const partly =
    fallbacks.recordedRuns < fallbacks.runs
      ? ` (recorded in ${fallbacks.recordedRuns} of ${fallbacks.runs} runs)`
      : '';
  if (fallbacks.kinds.length === 0)
    return `CPU fallbacks (compute.fallback): none in ${fallbacks.recordedRuns} run${fallbacks.recordedRuns === 1 ? '' : 's'}${partly}.`;
  const kinds = fallbacks.kinds.map(
    (kind) =>
      `${kind.key}, wanted ${kind.wanted.join(', ') || 'nothing'}: ${kind.events} events in ${kind.runs} of ` +
      `${fallbacks.recordedRuns} runs${kind.detail === undefined ? '' : ` (“${kind.detail.slice(0, 120)}”)`}`,
  );
  return `**CPU fallbacks (compute.fallback)**${partly}: ${kinds.join('; ')}.`;
}

/** compare's line: the kinds new in `after`, the ones gone, or why it can't say. */
export function fallbacksCompareLine(
  before: BenchFallbacks | null | undefined,
  after: BenchFallbacks | null | undefined,
): string {
  const added = newFallbacks(before, after);
  if (added === null || !fallbacksRecorded(before) || !fallbacksRecorded(after))
    return 'CPU fallbacks: not comparable (a bench that did not record them in every run).';
  const gone = fallbacksBeyond(before, fallbackKeys(after));
  if (added.length === 0 && gone.length === 0)
    return after.kinds.length === 0
      ? 'CPU fallbacks: none in either.'
      : `CPU fallbacks: the same kinds in both (${fallbackKeys(after).join('; ')}).`;
  return [
    added.length === 0 ? '' : `**New CPU fallbacks: ${added.join('; ')}** (worse).`,
    gone.length === 0 ? '' : `CPU fallbacks gone: ${gone.join('; ')} (better).`,
  ]
    .filter((part) => part !== '')
    .join(' ');
}
