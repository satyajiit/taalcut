// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ADR 0002, GPU first: every local model records the backends it can run on,
 * the machine's backends pick one, and a local model that would land on the
 * CPU is labelled and tried only after every GPU or cloud option.
 */
import { describe, expect, it } from 'vitest';
import {
  createCatalog,
  createMemoryProfileStore,
  createModelProfiles,
  MODEL_CATALOG,
  resolveModule,
  selectCompute,
  type ComputeBackend,
} from '@taalcut/models';

const APPLE_SILICON: readonly ComputeBackend[] = ['metal', 'mlx', 'coreml', 'ane', 'cpu'];
const INTEL_MAC: readonly ComputeBackend[] = ['coreml', 'cpu'];

describe('compute selection', () => {
  it('takes the first accelerated backend both sides have', () => {
    expect(selectCompute(['ane', 'coreml', 'cpu'], APPLE_SILICON)).toEqual({
      backend: 'ane',
      accelerated: true,
      labelKey: 'models.compute.ane',
    });
    expect(selectCompute(['cuda', 'metal', 'cpu'], APPLE_SILICON).backend).toBe('metal');
  });

  it('falls back to the CPU only when it must, and says why', () => {
    expect(selectCompute(['metal', 'cpu'], INTEL_MAC)).toEqual({
      backend: 'cpu',
      accelerated: false,
      cpuReason: 'hardware_lacks_backend',
      labelKey: 'models.compute.cpu',
    });
    expect(selectCompute(['cpu'], APPLE_SILICON).cpuReason).toBe('no_accelerated_backend');
  });

  it('records compute for every local catalogue entry, accelerated backends first', () => {
    for (const entry of MODEL_CATALOG.filter((e) => e.local)) {
      expect(entry.compute, `${entry.provider}/${entry.model}`).toBeDefined();
      const list = entry.compute ?? [];
      const firstCpu = list.indexOf('cpu');
      // 'cpu', when listed, is last: nothing accelerated is ever ranked behind it.
      if (firstCpu >= 0) expect(firstCpu).toBe(list.length - 1);
    }
  });
});

describe('GPU-first chains', () => {
  const catalog = createCatalog([
    {
      provider: 'local',
      model: 'gpu-or-cpu',
      kind: 'chat',
      servedBy: 'taalcut',
      local: true,
      compute: ['metal', 'cpu'],
    },
  ]);
  const setting = {
    chain: [
      { provider: 'local', model: 'gpu-or-cpu' },
      { provider: 'openai', model: 'gpt-5.4-mini' },
    ],
  };
  const context = { catalog, tier: 'high' as const, today: '2026-10-12' };

  it('keeps a local model first when it runs on the GPU here', () => {
    const resolved = resolveModule('agent', setting, undefined, { ...context, backends: APPLE_SILICON });
    expect(resolved.chain.map((c) => c.provider)).toEqual(['local', 'openai']);
    expect(resolved.compute['local/gpu-or-cpu']).toMatchObject({ backend: 'metal', accelerated: true });
    expect(resolved.cpuDemoted).toEqual([]);
  });

  it('moves a local model that would run on the CPU behind the cloud option, labelled', () => {
    const resolved = resolveModule('agent', setting, undefined, { ...context, backends: INTEL_MAC });
    expect(resolved.chain.map((c) => c.provider)).toEqual(['openai', 'local']);
    expect(resolved.cpuDemoted).toEqual([{ provider: 'local', model: 'gpu-or-cpu' }]);
    expect(resolved.compute['local/gpu-or-cpu']).toMatchObject({
      backend: 'cpu',
      cpuReason: 'hardware_lacks_backend',
      labelKey: 'models.compute.cpu',
    });
  });

  it('applies the machine compute the probe reported to profile resolution', () => {
    const profiles = createModelProfiles({ store: createMemoryProfileStore() });
    profiles.setHardware({
      tier: 'high',
      compute: { backends: APPLE_SILICON, gpuMemoryBytes: 64 * 1024 ** 3, neuralEngine: true },
    });
    const embeddings = profiles.effective('embeddings');
    expect(Object.values(embeddings.compute).map((c) => c.backend)).toEqual(['ane']);
  });
});
