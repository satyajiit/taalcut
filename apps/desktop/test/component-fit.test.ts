// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1 seam 4 in the app: the probe's HardwareInfo as packages/jobs' machine description, and which components run
 * here: the manifest's `requires`, or the Core ML embedder's macOS 15 rule the shipped manifest doesn't state yet.
 */
import { describe, expect, it } from 'vitest';
import { componentFits, describeMachine } from '../src/utility/roots/component-fit';

const GiB = 1024 ** 3;
const mac = (osVersion: string) =>
  describeMachine({
    platform: 'darwin',
    arch: 'arm64',
    osVersion,
    gpus: [{ vendor: 'apple', apis: ['metal'] }],
  });
/** The LNX1 host as the Linux probe reports it. */
const host = describeMachine({
  platform: 'linux',
  arch: 'x64',
  osVersion: '24.04',
  gpus: [
    {
      vendor: 'nvidia',
      apis: ['cuda', 'vulkan'],
      vramBytes: 24 * GiB,
      driverVersion: '615.71.09',
      computeCapability: '8.9',
    },
  ],
});
const CUDA_13 = { gpuApi: 'cuda', minDriver: '580', minComputeCapability: '7.5' };

describe('describeMachine', () => {
  it('adds the glibc the process runs on, where there is one', () => {
    const linux = { platform: 'linux', arch: 'x64', osVersion: '22.04', gpus: [] };
    expect(describeMachine(linux, '2.35').glibcVersion).toBe('2.35');
    expect('glibcVersion' in describeMachine(linux, null)).toBe(false);
  });

  it('keeps what the probe knows and leaves out what it does not', () => {
    expect(host.gpus[0]).toEqual({
      vendor: 'nvidia',
      apis: ['cuda', 'vulkan'],
      vramBytes: 24 * GiB,
      driverVersion: '615.71.09',
      computeCapability: '8.9',
    });
    expect(mac('15.1').gpus[0]).toEqual({ vendor: 'apple', apis: ['metal'] });
  });
});

describe('componentFits', () => {
  it('offers the Core ML embedder from macOS 15 only, and every other component everywhere', () => {
    const coreMl = { id: 'embeddinggemma-2-coreml' };
    expect(componentFits(coreMl, mac('15.0'))).toBe(true);
    expect(componentFits(coreMl, mac('26.1'))).toBe(true);
    expect(componentFits(coreMl, mac('14.7.2'))).toBe(false);
    expect(componentFits(coreMl, undefined)).toBe(false);
    expect(componentFits(coreMl, host)).toBe(false);
    expect(componentFits({ id: 'embeddinggemma-2' }, mac('14.7.2'))).toBe(true);
    expect(componentFits({ id: 'embeddinggemma-2' }, undefined)).toBe(true);
  });

  it("checks the manifest's own requires: CUDA 13 on the RTX 4090 host, not with the GPU hidden", () => {
    const cuda = { id: 'onnxruntime-cuda', requires: CUDA_13 };
    expect(componentFits(cuda, host)).toBe(true);
    expect(componentFits(cuda, { ...host, gpus: [] })).toBe(false);
    expect(componentFits(cuda, undefined)).toBe(false);
    // A probe that can't read the driver yet (no driverVersion) meets no driver minimum.
    const unread = describeMachine({
      platform: 'linux',
      arch: 'x64',
      osVersion: '24.04',
      gpus: [{ vendor: 'nvidia', apis: ['cuda'] }],
    });
    expect(componentFits(cuda, unread)).toBe(false);
  });
});
