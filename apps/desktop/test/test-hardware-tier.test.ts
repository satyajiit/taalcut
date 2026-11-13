// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The bench's forced tier (IX-B1): the variable's values, what changes in
 * the probed result and what doesn't, and that hardwareOnce keeps the
 * adjusted result for every caller.
 */
import { describe, expect, it, vi } from 'vitest';
import { err, ok, ValidationError } from '@taalcut/core';
import type { HardwareProbe } from '@taalcut/models';
import {
  forcedHardwareTier,
  forceTierFromEnv,
  TEST_HARDWARE_TIER_ENV,
  withForcedTier,
} from '../src/shared/test-hardware-tier';
import { hardwareOnce, probeFailure } from '../src/utility/roots/hardware';
import { fakeHardware } from './helpers/roots';

describe('forcedHardwareTier', () => {
  it('reads minimum, recommended and high', () => {
    for (const tier of ['minimum', 'recommended', 'high'] as const)
      expect(forcedHardwareTier({ [TEST_HARDWARE_TIER_ENV]: ` ${tier} ` })).toBe(tier);
  });

  it('is undefined when unset or empty', () => {
    expect(forcedHardwareTier({})).toBeUndefined();
    expect(forcedHardwareTier({ [TEST_HARDWARE_TIER_ENV]: '  ' })).toBeUndefined();
  });

  it('throws on a value that names no tier, naming the variable', () => {
    expect(() => forcedHardwareTier({ [TEST_HARDWARE_TIER_ENV]: 'medium' })).toThrow(TEST_HARDWARE_TIER_ENV);
  });
});

describe('withForcedTier', () => {
  it('replaces the tier and its label, and keeps the probed facts', async () => {
    const probed = await fakeHardware();
    const other = probed.assessment.tier === 'minimum' ? 'high' : 'minimum';
    const forced = withForcedTier(probed, other);
    expect(forced.assessment.tier).toBe(other);
    expect(forced.assessment.labelKey).toBe(`models.tier.${other}.label`);
    expect(forced.info).toBe(probed.info);
    expect(forced.assessment.compute).toEqual(probed.assessment.compute);
    expect(forced.assessment.shortfalls).toEqual(probed.assessment.shortfalls);
  });

  it('returns the same result without a tier or with the assessed one', async () => {
    const probed = await fakeHardware();
    expect(withForcedTier(probed, undefined)).toBe(probed);
    expect(withForcedTier(probed, probed.assessment.tier)).toBe(probed);
  });

  it('reads this process environment and says what it forced', async () => {
    const probed = await fakeHardware();
    const other = probed.assessment.tier === 'high' ? 'minimum' : 'high';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv(TEST_HARDWARE_TIER_ENV, other);
    try {
      expect(forceTierFromEnv(probed).assessment.tier).toBe(other);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`tier forced to ${other}`));
    } finally {
      vi.unstubAllEnvs();
      warn.mockRestore();
    }
  });
});

describe('hardwareOnce with an adjustment', () => {
  it('probes once and gives every caller the adjusted result', async () => {
    const { info } = await fakeHardware();
    const probe: HardwareProbe = { probe: vi.fn(async () => ok(info)) };
    const adjust = vi.fn(async (probed: Awaited<ReturnType<typeof fakeHardware>>) =>
      withForcedTier(probed, 'minimum'),
    );
    const hardware = hardwareOnce(probe, adjust);
    const [first, second] = await Promise.all([hardware(), hardware()]);
    expect(first.assessment.tier).toBe('minimum');
    expect(second).toBe(first);
    expect(probe.probe).toHaveBeenCalledTimes(1);
    expect(adjust).toHaveBeenCalledTimes(1);
  });
});

describe('a failed probe', () => {
  it('is tried again by the next caller, and the log names it (IX-F3)', async () => {
    const { info } = await fakeHardware();
    const failure = ValidationError({ field: 'sysctl' });
    const probe: HardwareProbe = {
      probe: vi.fn().mockResolvedValueOnce(err(failure)).mockResolvedValue(ok(info)),
    };
    const hardware = hardwareOnce(probe);
    const first = await hardware().catch((cause: unknown) => probeFailure(cause));
    expect(first).toBe('core.validation');
    expect((await hardware()).info).toEqual(info);
    expect(probe.probe).toHaveBeenCalledTimes(2);
    expect(probeFailure(new Error('sysctl failed'))).toBe('sysctl failed');
  });
});
