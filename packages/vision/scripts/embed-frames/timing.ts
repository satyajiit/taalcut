// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Per-process timings for the embed-frames bench (IX2-G1): a runner that records every FFmpeg and ffprobe
 * run's wall time and arguments, the medians and spreads the report prints, and the keyframes of a file
 * (ffprobe's packet flags: a demux, no decode) on its frame grid.
 */
import { basename } from 'node:path';
import { unwrap } from '@taalcut/core';
import * as media from '@taalcut/media';

export interface ProcessTiming {
  readonly command: string;
  readonly args: readonly string[];
  readonly ms: number;
  readonly ok: boolean;
}

/** `ctx` with a runner that appends each run's timing to `into` (it keeps the context's own runner). */
export function timingContext(ctx: media.MediaContext, into: ProcessTiming[]): media.MediaContext {
  const inner = ctx.runner ?? media.runProcess;
  return {
    ...ctx,
    runner: async (command, args, options) => {
      const started = performance.now();
      const result = await inner(command, args, options);
      into.push({
        command: basename(command),
        args: [...args],
        ms: performance.now() - started,
        ok: result.ok,
      });
      return result;
    },
  };
}

/** FFmpeg runs among `runs` (ffprobe's left out). */
export const ffmpegRuns = (runs: readonly ProcessTiming[]): number =>
  runs.filter((run) => run.command.startsWith('ffmpeg')).length;

export async function timed<T>(run: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const started = performance.now();
  const value = await run();
  return { ms: performance.now() - started, value };
}

export interface Spread {
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly n: number;
}

export function spread(values: readonly number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { median: 0, min: 0, max: 0, n: 0 };
  const mid = Math.floor(n / 2);
  const median = n % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  const round = (x: number) => Math.round(x * 10) / 10;
  return { median: round(median), min: round(sorted[0] ?? 0), max: round(sorted[n - 1] ?? 0), n };
}

/** Grid frames that are keyframes (sync packets), ascending. */
export async function keyframesOf(
  ctx: media.MediaContext,
  path: string,
  plan: media.NormalisationPlan,
  startSeconds: number,
): Promise<number[]> {
  const times = unwrap(await media.keyframeTimes(ctx, path));
  const rate = plan.frameRate.output;
  return times.map((time) => Math.round(((time - startSeconds) * rate.num) / rate.den));
}

/** The keyframe a seek to `frame` starts decoding from: the last at or before it (0 when none is). */
export function keyframeBefore(keyframes: readonly number[], frame: number): number {
  let found = 0;
  for (const key of keyframes) {
    if (key > frame) break;
    found = key;
  }
  return found;
}
