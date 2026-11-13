// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Probe and extractFrame still speak the integer-rate RationalTime
 * (`seconds = value / rate`) that vision's tool schema imports. Core's
 * RationalTime is three integers (`seconds = value * rate.den / rate.num`).
 * Phase 2 plans, facts and filmstrips use core's. This file is the only bridge.
 * The probe `version: 2` switch waits until vision and the desktop job payloads
 * move with it; changing the public schema here fails `pnpm check` outside media.
 */
import { FrameRate, RationalTime, type RationalTime as CoreTime } from '@taalcut/core';
import type { RationalTime as MediaTime } from './rational-time';

const MICRO = FrameRate.of(1_000_000);

export function coreTime(value: number, num: number, den = 1): CoreTime {
  return RationalTime.of(value, FrameRate.of(num, den));
}

/** Integer-rate media time to core. `rate` is units per second. */
export function fromMediaTime(time: MediaTime): CoreTime {
  return RationalTime.of(time.value, FrameRate.of(time.rate, 1));
}

/** Core time back to integer-rate media time: value/rate seconds. */
export function toMediaTime(time: CoreTime): MediaTime {
  return { value: time.value * time.rate.den, rate: time.rate.num };
}

function ratioToCore(numerator: bigint, denominator: bigint): CoreTime {
  let num = numerator;
  let den = denominator;
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  if (den === 0n) return RationalTime.of(0, FrameRate.of(1));
  const n = Number(num);
  const d = Number(den);
  if (Number.isSafeInteger(n) && Number.isSafeInteger(d) && d > 0) return RationalTime.of(n, FrameRate.of(d));
  const micros = (num * 1_000_000n) / den;
  const m = Number(micros);
  return RationalTime.of(Number.isSafeInteger(m) ? m : 0, MICRO);
}

/** `later − earlier` for two integer-rate media times, as a core time. */
export function mediaDelta(later: MediaTime, earlier: MediaTime): CoreTime {
  const num = BigInt(later.value) * BigInt(earlier.rate) - BigInt(earlier.value) * BigInt(later.rate);
  const den = BigInt(later.rate) * BigInt(earlier.rate);
  return ratioToCore(num, den);
}

export function mediaSeconds(time: MediaTime | undefined): number {
  if (!time || time.rate === 0) return 0;
  return time.value / time.rate;
}
