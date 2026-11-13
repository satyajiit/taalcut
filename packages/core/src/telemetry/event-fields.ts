// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The field shapes telemetry events may use: bounded counts and durations, coarse size buckets and a strict
 * object per event (no field beyond its shape), so no event can fingerprint a library.
 */
import '../basics/zod-config';
import { z } from 'zod';

export const telemetryCount = z.int().nonnegative().max(1_000_000_000);
export const telemetryMs = z.int().nonnegative().max(1_000_000_000_000);
/** An app version as builds number it: 0.3.0, 0.3.0-beta.2. */
export const telemetryVersion = z.string().regex(/^\d+\.\d+\.\d+(-[a-z]+\.\d+)?$/);

/** Coarse sizes, so no count can fingerprint a library. */
export const SIZE_BUCKETS = ['0', '1', '2-5', '6-20', '21-100', '101-500', '501+'] as const;
export type SizeBucket = (typeof SIZE_BUCKETS)[number];
export const telemetrySize = z.enum(SIZE_BUCKETS);

const BUCKET_TOPS: readonly [number, SizeBucket][] = [
  [0, '0'],
  [1, '1'],
  [5, '2-5'],
  [20, '6-20'],
  [100, '21-100'],
  [500, '101-500'],
];

/** The bucket a count falls in (negative and NaN count as 0). */
export function sizeBucket(n: number): SizeBucket {
  const value = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : n === Infinity ? Infinity : 0;
  return BUCKET_TOPS.find(([top]) => value <= top)?.[1] ?? '501+';
}

/** One event's schema: its name and exactly these fields. */
export function telemetry<N extends string, S extends z.ZodRawShape>(name: N, shape: S) {
  return z.object({ name: z.literal(name), ...shape }).strict();
}
