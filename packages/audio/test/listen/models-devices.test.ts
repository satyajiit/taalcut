// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EAR1-F4: the listening models' device rows follow Beat This!'s (ADR 0002). */
import { describe, expect, it } from 'vitest';
import { BEAT_DEVICES } from '../../src/beats/devices';
import { LISTEN_DEVICES, listenDevicePlan } from '../../src/listen/models/devices';

describe('listenDevicePlan', () => {
  it('has the same rows as Beat This!', () => {
    expect(LISTEN_DEVICES).toEqual(BEAT_DEVICES);
  });

  it('a Mac: WebGPU, then the CPU', () => {
    expect(listenDevicePlan('darwin')).toEqual({ devices: ['webgpu', 'cpu'] });
  });

  it('Linux with CUDA keeps the probe’s device', () => {
    const plan = listenDevicePlan('linux', {
      platform: 'linux',
      apis: ['cuda', 'vulkan'],
      cudaDeviceId: 1,
      forcedCpu: false,
    });
    expect(plan.devices).toEqual(['cuda', 'webgpu', 'cpu']);
    expect(plan.cudaDeviceId).toBe(1);
  });

  it('TAALCUT_FORCE_CPU: the CPU alone, `disabled`, naming what was wanted', () => {
    const plan = listenDevicePlan('linux', { platform: 'linux', apis: [], forcedCpu: true });
    expect(plan.devices).toEqual(['cpu']);
    expect(plan.cpuReason).toMatchObject({ reason: 'disabled', wanted: ['cuda', 'webgpu'] });
  });

  it('no usable GPU API: `no_accelerator`', () => {
    const plan = listenDevicePlan('linux', { platform: 'linux', apis: [], forcedCpu: false });
    expect(plan.cpuReason?.reason).toBe('no_accelerator');
  });
});
