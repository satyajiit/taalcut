// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The model picker's options per module, and the compute report for Settings
 * → About: tier gating, unconfigured cloud providers, the embedded runtime's
 * entries, and where each local model runs (GPU first, CPU with its reason).
 */
import { CHATGPT_PROVIDER, ok, type ModelOption } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  computeReport,
  createMemoryProfileStore,
  createModelProfiles,
  createModelRuntime,
  createModelSettingsService,
  type ComputeSummary,
  type LocalRuntime,
} from '@taalcut/models';

const APPLE: ComputeSummary = {
  backends: ['metal', 'mlx', 'coreml', 'ane', 'cpu'],
  gpu: {
    name: 'Apple M5 Max',
    vendor: 'apple',
    cores: 40,
    unifiedMemory: true,
    apis: ['metal'],
    metalFamily: 'metal4',
  },
  gpuMemoryBytes: 64 * 1024 ** 3,
  neuralEngine: true,
};

/** An M1 with 8 GB: the Minimum tier, with the same GPU-first backends. */
const M1_8GB: ComputeSummary = {
  ...APPLE,
  gpu: {
    name: 'Apple M1',
    vendor: 'apple',
    cores: 8,
    unifiedMemory: true,
    apis: ['metal'],
    metalFamily: 'metal3',
  },
  gpuMemoryBytes: 8 * 1024 ** 3,
};

function setup(
  configured: readonly string[] = ['openai'],
  installed?: readonly string[],
  day = '2026-10-12',
) {
  const profiles = createModelProfiles({ store: createMemoryProfileStore() });
  const runtime = createModelRuntime({ builtinProviders: ['openai', 'google', 'anthropic'] });
  const service = createModelSettingsService({
    profiles,
    runtime,
    configuredProviders: async () => new Set(configured),
    ...(installed ? { installedLocalModels: () => new Set(installed) } : {}),
    today: () => day,
  });
  return { profiles, runtime, service };
}
const find = (options: readonly ModelOption[], provider: string, model: string) =>
  options.find((o) => o.provider === provider && o.model === model);

describe('model options', () => {
  it('lists the embedded runtime for vision, gated by tier, with where it would run', async () => {
    const { runtime, service } = setup();
    expect(find(await service.options({ module: 'vision' }), 'on-device', 'qwen3.5-4b')).toEqual({
      provider: 'on-device',
      model: 'qwen3.5-4b',
      name: 'Qwen3.5 4B',
      local: true,
      reasoning: true,
      // On this Mac it answers without thinking: the chat offers it Quick only.
      thinking: ['off'],
      inProfile: true,
      noteKey: 'models.note.local_lower_quality',
      unavailable: 'needs-higher-tier',
    });

    service.setHardware({ tier: 'recommended', defaultProfileId: 'balanced', compute: APPLE });
    const options = await service.options({ module: 'vision' });
    expect(find(options, 'on-device', 'qwen3.5-4b')).toMatchObject({
      compute: { backend: 'metal', accelerated: true, labelKey: 'models.compute.metal' },
    });
    expect(find(options, 'on-device', 'qwen3.5-4b')).not.toHaveProperty('unavailable');
    // Vision needs image input: a text-only chat model is offered for the agent, not for vision.
    const textOnly = runtime
      .listModels()
      .find((m) => m.kind === 'chat' && !m.input.includes('image') && m.provider === 'openai');
    expect(textOnly).toBeDefined();
    expect(find(options, 'openai', textOnly!.id)).toBeUndefined();
    expect(find(await service.options({ module: 'agent' }), 'openai', textOnly!.id)).toBeDefined();
    // Cloud providers without a key or sign-in are listed, marked.
    expect(find(options, 'google', 'gemini-3.5-flash')).toMatchObject({ unavailable: 'not-configured' });
    expect(find(options, 'openai', 'gpt-5.4')).not.toHaveProperty('unavailable');
    // Pickable ones first.
    const firstUnavailable = options.findIndex((o) => o.unavailable !== undefined);
    expect(options.slice(firstUnavailable).every((o) => o.unavailable !== undefined)).toBe(true);
  });

  it('offers the 0.8B for the agent on an 8 GB Mac, and not for vision (text only)', async () => {
    const { service } = setup();
    service.setHardware({ tier: 'minimum', defaultProfileId: 'balanced', compute: M1_8GB });
    const agent = await service.options({ module: 'agent' });
    expect(find(agent, 'on-device', 'qwen3.5-0.8b')).toEqual({
      provider: 'on-device',
      model: 'qwen3.5-0.8b',
      name: 'Qwen3.5 0.8B',
      local: true,
      reasoning: true,
      thinking: ['off'],
      inProfile: true,
      noteKey: 'models.note.local_lower_quality',
      compute: { backend: 'metal', accelerated: true, labelKey: 'models.compute.metal' },
    });
    expect(find(agent, 'on-device', 'qwen3.5-4b')).toMatchObject({ unavailable: 'needs-higher-tier' });
    expect(find(await service.options({ module: 'vision' }), 'on-device', 'qwen3.5-0.8b')).toBeUndefined();
  });

  it('offers on-device embeddings and speech with their GPU route, and no own server unless set up', async () => {
    const { service } = setup();
    service.setHardware({ tier: 'recommended', defaultProfileId: 'balanced', compute: APPLE });
    expect(await service.options({ module: 'embeddings' })).toEqual([
      {
        provider: 'onnx',
        model: 'embeddinggemma-2',
        name: 'EmbeddingGemma 2',
        local: true,
        reasoning: false,
        inProfile: true,
        // The contract's MODEL_COMPUTE_BACKENDS still spells core's 'ane' and 'coreml' the old way.
        compute: { backend: 'ane', accelerated: true, labelKey: 'models.compute.ane' },
      },
    ]);
    const speech = await service.options({ module: 'speech' });
    expect(find(speech, 'sherpa-onnx', 'parakeet-tdt-0.6b-v3')?.compute?.backend).toBe('coreml');
    expect(find(speech, 'whisper-cpp', 'large-v3-turbo')?.compute?.backend).toBe('metal');
    const agent = await service.options({ module: 'agent' });
    expect(agent.some((o) => o.provider === 'ollama')).toBe(false);
  });
});

