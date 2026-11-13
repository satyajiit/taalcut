// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Retry backoff and power/thermal throttling: pure functions, so the desktop can swap them. */
import type { ConcurrencyLimits, PowerSnapshot, ResourceClass } from './types';

export interface BackoffPolicy {
  /** Delay before the first retry. */
  readonly baseMs: number;
  /** Each further retry multiplies the delay by this. */
  readonly factor: number;
  readonly maxMs: number;
  /** 0..1: the delay is spread ±jitter around its value, so retries from many jobs don't line up. */
  readonly jitter: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 2000, factor: 2, maxMs: 10 * 60_000, jitter: 0.2 };

/** Delay before retrying after `failedAttempts` attempts (1 = the first attempt failed). */
export function backoffDelay(
  failedAttempts: number,
  policy: BackoffPolicy,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, failedAttempts - 1);
  const raw = Math.min(policy.maxMs, policy.baseMs * policy.factor ** exponent);
  const spread = 1 - policy.jitter + 2 * policy.jitter * random();
  return Math.max(0, Math.round(raw * spread));
}

/**
 * Class budgets until the desktop applies the hardware plan (`@taalcut/models`' planJobConcurrency, round
 * IX): the minimum Apple tier's row, so nothing starts more work than the smallest supported Mac allows.
 */
export const DEFAULT_CONCURRENCY: ConcurrencyLimits = { cpu: 2, gpu: 1, npu: 1, video: 2, io: 4, network: 4 };

export type ThrottlePolicy = (base: ConcurrencyLimits, power: PowerSnapshot) => ConcurrencyLimits;

const half = (n: number) => Math.max(1, Math.floor(n / 2));

/**
 * The default throttle (PRD G7: aware of battery and thermals). Running jobs
 * are never interrupted; lower limits apply to what starts next.
 * - On battery: CPU, GPU, Neural Engine and video-engine work at half (at least one each).
 * - Thermal 'serious': one job each of CPU, GPU, Neural Engine and video engine; I/O at half.
 * - Thermal 'critical': no new CPU, GPU, Neural Engine or video-engine work; one I/O and one network job.
 * 'fair' is normal operation on macOS and changes nothing.
 */
export const defaultThrottle: ThrottlePolicy = (base, power) => {
  const limits: Record<ResourceClass, number> = { ...base };
  const cap = (rc: ResourceClass, max: number) => (limits[rc] = Math.min(limits[rc], max));
  const heavy = ['cpu', 'gpu', 'npu', 'video'] as const;
  if (power.onBattery) for (const rc of heavy) cap(rc, half(base[rc]));
  if (power.thermalState === 'serious') {
    for (const rc of heavy) cap(rc, 1);
    cap('io', half(base.io));
  }
  if (power.thermalState === 'critical') {
    for (const rc of heavy) cap(rc, 0);
    cap('io', 1);
    cap('network', 1);
  }
  return limits;
};
