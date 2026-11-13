// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-HW: the Linux probe on the machine the tests run on, with this process's environment (so
 * `TAALCUT_FORCE_CPU=1` and `CUDA_VISIBLE_DEVICES=-1` runs show those paths). It prints one line per GPU and the
 * tier; it asserts only what holds on any Linux machine, a CI runner without a GPU included.
 */
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  assessHardware,
  createLinuxHardwareProbe,
  describeConcurrency,
  hardwareVideoEngine,
  HARDWARE_TIERS,
  planJobConcurrency,
} from '@taalcut/models';

const GIB = 1024 ** 3;

describe.runIf(process.platform === 'linux')('smoke test on this Linux machine', () => {
  it('probes the real machine', { timeout: 30_000 }, async () => {
    const result = await createLinuxHardwareProbe({ dataDir: homedir(), env: process.env }).probe();
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail}`);
    const info = result.value;
    expect(info.platform).toBe('linux');
    expect(info.memoryBytes).toBeGreaterThan(2 * GIB);
    expect(info.cpuCores.total).toBeGreaterThan(0);
    expect(info.freeDiskBytes).toBeGreaterThan(0);
    const assessment = assessHardware(info);
    expect(HARDWARE_TIERS).toContain(assessment.tier);
    if (info.forcedCpu) expect(assessment.compute.backends).toEqual(['cpu']);
    if (process.env.CUDA_VISIBLE_DEVICES === '-1')
      expect(info.gpus.some((gpu) => gpu.apis.includes('cuda'))).toBe(false);
    const gpus = info.gpus.map((gpu) =>
      [
        gpu.name,
        gpu.vramBytes ? `${Math.round(gpu.vramBytes / GIB)} GB` : undefined,
        gpu.apis.map((api) => api.toUpperCase()).join('+') || 'no API',
        gpu.driverVersion ? `driver ${gpu.driverVersion}` : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
    );
    console.warn(
      [
        `linux hardware smoke: ${info.chip}, ${Math.round(info.memoryBytes / GIB)} GB, ${info.osName ?? 'Linux'} (${info.osVersion})`,
        ...gpus.map((line) => `  gpu: ${line}`),
        `  forcedCpu: ${info.forcedCpu === true}; backends: ${assessment.compute.backends.join(', ')}`,
        `  tier: ${assessment.tier}; shortfalls: ${assessment.shortfalls.join(', ') || 'none'}`,
        `  video engine: ${hardwareVideoEngine(info)}`,
        `  concurrency: ${describeConcurrency(planJobConcurrency(info, assessment.tier))}`,
      ].join('\n'),
    );
  });
});
