// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The machine a bench run measured (IX-B1): chip, memory, cores, macOS, and
 * the hardware tier this Mac assesses next to the one the run forced
 * (TAALCUT_TEST_HARDWARE_TIER, shared/test-hardware-tier.ts), probed the way
 * the app probes it (models' macOS probe and assessHardware).
 */
import { assessHardware, createMacHardwareProbe, type HardwareTier } from '@taalcut/models';
import { forcedHardwareTier } from '../src/shared/test-hardware-tier';

export interface MachineFacts {
  readonly chip: string;
  readonly machineModel: string | null;
  readonly memoryBytes: number;
  readonly cpuCores: number;
  readonly performanceCores: number | null;
  readonly efficiencyCores: number | null;
  readonly gpuCores: number | null;
  readonly neuralEngine: boolean;
  readonly os: string;
  readonly tierAssessed: HardwareTier;
  /** Null when the run used the assessed tier. */
  readonly tierForced: HardwareTier | null;
}

export async function machineFacts(dataDir: string): Promise<MachineFacts> {
  const probed = await createMacHardwareProbe({ dataDir }).probe();
  if (!probed.ok) throw new Error(`hardware probe failed: ${probed.error.code} ${probed.error.detail ?? ''}`);
  const info = probed.value;
  return {
    chip: info.chip,
    machineModel: info.machineModel ?? null,
    memoryBytes: info.memoryBytes,
    cpuCores: info.cpuCores.total,
    performanceCores: info.cpuCores.performance ?? null,
    efficiencyCores: info.cpuCores.efficiency ?? null,
    gpuCores: info.gpuCores ?? null,
    neuralEngine: info.neuralEngine,
    os: `${info.platform} ${info.osVersion}`,
    tierAssessed: assessHardware(info).tier,
    tierForced: forcedHardwareTier(process.env) ?? null,
  };
}
