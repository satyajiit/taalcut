// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Media times as the library stores them: core's RationalTime in three integer
 * columns, the value and the rate's numerator and denominator (migration 8).
 * 24000 at 24000/1001 is exactly 1001 s; one integer rate could not hold NTSC.
 */
import { rationalTimeSchema, type RationalTime } from '@taalcut/core';
import type { assets, shots } from '../schema/library';

/** What asset and shot repositories take: core's RationalTime, e.g. `{ value: 48, rate: { num: 24, den: 1 } }`. */
export type StoredTime = RationalTime;

/** The time with its rate reduced (48000/2 → 24000/1), or null if it is not a usable RationalTime. */
export function normaliseTime(time: StoredTime): RationalTime | null {
  const parsed = rationalTimeSchema.safeParse(time);
  return parsed.success ? parsed.data : null;
}

type AssetTimeColumns = Pick<
  typeof assets.$inferSelect,
  'durationValue' | 'durationRateNum' | 'durationRateDen'
>;
type ShotTimeColumns = Pick<
  typeof shots.$inferSelect,
  'startValue' | 'startRateNum' | 'startRateDen' | 'durationValue' | 'durationRateNum' | 'durationRateDen'
>;

/** An asset's probed duration, or null while unknown. */
export function assetDuration(asset: AssetTimeColumns): RationalTime | null {
  const { durationValue: value, durationRateNum: num, durationRateDen: den } = asset;
  return value === null || num === null || den === null ? null : { value, rate: { num, den } };
}

/** A shot's start and duration within its asset. */
export function shotTimes(shot: ShotTimeColumns): { start: RationalTime; duration: RationalTime } {
  return {
    start: { value: shot.startValue, rate: { num: shot.startRateNum, den: shot.startRateDen } },
    duration: { value: shot.durationValue, rate: { num: shot.durationRateNum, den: shot.durationRateDen } },
  };
}
