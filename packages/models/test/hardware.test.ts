// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-E4 acceptance: hardware tiers from recorded macOS output for an M1 8 GB,
 * an M2 16 GB and an M3 Max, plus a smoke test on the machine running the tests.
 */
import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  assessHardware,
  createMacHardwareProbe,
  HARDWARE_TIERS,
  parseAppleChip,
  parseGpuCores,
  parseOsVersion,
  type GpuInfo,
  type HardwareInfo,
} from '@taalcut/models';
import { loadMacFixture, MAC_FIXTURES, macProbeFor, probeMacFixture } from './support/hardware-fixtures';

const GIB = 1024 ** 3;

describe('GPU capability from recorded machines (ADR 0002)', () => {
  it.each(MAC_FIXTURES)('%s: GPUs, Metal family, Neural Engine, backends, tier', async (name) => {
    const { expected } = loadMacFixture(name);
    const info = await probeMacFixture(name);
    expect(info.gpus).toEqual(expected.gpus);
    expect(info.neuralEngine).toBe(expected.neuralEngine);
    const assessment = assessHardware(info);
    expect(assessment.compute.backends).toEqual(expected.backends);
    expect(assessment.tier).toBe(expected.tier);
    expect(assessment.shortfalls).toEqual(expected.shortfalls);
    expect(assessment.compute.gpu).toEqual(expected.gpus[0]);
  });

  it('counts unified memory as GPU memory on Apple Silicon and VRAM on a discrete GPU', async () => {
    expect(assessHardware(await probeMacFixture('m2-16gb')).compute.gpuMemoryBytes).toBe(16 * GIB);
    expect(assessHardware(await probeMacFixture('intel-i9-16gb')).compute.gpuMemoryBytes).toBe(4 * GIB);
  });
});

describe('hardware tiers from recorded machines', () => {
  it('M1 8 GB → Minimum', async () => {
    const info = await probeMacFixture('m1-8gb');
    expect(info).toMatchObject({
      chip: 'Apple M1',
      appleChip: { generation: 1, variant: 'base' },
      machineModel: 'MacBookAir10,1',
      memoryBytes: 8 * GIB,
      gpuCores: 7,
      cpuCores: { total: 8, performance: 4, efficiency: 4 },
      osVersion: '14.6.1',
    });
    expect(assessHardware(info)).toMatchObject({
      tier: 'minimum',
      shortfalls: [],
      defaultProfileId: 'balanced',
      labelKey: 'models.tier.minimum.label',
    });
  });

  it('M2 16 GB → Recommended', async () => {
    const info = await probeMacFixture('m2-16gb');
    expect(info).toMatchObject({ chip: 'Apple M2', memoryBytes: 16 * GIB, gpuCores: 10, osVersion: '15.1' });
    expect(assessHardware(info)).toMatchObject({ tier: 'recommended', shortfalls: [] });
  });

  it('M3 Max → High', async () => {
    const info = await probeMacFixture('m3-max-48gb');
    expect(info).toMatchObject({
      appleChip: { generation: 3, variant: 'max' },
      gpuCores: 40,
      cpuCores: { total: 16, performance: 12, efficiency: 4 },
    });
    expect(assessHardware(info)).toMatchObject({ tier: 'high', shortfalls: [] });
  });

  it('the development machine (real output) → High', async () => {
    const info = await probeMacFixture('m5-max-64gb-dev-machine');
    expect(info).toMatchObject({ chip: 'Apple M5 Max', gpuCores: 40, osVersion: '26.7.1' });
    expect(assessHardware(info).tier).toBe('high');
  });

  it('an Intel Mac on macOS 13 gets Minimum with the reasons it falls short', async () => {
    const info = await probeMacFixture('intel-i9-16gb');
    expect(info.appleChip).toBeUndefined();
    expect(info.gpuCores).toBeUndefined();
    expect(info.cpuCores).toEqual({ total: 16 });
    const assessment = assessHardware(info);
    expect(assessment.tier).toBe('minimum');
    expect(assessment.shortfalls).toEqual([
      'not_apple_silicon',
      'macos_too_old',
      'disk_low',
      'no_gpu_for_local_models',
    ]);
    expect(assessment.shortfallKeys).toContain('models.hardware.not_apple_silicon');
  });
});

