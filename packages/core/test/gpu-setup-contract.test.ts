// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-TRM: the hardware report says what an NVIDIA GPU still needs before the CUDA builds can use it (the NVIDIA
 * GPU setup card), and the pages that card links open in the browser: NVIDIA's licence texts, driver downloads and
 * CUDA GPU list, and Ubuntu's driver guide.
 */
import { describe, expect, it } from 'vitest';
import { GPU_SETUP_STATES, gpuSetupSchema, hardwareReportSchema, isExternalLink } from '@taalcut/core';

const REPORT = {
  info: {
    platform: 'linux',
    arch: 'x64',
    chip: 'AMD Ryzen 9 7950X',
    memoryBytes: 64 * 1024 ** 3,
    cpuCores: { total: 32 },
    freeDiskBytes: 500 * 1024 ** 3,
    osVersion: '24.04',
  },
  tier: 'high',
  shortfalls: ['gpu_driver_old'],
  labelKey: 'models.tier.high.label',
  shortfallKeys: ['models.hardware.gpu_driver_old'],
};
const OLD_DRIVER = {
  state: 'driver_old',
  gpuName: 'NVIDIA GeForce RTX 3060',
  driverVersion: '550.120',
  minDriver: '580',
  computeCapability: '8.6',
  minComputeCapability: '7.5',
  kernelDriver: 'nvidia',
  termsAccepted: false,
};

describe("an NVIDIA GPU's setup in the hardware report", () => {
  it('carries the state, the GPU, what it has and what CUDA 13 needs', () => {
    expect(hardwareReportSchema.parse({ ...REPORT, gpuSetup: OLD_DRIVER }).gpuSetup).toEqual(OLD_DRIVER);
    expect(hardwareReportSchema.parse(REPORT)).not.toHaveProperty('gpuSetup');
    const noDriver = {
      state: 'no_driver',
      gpuName: 'NVIDIA GA106',
      minDriver: '580',
      minComputeCapability: '7.5',
    };
    expect(
      gpuSetupSchema.safeParse({ ...noDriver, kernelDriver: 'nouveau', termsAccepted: false }).success,
    ).toBe(true);
    expect(gpuSetupSchema.safeParse({ ...OLD_DRIVER, state: 'unknown' }).success).toBe(false);
    expect(GPU_SETUP_STATES).toContain('restart_needed');
  });

  it("opens NVIDIA's and Ubuntu's pages the card links, and no other host of theirs", () => {
    for (const url of [
      'https://docs.nvidia.com/cuda/eula/index.html',
      'https://docs.nvidia.com/deeplearning/cudnn/latest/reference/eula.html',
      'https://www.nvidia.com/en-us/drivers/',
      'https://developer.nvidia.com/cuda/gpus',
      'https://ubuntu.com/server/docs/how-to/graphics/install-nvidia-drivers/',
    ])
      expect(isExternalLink(url), url).toBe(true);
    expect(isExternalLink('http://www.nvidia.com/en-us/drivers/')).toBe(false);
    expect(isExternalLink('https://download.nvidia.com/')).toBe(false);
  });
});
