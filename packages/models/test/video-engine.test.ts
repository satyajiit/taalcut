// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** IX-S5: the video engine the session cap is chosen by, from probed facts (Linux and VA-API: LNX1). */
import { describe, expect, it } from 'vitest';
import { hardwareVideoEngine, type GpuInfo, type GpuVendor, type HardwareInfo } from '@taalcut/models';
import { probeMacFixture } from './support/hardware-fixtures';

const pc = (vendor?: GpuVendor): HardwareInfo => ({
  platform: 'win32',
  arch: 'x64',
  chip: 'Intel Core i7-14700K',
  memoryBytes: 32 * 1024 ** 3,
  gpus: vendor ? [{ name: 'GPU', vendor, unifiedMemory: false, apis: ['directml'] }] : [],
  neuralEngine: false,
  cpuCores: { total: 28, performance: 8, efficiency: 12 },
  freeDiskBytes: 0,
  osVersion: '10.0.22631',
});

describe('hardwareVideoEngine', () => {
  it('is VideoToolbox on every recorded Mac, Apple Silicon or Intel', async () => {
    for (const name of ['m1-8gb', 'm5-max-64gb-dev-machine', 'intel-i9-16gb'] as const)
      expect(hardwareVideoEngine(await probeMacFixture(name))).toBe('videotoolbox');
  });

  it("is the primary GPU's engine on other machines (not run on real hardware)", () => {
    expect(hardwareVideoEngine(pc('nvidia'))).toBe('nvidia');
    expect(hardwareVideoEngine(pc('intel'))).toBe('intel');
    expect(hardwareVideoEngine(pc('amd'))).toBe('amd');
    expect(hardwareVideoEngine(pc('other'))).toBe('none');
    expect(hardwareVideoEngine(pc())).toBe('none');
  });

  it('on Linux: NVENC on an NVIDIA GPU CUDA can open, else VA-API on Intel or AMD, else none', () => {
    const gpu = (vendor: GpuVendor, change: Partial<GpuInfo> = {}): GpuInfo => ({
      name: 'GPU',
      vendor,
      unifiedMemory: false,
      apis: vendor === 'nvidia' ? ['cuda', 'vulkan'] : ['vulkan'],
      renderNode: '/dev/dri/renderD128',
      ...change,
    });
    const box = (gpus: GpuInfo[], change: Partial<HardwareInfo> = {}): HardwareInfo => ({
      ...pc(),
      platform: 'linux',
      gpus,
      ...change,
    });
    expect(hardwareVideoEngine(box([gpu('nvidia'), gpu('intel')]))).toBe('nvidia');
    // CUDA hidden (CUDA_VISIBLE_DEVICES=-1) or no proprietary driver: NVDEC/NVENC can't open the card.
    expect(hardwareVideoEngine(box([gpu('nvidia', { apis: ['vulkan'] }), gpu('intel')]))).toBe('vaapi');
    expect(hardwareVideoEngine(box([gpu('nvidia', { apis: ['vulkan'] })]))).toBe('none');
    expect(hardwareVideoEngine(box([gpu('amd')]))).toBe('vaapi');
    expect(hardwareVideoEngine(box([gpu('intel', { renderNode: undefined })]))).toBe('none');
    expect(hardwareVideoEngine(box([]))).toBe('none');
    // TAALCUT_FORCE_CPU: no hardware video either, here or on Windows.
    expect(hardwareVideoEngine(box([gpu('nvidia', { apis: [] })], { forcedCpu: true }))).toBe('none');
    expect(hardwareVideoEngine({ ...pc('nvidia'), forcedCpu: true })).toBe('none');
  });
});
