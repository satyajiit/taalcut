// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The bench reports every number across runs as its median and its spread (min and max), never one picked
 * run: a single run on a loaded Mac is noise.
 */
import { z } from 'zod';
import { median } from '../baseline';

export interface Spread {
  readonly median: number;
  readonly min: number;
  readonly max: number;
  /** How many runs had the number. */
  readonly n: number;
}

/** A spread as summary.json holds it (null when no run had the number). */
export const spreadSchema = z
  .object({ median: z.number(), min: z.number(), max: z.number(), n: z.int() })
  .nullable();

/** Undefined values (a run without that number) are left out; null when no run had it. */
export function spreadOf(values: readonly (number | null | undefined)[]): Spread | null {
  const present = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  if (present.length === 0) return null;
  return { median: median(present), min: Math.min(...present), max: Math.max(...present), n: present.length };
}

/** (max − min) / median, the relative spread; 0 for one run or a zero median. */
export function relativeSpread(spread: Spread): number {
  return spread.median === 0 ? 0 : (spread.max - spread.min) / spread.median;
}

/** Minutes per hour of footage: how long one hour of the same mix would take at this rate. */
export function minutesPerHour(ms: number, videoSeconds: number): number {
  if (videoSeconds <= 0) throw new Error('minutes per hour of no footage');
  return (ms / 60_000) * (3600 / videoSeconds);
}

export const round = (value: number, places = 1): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};
