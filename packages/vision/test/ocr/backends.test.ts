// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { MachineAccelerators } from '@taalcut/media';
import { describe, expect, it } from 'vitest';
import { planOcrBackends } from '../../src/ocr/backends';
import { PADDLE_DEVANAGARI, PADDLE_LATIN } from '../../src/ocr/paddle/models';

const linux = (apis: MachineAccelerators['apis'], forcedCpu = false): MachineAccelerators => ({
  platform: 'linux',
  apis,
  forcedCpu,
});

describe('planOcrBackends', () => {
  it('keeps Apple Vision for Latin on a Mac with the helper, PP-OCR Latin everywhere else', () => {
    expect(planOcrBackends({ platform: 'darwin', helper: true })).toEqual({
      latin: 'apple-vision',
      devanagari: PADDLE_DEVANAGARI,
      ortDevices: ['webgpu', 'cpu'],
      disableGpu: false,
    });
    expect(planOcrBackends({ platform: 'darwin', helper: false }).latin).toBe(PADDLE_LATIN);
    const windows = planOcrBackends({ platform: 'win32', helper: false });
    expect(windows.latin).toBe(PADDLE_LATIN);
    expect(windows.ortDevices).toEqual(['cuda', 'directml', 'webgpu', 'cpu']);
  });

  it('never takes Apple Vision off a Mac, whatever says there is a helper', () => {
    expect(planOcrBackends({ platform: 'linux', helper: true }).latin).toBe(PADDLE_LATIN);
  });

  it('runs PP-OCR on the devices the probe found: CUDA, then WebGPU, then the CPU', () => {
    expect(planOcrBackends({ platform: 'linux', helper: false }).ortDevices).toEqual(['cuda', 'webgpu', 'cpu']);
    const nvidia = planOcrBackends({ platform: 'linux', helper: false, accelerators: linux(['cuda', 'vulkan']) });
    expect(nvidia).toEqual({
      latin: PADDLE_LATIN,
      devanagari: PADDLE_DEVANAGARI,
      ortDevices: ['cuda', 'webgpu', 'cpu'],
      disableGpu: false,
    });
  });

  it('drops CUDA below its floor and goes to the CPU alone when forced, saying so', () => {
    // An NVIDIA driver older than 580: the probe's usable APIs have Vulkan only.
    const old = planOcrBackends({ platform: 'linux', helper: false, accelerators: linux(['vulkan']) });
    expect(old.ortDevices).toEqual(['webgpu', 'cpu']);
    const forced = planOcrBackends({ platform: 'linux', helper: false, accelerators: linux([], true) });
    expect(forced).toMatchObject({ ortDevices: ['cpu'], disableGpu: true });
  });
});
