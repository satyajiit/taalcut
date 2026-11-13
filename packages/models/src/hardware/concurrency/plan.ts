// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The lane plan (round IX, design A): from the machine and its tier to the class budgets and lane limits
 * the job engine applies (core's JobConcurrencyPlan). Pure: the desktop probes the hardware and passes the
 * tier (assessed, or the bench's forced one); the jobs process applies the result.
 */
import type { JobConcurrencyPlan } from '@taalcut/core';
import type { HardwareInfo, HardwareTier } from '../types';
import { MODEL_LANE_LIMITS } from './model-lanes';
import { CONCURRENCY_PROFILES, type ConcurrencyProfile, type ConcurrencyProfileId } from './profiles';

/** I/O (hashing, copies) and network (cloud calls, downloads) budgets: the same on every machine. */
export const SHARED_BUDGETS = { io: 4, network: 4 } as const;

export interface PlannedConcurrency {
  /** Which profile matched, for logs and the bench's run record. */
  readonly profile: ConcurrencyProfileId;
  readonly plan: JobConcurrencyPlan;
}

export function planJobConcurrency(
  info: HardwareInfo,
  tier: HardwareTier,
  profiles: readonly ConcurrencyProfile[] = CONCURRENCY_PROFILES,
): PlannedConcurrency {
  const machine = { info, tier };
  const profile = profiles.find((p) => p.matches(machine));
  if (!profile)
    throw new Error('No concurrency profile matches this machine; the list must end with a catch-all.');
  return {
    profile: profile.id,
    plan: {
      classes: { ...profile.budgets(machine), ...SHARED_BUDGETS },
      lanes: { ...MODEL_LANE_LIMITS, ...profile.lanes?.(machine) },
      ...(profile.foldInto ? { foldInto: { ...profile.foldInto } } : {}),
    },
  };
}

/**
 * One line for the log: `apple-silicon: cpu 3, gpu 2, npu 1, video 2, io 4, network 4; lanes …`, and
 * `; npu in gpu` for each folded class.
 */
export function describeConcurrency({ profile, plan }: PlannedConcurrency): string {
  const classes = Object.entries(plan.classes).map(([rc, n]) => `${rc} ${n}`);
  const lanes = Object.entries(plan.lanes).map(([lane, n]) => `${lane} ${n}`);
  const folds = Object.entries(plan.foldInto ?? {}).map(([from, to]) => `; ${from} in ${to}`);
  return `${profile}: ${classes.join(', ')}; lanes ${lanes.join(', ')}${folds.join('')}`;
}
