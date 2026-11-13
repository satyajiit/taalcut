// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Test builds only (TAALCUT_BUILD_FLAVOUR=test): TAALCUT_TEST_HARDWARE_TIER
 * (minimum, recommended or high) forces the hardware tier the app's
 * processes use for their choices, so the indexing bench can measure the
 * tier a gate names on whatever Mac it runs on (IX-B1; the contract is
 * _orch/ix/specs/bench-tier-override.md). Only the assessment's tier and
 * its label key change: the probed facts (chip, memory, GPU cores) stay this
 * Mac's, so anything that should follow the forced tier must choose by the
 * tier, not by the raw facts.
 *
 * Utility roots reach this module only inside `__TAALCUT_FLAVOUR__ === 'test'`
 * through import(), so release bundles don't contain it. The e2e bench reads
 * the variable's name and parser from here too.
 */
import { HARDWARE_TIERS, type HardwareTier, type ProbedHardware } from '@taalcut/models';
import { z } from 'zod';

export const TEST_HARDWARE_TIER_ENV = 'TAALCUT_TEST_HARDWARE_TIER';

const tierSchema = z.enum(HARDWARE_TIERS);

/**
 * The tier the variable forces, or undefined when it is unset or empty. A value that names no tier is a
 * mistake in the test's setup, so it throws rather than measuring the wrong tier.
 */
export function forcedHardwareTier(
  env: Readonly<Record<string, string | undefined>>,
): HardwareTier | undefined {
  const raw = env[TEST_HARDWARE_TIER_ENV]?.trim();
  if (raw === undefined || raw === '') return undefined;
  const parsed = tierSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(`${TEST_HARDWARE_TIER_ENV}=${raw} names no tier: use ${HARDWARE_TIERS.join(', ')}`);
  return parsed.data;
}

/** The probe's result with `tier` in place of the assessed one (unchanged without a forced tier). */
export function withForcedTier(probed: ProbedHardware, tier: HardwareTier | undefined): ProbedHardware {
  if (tier === undefined || tier === probed.assessment.tier) return probed;
  return {
    info: probed.info,
    assessment: { ...probed.assessment, tier, labelKey: `models.tier.${tier}.label` },
  };
}

/** The forced tier from this process's environment, said once in the process's log. */
export function forceTierFromEnv(probed: ProbedHardware): ProbedHardware {
  const forced = withForcedTier(probed, forcedHardwareTier(process.env));
  if (forced !== probed)
    console.warn(
      `[hardware] tier forced to ${forced.assessment.tier} by ${TEST_HARDWARE_TIER_ENV} ` +
        `(this Mac assesses ${probed.assessment.tier})`,
    );
  return forced;
}
