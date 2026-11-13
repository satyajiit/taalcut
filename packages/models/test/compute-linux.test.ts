// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-ML: WebGPU as a model backend where ONNX Runtime has it (Metal, Vulkan, Direct3D 12), and TAALCUT_FORCE_CPU
 * recorded as `disabled` (compute.fallback.disabled) wherever a model's compute is shown: the option, the report's
 * plan and the profile's resolution.
 */
import type { HardwareInfo } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import {
  availableBackends,
  createCatalog,
  fallbackReasonKey,
  resolveModule,
  selectCompute,
  type ComputeBackend,
} from '@taalcut/models';
import { optionCompute } from '../src/settings/model-options';

const GIB = 1024 ** 3;
const linux = (apis: HardwareInfo['gpus'][number]['apis'], forcedCpu = false): HardwareInfo => ({
  platform: 'linux',
  arch: 'x64',
  chip: 'AMD Ryzen 9 7950X',
  memoryBytes: 64 * GIB,
  gpus: [{ name: 'Radeon RX 7900 XTX', vendor: 'amd', vramBytes: 24 * GIB, unifiedMemory: false, apis }],
  neuralEngine: false,
  cpuCores: { total: 32 },
  freeDiskBytes: 500 * GIB,
  osVersion: '24.04',
  ...(forcedCpu ? { forcedCpu } : {}),
});
const EMBEDDINGS = { provider: 'onnx', model: 'embeddinggemma-2' };

describe('WebGPU as a model backend', () => {
  it('is offered with Vulkan, and not without a GPU API', () => {
    expect(availableBackends(linux(['vulkan']))).toEqual(['vulkan', 'webgpu', 'cpu']);
    expect(availableBackends(linux([]))).toEqual(['cpu']);
  });

  it('runs EmbeddingGemma 2 on WebGPU on an AMD Linux PC, not the CPU', () => {
    const entry = createCatalog().find(EMBEDDINGS);
    expect(entry?.compute).toContain('webgpu');
    expect(optionCompute(entry, availableBackends(linux(['vulkan'])))).toEqual({
      backend: 'webgpu',
      accelerated: true,
      labelKey: 'models.compute.webgpu',
    });
  });
});

describe('TAALCUT_FORCE_CPU', () => {
  const forced = availableBackends(linux(['vulkan'], true));

  it('offers the CPU alone, and a CPU choice says disabled', () => {
    expect(forced).toEqual(['cpu']);
    const backends: readonly ComputeBackend[] = ['cuda', 'vulkan', 'cpu'];
    expect(selectCompute(['cuda', 'cpu'], backends, { forcedCpu: true })).toEqual({
      backend: 'cpu',
      accelerated: false,
      cpuReason: 'disabled',
      labelKey: 'models.compute.cpu',
    });
    // A model with no GPU version still says so.
    expect(selectCompute(['cpu'], forced, { forcedCpu: true }).cpuReason).toBe('no_accelerated_backend');
  });

  it('shows compute.fallback.disabled on the option and in the profile', () => {
    expect(fallbackReasonKey('disabled')).toBe('compute.fallback.disabled');
    const catalog = createCatalog();
    expect(optionCompute(catalog.find(EMBEDDINGS), forced, true)?.fallbackReasonKey).toBe(
      'compute.fallback.disabled',
    );
    const resolved = resolveModule('embeddings', { chain: [EMBEDDINGS] }, undefined, {
      catalog,
      tier: 'high',
      today: '2026-10-27',
      backends: forced,
      forcedCpu: true,
    });
    expect(Object.values(resolved.compute).map((c) => c.cpuReason)).toEqual(['disabled']);
  });
});
