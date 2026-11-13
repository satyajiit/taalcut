// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pooled Ruderman lαβ mean and population deviation. Pixels are read and discarded;
 * the result is the six numbers in core's lookStatsSchema, never the frames.
 */
import { err, ok, lookStatsSchema, type LookStats, type Result } from '@taalcut/core';
import { codeToUnit, encodedToRuderman, type Encoding } from './colour-space';
import { LookUnavailable } from './errors';
import { percentile } from './percentile';

/** SPEC P3.2: at most 48 frames in one pool. */
export const LOOK_POOL_FRAMES = 48;

export interface LookFrame {
  readonly width: number;
  readonly height: number;
  readonly rgb: Uint8Array;
  readonly encoding: Encoding;
  /** Full-range code values unless the decoder left legal-range R′G′B′. */
  readonly range?: 'full' | 'limited';
  /** Shot analysis already marked the frame dark. Left out before the percentile. */
  readonly dark?: boolean;
}

export interface MeasureLookOptions {
  /** Defaults to LOOK_POOL_FRAMES. Clamped to the schema's 64. */
  readonly maxFrames?: number;
}

interface Running {
  n: number;
  sumL: number;
  sumA: number;
  sumB: number;
  sqL: number;
  sqA: number;
  sqB: number;
}

/** Stored deviation must be positive (the schema). A true 0 is this floor, and the map skips scaling it. */
const STD_FLOOR = 1e-12;

function empty(): Running {
  return { n: 0, sumL: 0, sumA: 0, sumB: 0, sqL: 0, sqA: 0, sqB: 0 };
}

function unitOf(frame: LookFrame, code: number): number {
  return codeToUnit(code, frame.range === 'limited' ? 'limited' : 'full');
}

function accumulate(frame: LookFrame, running: Running): void {
  const { rgb, encoding } = frame;
  for (let i = 0; i < rgb.length; i += 3) {
    const lab = encodedToRuderman(
      [unitOf(frame, rgb[i] ?? 0), unitOf(frame, rgb[i + 1] ?? 0), unitOf(frame, rgb[i + 2] ?? 0)],
      encoding,
    );
    running.n += 1;
    running.sumL += lab[0];
    running.sumA += lab[1];
    running.sumB += lab[2];
    running.sqL += lab[0] * lab[0];
    running.sqA += lab[1] * lab[1];
    running.sqB += lab[2] * lab[2];
  }
}

function meanL(frame: LookFrame): number {
  const running = empty();
  accumulate(frame, running);
  return running.n === 0 ? 0 : running.sumL / running.n;
}

/** Population deviation. The frame is the whole distribution, not a sample of one. */
function deviation(sum: number, sumSq: number, n: number): number {
  if (n <= 0) return STD_FLOOR;
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  const std = Math.sqrt(variance > 0 ? variance : 0);
  return std > STD_FLOOR ? std : STD_FLOOR;
}

/** Linear 5th percentile of the frames' mean l. */
function percentile5(values: readonly number[]): number {
  return percentile(
    [...values].sort((a, b) => a - b),
    0.05,
  );
}

function rejected(frame: LookFrame): boolean {
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height)) return true;
  if (frame.width < 1 || frame.height < 1) return true;
  return frame.width * frame.height * 3 !== frame.rgb.length;
}

function unavailable(detail: string): Result<LookStats> {
  return err(LookUnavailable(undefined, { detail }));
}

export function measureLook(
  frames: readonly LookFrame[],
  options: MeasureLookOptions = {},
): Result<LookStats> {
  if (frames.length === 0) return unavailable('no frames');
  const cap = Math.min(64, Math.max(1, options.maxFrames ?? LOOK_POOL_FRAMES));
  const pool = frames.slice(0, cap);
  for (const frame of pool) {
    if (rejected(frame)) return unavailable('frame bytes do not match width×height×3');
  }
  const encoding: Encoding | undefined = pool[0]?.encoding;
  if (encoding === undefined) return unavailable('no frames');
  if (pool.some((frame) => frame.encoding !== encoding)) return unavailable('mixed encodings');

  const means = pool.map((frame) => ({ frame, meanL: meanL(frame) }));
  const cutoff = percentile5(means.map((entry) => entry.meanL));
  // A frame is dropped only when its mean l is strictly under the cutoff, so a one-frame set is kept.
  const kept = means.filter((entry) => entry.frame.dark !== true && entry.meanL >= cutoff);
  if (kept.length === 0) return unavailable('no frame bright enough to measure');

  const running = empty();
  for (const entry of kept) accumulate(entry.frame, running);
  const stats = {
    version: 1 as const,
    space: 'ruderman-lab' as const,
    encoding,
    mean: [running.sumL / running.n, running.sumA / running.n, running.sumB / running.n] as const,
    std: [
      deviation(running.sumL, running.sqL, running.n),
      deviation(running.sumA, running.sqA, running.n),
      deviation(running.sumB, running.sqB, running.n),
    ] as const,
    frames: kept.length,
    pixels: running.n,
  };
  const parsed = lookStatsSchema.safeParse(stats);
  if (!parsed.success) return unavailable('statistics were not finite');
  return ok(parsed.data);
}
