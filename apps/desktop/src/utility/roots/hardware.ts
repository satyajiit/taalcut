// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * This machine's hardware and tier (the platform services' probe + assessHardware),
 * probed on first use and kept. A failed probe rejects with its TaalcutError
 * (models.hardware_probe_failed, retryable) and is tried again next time.
 *
 * Test builds may force the tier (shared/test-hardware-tier.ts): every
 * utility process gets its hardware here, so the stages, the session cap, the
 * component list and the agent's models all see the same forced tier.
 */
import { assessHardware, type HardwareProbe } from '@taalcut/models';
import type { ProbedHardware } from '../../shared/tokens';
import { hostPlatform } from '../../platform';

/** A change to the probed result before it is kept (test builds: a forced tier). */
export type HardwareAdjust = (probed: ProbedHardware) => Promise<ProbedHardware>;

export function hardwareOnce(probe: HardwareProbe, adjust?: HardwareAdjust): () => Promise<ProbedHardware> {
  let probed: Promise<ProbedHardware> | undefined;
  return () => {
    probed ??= probe.probe().then((info) => {
      if (!info.ok) {
        probed = undefined;
        throw info.error;
      }
      const assessed = { info: info.value, assessment: assessHardware(info.value) };
      return adjust ? adjust(assessed) : assessed;
    });
    return probed;
  };
}

/** A failed probe for the log: its code (models.hardware_probe_failed), or what was thrown. */
export function probeFailure(cause: unknown): string {
  if (typeof cause === 'object' && cause !== null && 'code' in cause) return String(cause.code);
  return cause instanceof Error ? cause.message : String(cause);
}

/** Test builds: TAALCUT_TEST_HARDWARE_TIER, through import() so release bundles leave it out. */
const testTier: HardwareAdjust = async (probed) => {
  const { forceTierFromEnv } = await import('../../shared/test-hardware-tier');
  return forceTierFromEnv(probed);
};

/** Free disk is measured on the volume that holds userData. */
export const macHardware = (userData: string) =>
  hardwareOnce(hostPlatform().hardwareProbe(userData), __TAALCUT_FLAVOUR__ === 'test' ? testTier : undefined);
