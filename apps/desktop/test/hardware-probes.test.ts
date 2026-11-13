// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-S6 and LNX1 wiring: a HardwareProbe per platform (macOS, Linux, Windows), from the platform services.
 * hardwareReport passes the OS name and a summary of each GPU through (core's gpuSummarySchema).
 */
import { hardwareReportSchema } from '@taalcut/core';
import { assessHardware, type HardwareInfo } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { hostPlatform } from '../src/platform';
import { hardwareReport } from '../src/utility/roots/system-info';
import { fakeHardware } from './helpers/roots';

const GIB = 1024 ** 3;

describe("the platform services' hardware probe", () => {
  it('has a probe for macOS, Linux and Windows', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const)
      expect(typeof hostPlatform(platform).hardwareProbe('/tmp/taalcut').probe).toBe('function');
  });

  it.runIf(process.platform === 'linux')('hands the Linux probe the environment it is given', async () => {
    const forced = await hostPlatform('linux').hardwareProbe('/tmp', { TAALCUT_FORCE_CPU: '1' }).probe();
    expect(forced.ok && forced.value.forcedCpu).toBe(true);
    expect(forced.ok && forced.value.gpus.every((gpu) => gpu.apis.length === 0)).toBe(true);
  });
});

describe('hardwareReport', () => {
  it('passes the OS name and each GPU through: name, vendor, VRAM, driver, APIs', () => {
    const info: HardwareInfo = {
      platform: 'linux',
      arch: 'x64',
      chip: 'Intel(R) Core(TM) i9-14900KS',
      memoryBytes: 61 * GIB,
      gpus: [
        {
          name: 'NVIDIA GeForce RTX 4090',
          vendor: 'nvidia',
          vramBytes: 24564 * 1024 ** 2,
          vramFreeBytes: 21090 * 1024 ** 2,
          unifiedMemory: false,
          apis: ['cuda', 'vulkan'],
          driverVersion: '615.71.09',
          computeCapability: '8.9',
          index: 0,
          cudaDeviceId: 0,
          pciBusId: '0000:01:00.0',
          renderNode: '/dev/dri/renderD129',
          kernelDriver: 'nvidia',
        },
        { name: 'Intel UHD Graphics 770', vendor: 'intel', unifiedMemory: false, apis: ['vulkan'] },
      ],
      neuralEngine: false,
      cpuCores: { total: 32, performance: 16, efficiency: 16 },
      freeDiskBytes: 300 * GIB,
      osVersion: '24.04',
      osName: 'Ubuntu 24.04.5 LTS',
    };
    const report = hardwareReport({ info, assessment: assessHardware(info) });
    expect(hardwareReportSchema.parse(report)).toEqual(report);
    expect(report.info.osName).toBe('Ubuntu 24.04.5 LTS');
    expect(report.info.gpus).toEqual([
      {
        name: 'NVIDIA GeForce RTX 4090',
        vendor: 'nvidia',
        vramBytes: 24564 * 1024 ** 2,
        driverVersion: '615.71.09',
        apis: ['cuda', 'vulkan'],
      },
      { name: 'Intel UHD Graphics 770', vendor: 'intel', apis: ['vulkan'] },
    ]);
    expect(report).toMatchObject({ tier: 'high', shortfalls: [] });
  });

  it('a Mac: no OS name, the Apple GPU without VRAM (unified memory)', async () => {
    const report = hardwareReport(await fakeHardware());
    expect(hardwareReportSchema.parse(report)).toEqual(report);
    expect(report.info.osName).toBeUndefined();
    expect(report.info.gpus?.[0]).not.toHaveProperty('vramBytes');
    expect(report.info.gpus?.[0]?.vendor).toBe('apple');
  });
});
