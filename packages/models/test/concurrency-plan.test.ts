// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-S2: the lane plan from the hardware. Recorded Macs through the real probe, and Windows PCs as the
 * shape the Windows probe produces (its own test replays recorded PowerShell and nvidia-smi output).
 * Windows rows have not run on real hardware.
 */
import { jobConcurrencyPlanSchema } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  assessHardware,
  describeConcurrency,
  MODEL_LANE_LIMITS,
  MODEL_LANES,
  planJobConcurrency,
  type GpuInfo,
  type HardwareInfo,
  type HardwareTier,
} from '@taalcut/models';
import { probeMacFixture } from './support/hardware-fixtures';

const GIB = 1024 ** 3;
const shared = { io: 4, network: 4 };

function pc(gpu: Partial<GpuInfo> | undefined, cores: HardwareInfo['cpuCores']): HardwareInfo {
  return {
    platform: 'win32',
    arch: 'x64',
    chip: 'AMD Ryzen 9 7950X',
    memoryBytes: 32 * GIB,
    gpus: gpu
      ? [{ name: 'GPU', vendor: 'other', unifiedMemory: false, apis: ['directml', 'vulkan'], ...gpu }]
      : [],
    neuralEngine: false,
    cpuCores: cores,
    freeDiskBytes: 500 * GIB,
    osVersion: '10.0.26100',
  };
}

const rtx = (vramGiB: number): Partial<GpuInfo> => ({
  name: `NVIDIA GeForce RTX (${vramGiB} GB)`,
  vendor: 'nvidia',
  vramBytes: vramGiB * GIB,
  apis: ['cuda', 'directml', 'vulkan'],
});

describe('lane plan: recorded Macs', () => {
  const ocrTwo = { ...MODEL_LANE_LIMITS, 'vision.ocr': 2 };
  it.each([
    ['m1-8gb', 'apple-silicon', { cpu: 2, video: 2, gpu: 1, npu: 1 }, MODEL_LANE_LIMITS],
    ['m2-16gb', 'apple-silicon', { cpu: 3, video: 2, gpu: 2, npu: 3 }, ocrTwo],
    ['m3-max-48gb', 'apple-silicon', { cpu: 4, video: 2, gpu: 3, npu: 3 }, ocrTwo],
    ['m5-max-64gb-dev-machine', 'apple-silicon', { cpu: 4, video: 2, gpu: 3, npu: 3 }, ocrTwo],
    // AMD Radeon Pro on Metal; 16 logical CPUs, no performance split; Vision and Core ML run on GPU and CPU.
    ['intel-i9-16gb', 'other-gpu', { cpu: 4, video: 2, gpu: 1, npu: 1 }, MODEL_LANE_LIMITS],
  ] as const)('%s → %s at its assessed tier', async (name, profile, budgets, lanes) => {
    const info = await probeMacFixture(name);
    const planned = planJobConcurrency(info, assessHardware(info).tier);
    expect(planned.profile).toBe(profile);
    expect(planned.plan.classes).toEqual({ ...budgets, ...shared });
    expect(planned.plan.lanes).toEqual(lanes);
    expect(jobConcurrencyPlanSchema.safeParse(planned.plan).success).toBe(true);
  });

  it('takes an Apple row from the tier argument, so a forced tier gets its row on any Mac', async () => {
    const m5 = await probeMacFixture('m5-max-64gb-dev-machine');
    const rows = (['minimum', 'recommended', 'high'] as const satisfies readonly HardwareTier[]).map(
      (tier) => planJobConcurrency(m5, tier).plan.classes,
    );
    expect(rows).toEqual([
      { cpu: 2, video: 2, gpu: 1, npu: 1, ...shared },
      { cpu: 3, video: 2, gpu: 2, npu: 3, ...shared },
      { cpu: 4, video: 2, gpu: 3, npu: 3, ...shared },
    ]);
  });

  it('reads on-screen text two files at a time from recommended up, beside a Parakeet slot (IX3-O2)', async () => {
    const m5 = await probeMacFixture('m5-max-64gb-dev-machine');
    const plans = (['minimum', 'recommended', 'high'] as const).map(
      (tier) => planJobConcurrency(m5, tier).plan,
    );
    expect(plans.map((plan) => plan.lanes['vision.ocr'])).toEqual([1, 2, 2]);
    // The npu class holds both OCR jobs and a Parakeet transcript; at minimum they take turns.
    for (const plan of plans) {
      const npuLanes = (plan.lanes['vision.ocr'] ?? 1) + (plan.lanes['audio.parakeet'] ?? 1);
      expect(plan.classes.npu === 1 || plan.classes.npu >= npuLanes).toBe(true);
    }
    // Every other lane keeps one job.
    for (const plan of plans)
      for (const lane of MODEL_LANES.filter((l) => l !== 'vision.ocr')) expect(plan.lanes[lane]).toBe(1);
  });

  it('describes the plan in one log line', async () => {
    const planned = planJobConcurrency(await probeMacFixture('m2-16gb'), 'recommended');
    expect(describeConcurrency(planned)).toBe(
      'apple-silicon: cpu 3, video 2, gpu 2, npu 3, io 4, network 4; lanes vision.embedder 1, audio.whisper 1, ' +
        'audio.parakeet 1, audio.beats 1, models.llm 1, vision.ocr 2',
    );
  });
});

