// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-T4: the decode profile the jobs process gives media's thumbnail and
 * filmstrip, from the hardware probe (the engine the session cap uses too).
 * A Mac decodes on VideoToolbox, an NVIDIA Windows machine on NVDEC, other
 * Windows GPUs on D3D11VA, and a failed probe leaves the plan's own route.
 * No FFmpeg runs here; the Windows profiles have not run on Windows hardware.
 */
import { describe, expect, it } from 'vitest';
import { assessHardware, type HardwareInfo } from '@taalcut/models';
import { hardwareDecodeProfile, hardwareVideoBackends } from '../src/utility/roots/media-jobs';
import { fakeHardware, M3_INFO } from './helpers/roots';

const GIB = 1024 ** 3;

function windows(vendor: 'nvidia' | 'amd' | 'intel'): HardwareInfo {
  return {
    ...M3_INFO,
    platform: 'win32',
    arch: 'x64',
    chip: 'x64',
    appleChip: undefined,
    gpus: [{ name: `${vendor} GPU`, vendor, vramBytes: 8 * GIB, unifiedMemory: false, apis: ['directml'] }],
  };
}

const probed = (info: HardwareInfo) => async () => ({ info, assessment: assessHardware(info) });

describe('hardwareDecodeProfile', () => {
  it('VideoToolbox on a Mac', async () => {
    expect(await hardwareDecodeProfile(fakeHardware)()).toEqual({ decoder: 'videotoolbox' });
  });

  it('NVDEC on an NVIDIA Windows machine, D3D11VA on AMD and Intel', async () => {
    expect(await hardwareDecodeProfile(probed(windows('nvidia')))()).toEqual({ decoder: 'nvdec' });
    expect(await hardwareDecodeProfile(probed(windows('amd')))()).toEqual({ decoder: 'd3d11va' });
    expect(await hardwareDecodeProfile(probed(windows('intel')))()).toEqual({ decoder: 'd3d11va' });
  });

  it('no profile when the probe fails', async () => {
    expect(await hardwareDecodeProfile(() => Promise.reject(new Error('no probe')))()).toBeUndefined();
  });
});

/** LNX1: the hardware video rows media proves, from the same probe. */
describe('hardwareVideoBackends', () => {
  const linux = (apis: string[], forcedCpu?: boolean): HardwareInfo =>
    ({
      ...windows('nvidia'),
      platform: 'linux',
      gpus: [
        {
          name: 'NVIDIA GeForce RTX 4090',
          vendor: 'nvidia',
          vramBytes: 24 * GIB,
          unifiedMemory: false,
          apis,
        },
      ],
      ...(forcedCpu ? { forcedCpu } : {}),
    }) as HardwareInfo;

  it('VideoToolbox on a Mac, CUDA on an NVIDIA Linux machine CUDA can open', async () => {
    expect(await hardwareVideoBackends(fakeHardware)()).toEqual({ backends: ['videotoolbox'] });
    expect(await hardwareVideoBackends(probed(linux(['cuda', 'vulkan'])))()).toEqual({ backends: ['cuda'] });
  });

  it('none with the GPU hidden from CUDA, and turned off on purpose with TAALCUT_FORCE_CPU', async () => {
    expect(await hardwareVideoBackends(probed(linux(['vulkan'])))()).toEqual({ backends: [] });
    expect(await hardwareVideoBackends(probed(linux([], true)))()).toEqual({
      backends: [],
      disabled: 'hardware video turned off (TAALCUT_FORCE_CPU=1)',
    });
  });

  it('nothing named when the probe fails', async () => {
    expect(await hardwareVideoBackends(() => Promise.reject(new Error('no probe')))()).toBeUndefined();
  });
});