describe('tier rules', () => {
  const appleGpu = (cores: number | undefined): GpuInfo => ({
    name: 'Apple M4',
    vendor: 'apple',
    ...(cores !== undefined ? { cores } : {}),
    unifiedMemory: true,
    apis: ['metal'],
    metalFamily: 'metal3',
  });
  const base: HardwareInfo = {
    platform: 'darwin',
    arch: 'arm64',
    chip: 'Apple M4',
    appleChip: { generation: 4, variant: 'base' },
    memoryBytes: 32 * GIB,
    gpuCores: 10,
    gpus: [appleGpu(10)],
    neuralEngine: true,
    cpuCores: { total: 10 },
    freeDiskBytes: 200 * GIB,
    osVersion: '15.2',
  };
  /** Keeps gpus[0] in step with gpuCores, as the probe does. */
  const machine = (change: Partial<HardwareInfo>): HardwareInfo => {
    const info = { ...base, ...change };
    return 'gpus' in change ? info : { ...info, gpus: [appleGpu(info.gpuCores)] };
  };

  it('keeps a machine without a GPU for local models at Minimum, whatever its RAM (GPU first)', () => {
    const noGpu = machine({ gpus: [], gpuCores: undefined, memoryBytes: 64 * GIB });
    const assessment = assessHardware(noGpu);
    expect(assessment.tier).toBe('minimum');
    expect(assessment.shortfalls).toContain('no_gpu_for_local_models');
    expect(assessment.compute.backends).toEqual(['coreml', 'ane', 'cpu']);
  });

  it('wants the Neural Engine for High', () => {
    expect(assessHardware(machine({ gpuCores: 40, neuralEngine: false })).tier).toBe('recommended');
  });

  it('offers CUDA and Vulkan from a discrete GPU, with its VRAM as GPU memory (shape for later platforms)', () => {
    const pc = assessHardware({
      ...base,
      platform: 'win32',
      arch: 'x64',
      chip: 'AMD Ryzen 9 7950X',
      appleChip: undefined,
      neuralEngine: false,
      gpuCores: undefined,
      gpus: [
        {
          name: 'GeForce RTX 4080',
          vendor: 'nvidia',
          vramBytes: 16 * GIB,
          unifiedMemory: false,
          apis: ['cuda', 'directml', 'vulkan'],
        },
      ],
    } as HardwareInfo);
    expect(pc.compute.backends).toEqual(['cuda', 'directml', 'vulkan', 'webgpu', 'cpu']);
    expect(pc.compute.gpuMemoryBytes).toBe(16 * GIB);
  });

  it.each([
    ['M4 32 GB, 10-core GPU', {}, 'recommended'],
    ['M2 Pro 32 GB, 19-core GPU', { chip: 'Apple M2 Pro', gpuCores: 19 }, 'high'],
    ['M3 Pro 18 GB, 18-core GPU', { memoryBytes: 18 * GIB, gpuCores: 18 }, 'recommended'],
    [
      'M1 Max 32 GB without a GPU count',
      { appleChip: { generation: 1, variant: 'max' }, gpuCores: undefined },
      'high',
    ],
    [
      'M1 Pro 32 GB without a GPU count',
      { appleChip: { generation: 1, variant: 'pro' }, gpuCores: undefined },
      'recommended',
    ],
    ['M1 8 GB', { memoryBytes: 8 * GIB, gpuCores: 8 }, 'minimum'],
  ] as const)('$0 → $2', (_name, change, tier) => {
    expect(assessHardware(machine(change as Partial<HardwareInfo>)).tier).toBe(tier);
  });

  it('flags low disk, old macOS and low memory as shortfalls', () => {
    const assessment = assessHardware({
      ...base,
      freeDiskBytes: 19 * GIB,
      osVersion: '13.7',
      memoryBytes: 4 * GIB,
    });
    expect(assessment.shortfalls).toEqual(['macos_too_old', 'memory_low', 'disk_low']);
    expect(assessment.tier).toBe('minimum');
  });
});

describe('parsers and failures', () => {
  it('parses chip names, GPU cores and versions', () => {
    expect(parseAppleChip('Apple M2 Ultra')).toEqual({ generation: 2, variant: 'ultra' });
    expect(parseAppleChip('Apple M4 Pro')).toEqual({ generation: 4, variant: 'pro' });
    expect(parseAppleChip('Intel(R) Xeon(R) W-3245')).toBeUndefined();
    expect(parseGpuCores('not json')).toBeUndefined();
    expect(parseGpuCores('{"SPDisplaysDataType":[{"sppci_cores":"0"}]}')).toBeUndefined();
    expect(parseOsVersion('15.1\n')).toBe('15.1');
    expect(parseOsVersion('ProductVersion: 15.1')).toBeUndefined();
  });

  it('returns a typed error when a tool gives nothing usable', async () => {
    const fixture = loadMacFixture('m2-16gb');
    const noSysctl = await macProbeFor(fixture, { sysctl: '' }).probe.probe();
    expect(!noSysctl.ok && noSysctl.error).toMatchObject({
      code: 'models.hardware_probe_failed',
      params: { step: 'sysctl' },
    });
    const noVersion = await macProbeFor(fixture, { sw_vers: 'garbage' }).probe.probe();
    expect(!noVersion.ok && noVersion.error.params).toEqual({ step: 'sw_vers' });
  });

  it('only runs fixed binaries by absolute path, with no shell', async () => {
    const { probe, calls } = macProbeFor(loadMacFixture('m1-8gb'));
    await probe.probe();
    expect(calls).toEqual([
      '/usr/sbin/sysctl machdep.cpu.brand_string hw.model hw.memsize hw.ncpu hw.perflevel0.physicalcpu hw.perflevel1.physicalcpu',
      '/usr/sbin/system_profiler SPDisplaysDataType -json',
      '/usr/bin/sw_vers -productVersion',
    ]);
  });
});

describe.runIf(process.platform === 'darwin')('smoke test on this Mac', () => {
  it('probes the real machine', { timeout: 30_000 }, async () => {
    const result = await createMacHardwareProbe({ dataDir: homedir() }).probe();
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail}`);
    const info = result.value;
    expect(info.memoryBytes).toBeGreaterThan(4 * GIB);
    expect(info.freeDiskBytes).toBeGreaterThan(0);
    expect(info.osVersion).toMatch(/^\d+\.\d+/);
    expect(info.cpuCores.total).toBeGreaterThan(0);
    if (info.arch === 'arm64') expect(info.gpuCores).toBeGreaterThan(0);
    const assessment = assessHardware(info);
    expect(HARDWARE_TIERS).toContain(assessment.tier);
    console.warn(
      `hardware smoke: ${info.chip}, ${Math.round(info.memoryBytes / GIB)} GB, ${info.gpuCores ?? '?'} GPU cores, macOS ${info.osVersion} → ${assessment.tier}`,
    );
  });
});