describe('the chat’s model menu', () => {
  it('marks profile models and the reasoning levels each takes', async () => {
    const { service } = setup(['openai', 'anthropic']);
    const agent = await service.options({ module: 'agent' });
    expect(find(agent, 'openai', 'gpt-6.1-sol')).toMatchObject({
      inProfile: true,
      thinking: ['low', 'medium', 'high', 'xhigh', 'max'],
    });
    expect(find(agent, 'anthropic', 'claude-opus-5-5')).toMatchObject({
      inProfile: true,
      thinking: ['low', 'medium', 'high', 'xhigh', 'max'],
    });
    // pi-ai's other models are offered too, in Settings, without the mark.
    expect(find(agent, 'openai', 'gpt-4.1')).toMatchObject({ thinking: ['off'] });
    expect(find(agent, 'openai', 'gpt-4.1')).not.toHaveProperty('inProfile');
  });

  it('offers only the current generation of the providers Taalcut lists, once pi-ai 1.4.0 replaced the rest', async () => {
    const { service } = setup(['openai', 'anthropic', 'google'], undefined, '2026-10-27');
    const agent = await service.options({ module: 'agent' });
    const of = (provider: string) => agent.filter((o) => o.provider === provider).map((o) => o.model);
    expect(of('openai').sort()).toEqual(['gpt-6-astra', 'gpt-6-luna', 'gpt-6.1-sol']);
    expect(of('anthropic').sort()).toEqual([
      'claude-fable-5-1',
      'claude-haiku-5-5',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
    ]);
    expect(of('google').sort()).toEqual(['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-4-argon']);
  });

  it('offers OpenAI’s official levels: the API’s none on a key, ChatGPT’s low to max on the plan', async () => {
    const key = setup(['openai'], undefined, '2026-10-27');
    const onKey = await key.service.options({ module: 'agent' });
    expect(find(onKey, 'openai', 'gpt-6-luna')?.thinking).toEqual([
      'off',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    // GPT-6 Astra and GPT-6.1 Sol take no none (OpenAI's reasoning guide).
    expect(find(onKey, 'openai', 'gpt-6-astra')?.thinking).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    const plan = setup(['openai', CHATGPT_PROVIDER], undefined, '2026-10-27');
    const onPlan = await plan.service.options({ module: 'agent' });
    for (const model of ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra']) {
      expect(find(onPlan, 'openai', model)?.thinking, model).toEqual([
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
      ]);
    }
  });

  it('marks an on-device model that isn’t downloaded yet', async () => {
    const recommended = { tier: 'recommended', defaultProfileId: 'balanced', compute: APPLE } as const;
    const none = setup(['openai'], []);
    none.service.setHardware(recommended);
    expect(find(await none.service.options({ module: 'agent' }), 'on-device', 'qwen3.5-4b')).toMatchObject({
      unavailable: 'not-installed',
    });
    const got = setup(['openai'], ['qwen3.5-4b']);
    got.service.setHardware(recommended);
    expect(
      find(await got.service.options({ module: 'agent' }), 'on-device', 'qwen3.5-4b'),
    ).not.toHaveProperty('unavailable');
  });
});

describe('compute report', () => {
  it('names the GPU and what each local module runs on', async () => {
    const { profiles } = setup();
    profiles.setHardware({ tier: 'recommended', compute: APPLE });
    expect(await computeReport({ profiles, hardware: { compute: APPLE } })).toEqual(
      ok({
        gpu: { name: 'Apple M5 Max', cores: 40, api: 'Metal 4' },
        modules: [
          { module: 'vision', runtime: 'llama.cpp b11571', backend: 'metal' },
          { module: 'embeddings', runtime: 'ONNX Runtime', backend: 'ane' },
          { module: 'speech', runtime: 'sherpa-onnx', backend: 'coreml' },
        ],
      }),
    );
  });

  it('shows a discrete GPU with its VRAM, driver and the API Taalcut uses on it (LNX1)', async () => {
    const { profiles } = setup();
    const rtx = (driverVersion: string): ComputeSummary => ({
      backends: ['cuda', 'vulkan', 'cpu'],
      gpu: {
        name: 'NVIDIA GeForce RTX 4090',
        vendor: 'nvidia',
        vramBytes: 24564 * 1024 ** 2,
        unifiedMemory: false,
        apis: ['cuda', 'vulkan'],
        driverVersion,
        computeCapability: '8.9',
      },
      gpuMemoryBytes: 24564 * 1024 ** 2,
      neuralEngine: false,
    });
    const report = await computeReport({ profiles, hardware: { compute: rtx('615.71.09') } });
    expect(report.ok && report.value.gpu).toEqual({
      name: 'NVIDIA GeForce RTX 4090',
      api: 'CUDA',
      vramBytes: 24564 * 1024 ** 2,
      driverVersion: '615.71.09',
    });
    // A driver too old for CUDA 13: the API shown is the one local models get.
    const old = await computeReport({ profiles, hardware: { compute: rtx('570.172.08') } });
    expect(old.ok && old.value.gpu?.api).toBe('Vulkan');
  });

  it("shows the runtime's own report when the GPU failed at load, with the reason", async () => {
    const { profiles } = setup();
    profiles.setHardware({ tier: 'recommended', compute: APPLE });
    const localRuntime: Pick<LocalRuntime, 'status' | 'loadedModels'> = {
      status: () => ({ state: 'running', installedModels: ['qwen3.5-4b'], restarts: 0 }),
      loadedModels: async () =>
        ok([
          {
            id: 'qwen3.5-4b',
            compute: {
              backend: 'cpu',
              accelerated: false,
              cpuReason: 'gpu_failed_at_runtime',
              labelKey: 'models.compute.cpu',
            },
          },
        ]),
    };
    const report = await computeReport({ profiles, hardware: { compute: APPLE }, localRuntime });
    expect(report.ok && report.value.modules[0]).toEqual({
      module: 'vision',
      runtime: 'llama.cpp b11571',
      backend: 'cpu',
      fallbackReasonKey: 'compute.fallback.gpu_failed_at_runtime',
    });
  });

  it("reports Local only's agent on the 0.8B on an 8 GB Mac's GPU, and no local vision there", async () => {
    const { profiles } = setup();
    profiles.setHardware({ tier: 'minimum', compute: M1_8GB });
    await profiles.setActiveProfile('local-only');
    const report = await computeReport({ profiles, hardware: { compute: M1_8GB } });
    expect(report.ok && report.value.gpu).toEqual({ name: 'Apple M1', cores: 8, api: 'Metal 3' });
    expect(
      report.ok && report.value.modules.filter((m) => m.module === 'agent' || m.module === 'vision'),
    ).toEqual([{ module: 'agent', runtime: 'llama.cpp b11571', backend: 'metal' }]);
  });

  it('leaves out what an 8 GB Mac runs in the cloud, and reports a CPU-only machine with the reason', async () => {
    const { profiles } = setup();
    const cpuOnly: ComputeSummary = { backends: ['cpu'], gpuMemoryBytes: 0, neuralEngine: false };
    profiles.setHardware({ tier: 'minimum', compute: cpuOnly });
    const report = await computeReport({ profiles, hardware: { compute: cpuOnly } });
    expect(report).toEqual(
      ok({
        modules: [
          {
            module: 'embeddings',
            runtime: 'ONNX Runtime',
            backend: 'cpu',
            fallbackReasonKey: 'compute.fallback.gpu_unsupported',
          },
          {
            module: 'speech',
            runtime: 'sherpa-onnx',
            backend: 'cpu',
            fallbackReasonKey: 'compute.fallback.gpu_unsupported',
          },
        ],
      }),
    );
  });
});