describe('lane plan: Windows profiles (not run on real hardware)', () => {
  const cores16 = { total: 32, performance: 16 };
  it.each([
    ['NVIDIA 24 GB', rtx(24), cores16, 'nvidia', { cpu: 4, video: 3, gpu: 3, npu: 1 }],
    [
      'NVIDIA 12 GB (reported as 12,288 MiB)',
      rtx(12),
      cores16,
      'nvidia',
      { cpu: 4, video: 3, gpu: 3, npu: 1 },
    ],
    ['NVIDIA 8 GB', rtx(8), cores16, 'nvidia', { cpu: 4, video: 2, gpu: 2, npu: 1 }],
    ['NVIDIA 6 GB', rtx(6), { total: 12 }, 'nvidia', { cpu: 3, video: 2, gpu: 1, npu: 1 }],
    [
      'AMD Radeon on DirectML',
      { vendor: 'amd', vramBytes: 16 * GIB },
      { total: 8 },
      'other-gpu',
      { cpu: 2, video: 2, gpu: 1, npu: 1 },
    ],
    ['no GPU at all', undefined, { total: 2 }, 'no-accelerator', { cpu: 1, video: 1, gpu: 1, npu: 1 }],
  ] as const)('%s', (_name, gpu, cores, profile, budgets) => {
    const planned = planJobConcurrency(pc(gpu, cores), 'minimum');
    expect(planned.profile).toBe(profile);
    expect(planned.plan.classes).toEqual({ ...budgets, ...shared });
    expect(jobConcurrencyPlanSchema.safeParse(planned.plan).success).toBe(true);
  });

  it('ignores the tier on non-Apple machines (VRAM decides)', () => {
    const machine = pc(rtx(16), { total: 16 });
    expect(planJobConcurrency(machine, 'minimum')).toEqual(planJobConcurrency(machine, 'high'));
  });

  it('keeps one on-screen text job off Apple Silicon (its one npu slot is PP-OCR)', () => {
    expect(planJobConcurrency(pc(rtx(24), cores16), 'high').plan.lanes).toEqual(MODEL_LANE_LIMITS);
  });
});

describe('lane plan: LNX1', () => {
  const cores16 = { total: 32, performance: 16 };

  it('plans NVIDIA rows on the VRAM free when the probe ran, not the whole card', () => {
    const busy = { ...rtx(24), vramFreeBytes: 9 * GIB };
    expect(planJobConcurrency(pc(busy, cores16), 'high').plan.classes).toMatchObject({ video: 2, gpu: 2 });
    const full = { ...rtx(24), vramFreeBytes: 3 * GIB };
    expect(planJobConcurrency(pc(full, cores16), 'high').plan.classes).toMatchObject({ video: 2, gpu: 1 });
    const free = { ...rtx(24), vramFreeBytes: 20 * GIB };
    expect(planJobConcurrency(pc(free, cores16), 'high').plan.classes).toMatchObject({ video: 3, gpu: 3 });
  });

  it('folds npu into gpu where there is no Neural Engine, and not on Apple Silicon', async () => {
    for (const gpu of [rtx(24), { vendor: 'amd' as const }, undefined])
      expect(planJobConcurrency(pc(gpu, cores16), 'minimum').plan.foldInto).toEqual({ npu: 'gpu' });
    const m5 = await probeMacFixture('m5-max-64gb-dev-machine');
    expect(planJobConcurrency(m5, 'high').plan.foldInto).toBeUndefined();
    expect(describeConcurrency(planJobConcurrency(pc(rtx(24), cores16), 'high'))).toMatch(/; npu in gpu$/);
  });

  it('a forced-CPU NVIDIA machine (no APIs) plans as no-accelerator', () => {
    const planned = planJobConcurrency(pc({ ...rtx(24), apis: [] }, cores16), 'minimum');
    expect(planned.profile).toBe('no-accelerator');
    expect(planned.plan.classes).toMatchObject({ video: 1, gpu: 1 });
  });
});

describe('lane plan: lanes and profiles', () => {
  it('plans one job per model lane by default, named <package>.<camelCase>', () => {
    expect(MODEL_LANES).toEqual([
      'vision.embedder',
      'audio.whisper',
      'audio.parakeet',
      'audio.beats',
      'models.llm',
      'vision.ocr',
    ]);
    expect(Object.values(MODEL_LANE_LIMITS).every((n) => n === 1)).toBe(true);
  });

  it('refuses a profile list without a catch-all', () => {
    expect(() => planJobConcurrency(pc(undefined, { total: 4 }), 'minimum', [])).toThrow(/catch-all/);
  });
});
