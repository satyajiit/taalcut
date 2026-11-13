// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-S2 wiring: the jobs process applies models' lane plan for the probed machine at its tier (the
 * assessed one, or a forced one: only `assessment.tier` moves), and keeps the engine's minimum defaults when
 * the probe fails.
 */
import type { JobConcurrencyPlan } from '@taalcut/core';
import { createJobEngine, DEFAULT_CONCURRENCY, MemoryJobStore } from '@taalcut/jobs';
import { APPLE_TIER_BUDGETS, MODEL_LANE_LIMITS, type HardwareTier } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { applyHardwarePlan } from '../src/utility/roots/job-concurrency';
import type { ProbedHardware } from '../src/shared/tokens';
import { fakeHardware } from './helpers/roots';

const atTier = async (tier: HardwareTier): Promise<ProbedHardware> => {
  const probed = await fakeHardware();
  return { ...probed, assessment: { ...probed.assessment, tier, labelKey: `models.tier.${tier}.label` } };
};

describe('job concurrency from the hardware (desktop)', () => {
  it('applies the Apple row of the tier and the model lanes, and logs the plan', async () => {
    const applied: JobConcurrencyPlan[] = [];
    const lines: string[] = [];
    const planned = await applyHardwarePlan(
      { applyPlan: (plan) => applied.push(plan) },
      () => atTier('recommended'),
      (line) => lines.push(line),
    );
    expect(planned?.profile).toBe('apple-silicon');
    // On-screen text reads two files at once from recommended up (IX3-O2).
    expect(applied).toEqual([
      {
        classes: { ...APPLE_TIER_BUDGETS.recommended, io: 4, network: 4 },
        lanes: { ...MODEL_LANE_LIMITS, 'vision.ocr': 2 },
      },
    ]);
    expect(lines).toEqual([
      expect.stringMatching(/^concurrency apple-silicon: cpu 3, video 2, gpu 2, npu 3, .*vision\.ocr 2/),
    ]);
  });

  it('gives a forced tier its own row on the same Mac', async () => {
    const rows = [];
    for (const tier of ['minimum', 'recommended', 'high'] as const) {
      const planned = await applyHardwarePlan(
        { applyPlan: () => undefined },
        () => atTier(tier),
        () => {},
      );
      rows.push(planned?.plan.classes.gpu);
    }
    expect(rows).toEqual([1, 2, 3]);
  });

  it('keeps the minimum defaults when the probe fails', async () => {
    const engine = createJobEngine({ store: new MemoryJobStore(), log: () => {} });
    const lines: string[] = [];
    const planned = await applyHardwarePlan(
      engine,
      () => Promise.reject(new Error('no system_profiler')),
      (line) => lines.push(line),
    );
    expect(planned).toBeUndefined();
    expect(engine.limits()).toEqual(DEFAULT_CONCURRENCY);
    expect(lines[0]).toMatch(/hardware probe failed, keeping the minimum concurrency/);
    await engine.stop();
  });

  it('reaches a real engine: the new budgets and lanes apply', async () => {
    const engine = createJobEngine({ store: new MemoryJobStore(), log: () => {} });
    await applyHardwarePlan(
      engine,
      () => atTier('high'),
      () => {},
    );
    expect(engine.limits()).toEqual({ ...APPLE_TIER_BUDGETS.high, io: 4, network: 4 });
    expect(engine.laneLimits()).toEqual({ ...MODEL_LANE_LIMITS, 'vision.ocr': 2 });
    await engine.stop();
  });
});
