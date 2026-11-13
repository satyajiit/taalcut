// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MLX1: the 9B on Taalcut's MLX server for High Apple silicon Macs, beside llama.cpp's models. The spec each
 * machine runs, what each tier installs, the server's flags, one process serving one model on the engine it names
 * (the fake server script stands in for both servers), the 4B serving while the 9B isn't there or won't start, and
 * a call that names an installed model switching the process to it.
 */
import { ok } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  attachLocalRuntime,
  componentsFor,
  createEngineDriver,
  createFakeLocalRuntimeDriver,
  createLlamaServerDriver,
  createLocalRuntime,
  createLocalRuntimeManager,
  createMemoryCloudCallSink,
  createMemoryComponentInstaller,
  createMlxServerDriver,
  createModelClient,
  createModelRuntime,
  createStaticCredentialProvider,
  llamaCppRuntimeSpec,
  localModelBudgetBytes,
  localRuntimeSpec,
  MEASURED_EMBEDDER_BYTES,
  MLX_MEASURED_PEAK_BYTES,
  mlxServerArgs,
  mlxWindowFor,
  type ComputeBackend,
  type LocalRuntimeLogEvent,
  type LocalRuntimeManager,
  type ModelChoice,
} from '@taalcut/models';
import { TEST_CREDENTIALS } from './support/harness';
import { createFakeSidecarSpawn, freeLoopbackPort, type FakeSidecarSpawn } from './support/sidecar';

const APPLE_SILICON: readonly ComputeBackend[] = ['metal', 'mlx', 'coreml', 'ane', 'cpu'];
const MAC = 'darwin-arm64';
const NINE_B: ModelChoice = { provider: 'on-device', model: 'qwen3.5-9b', reasoning: 'off' };
const FOUR_B: ModelChoice = { provider: 'on-device', model: 'qwen3.5-4b', reasoning: 'off' };
const COMPONENT_FILES = {
  'local-llm-qwen3-5-4b': 'qwen3.5-4b-q4_k_m.gguf',
  'local-llm-qwen3-5-4b-mmproj': 'qwen3.5-4b-mmproj-bf16.gguf',
};
const NINE_B_PARTS = ['local-llm-runtime-mlx', 'local-llm-qwen3-5-9b-mlx'];
const FOUR_B_PARTS = ['local-llm-runtime', 'local-llm-qwen3-5-4b', 'local-llm-qwen3-5-4b-mmproj'];

describe('the spec each machine runs', () => {
  it('serves the 9B on MLX first on a High Apple silicon Mac, then llama.cpp’s models', () => {
    const spec = localRuntimeSpec('high', MAC);
    expect(spec.models.map((m) => [m.id, m.engine ?? 'llama.cpp'])).toEqual([
      ['qwen3.5-9b', 'mlx'],
      ['qwen3.5-4b', 'llama.cpp'],
      ['qwen3.5-0.8b', 'llama.cpp'],
    ]);
    // The 4B stays: it serves while the 9B downloads, without the GPU, or when the MLX server won't start.
    expect(componentsFor(spec, 'high')).toEqual([
      ...FOUR_B_PARTS.slice(0, 1),
      ...NINE_B_PARTS,
      ...FOUR_B_PARTS.slice(1),
    ]);
    expect(componentsFor(spec, 'recommended')).toEqual(FOUR_B_PARTS);
    expect(componentsFor(spec, 'minimum')).toEqual(['local-llm-runtime', 'local-llm-qwen3-5-0-8b']);
  });

  it('keeps llama.cpp’s spec everywhere else', () => {
    for (const platform of ['linux-x64', 'darwin-x64', 'win32-x64'])
      for (const tier of ['minimum', 'recommended', 'high'] as const)
        expect(localRuntimeSpec(tier, platform), `${platform} ${tier}`).toEqual(llamaCppRuntimeSpec(tier));
  });

  it('gives the 9B the largest measured window that fits the High tier’s budget beside the embedder', () => {
    const window = mlxWindowFor('qwen3.5-9b', 'high');
    const peaks = MLX_MEASURED_PEAK_BYTES['qwen3.5-9b'] ?? {};
    const peak = peaks[window];
    expect(peak, 'measured at its window').toBeDefined();
    expect(peak! + MEASURED_EMBEDDER_BYTES).toBeLessThanOrEqual(localModelBudgetBytes('high'));
    for (const [larger, more] of Object.entries(peaks))
      if (Number(larger) > window)
        expect(more + MEASURED_EMBEDDER_BYTES).toBeGreaterThan(localModelBudgetBytes('high'));
    expect(localRuntimeSpec('high', MAC).models[0]!.contextWindow).toBe(window);
  });
});

describe('taalcut-mlx-server arguments', () => {
  it('names the model folder, the alias, loopback, the window, the compact template and the image floor', () => {
    const model = localRuntimeSpec('high', MAC).models[0]!;
    expect(mlxServerArgs({ model, weights: '/c/local-llm-qwen3-5-9b-mlx', port: 4100 })).toEqual([
      ...['--model', '/c/local-llm-qwen3-5-9b-mlx', '--alias', 'qwen3.5-9b', '--host', '127.0.0.1'],
      ...['--port', '4100', '--ctx-size', String(model.contextWindow)],
      ...['--chat-template', model.chatTemplate],
      ...['--image-min-tokens', '1024'],
    ]);
  });
});

describe('one process, one model, on its engine', () => {
  let sidecars: FakeSidecarSpawn;
  let log: LocalRuntimeLogEvent[];
  let managers: LocalRuntimeManager[];

  beforeEach(() => {
    sidecars = createFakeSidecarSpawn();
    log = [];
    managers = [];
  });
  afterEach(async () => {
    for (const manager of managers) await manager.stop();
    await sidecars.killAll();
  });

  async function setup(options: { install?: readonly string[]; backends?: readonly ComputeBackend[] } = {}) {
    const installer = createMemoryComponentInstaller({ files: COMPONENT_FILES });
    for (const id of options.install ?? [...FOUR_B_PARTS, ...NINE_B_PARTS]) await installer.install(id);
    const driverOptions = {
      spawn: sidecars,
      freePort: freeLoopbackPort,
      healthIntervalMs: 20,
      stopGraceMs: 1_000,
    };
    const manager = createLocalRuntimeManager({
      spec: localRuntimeSpec('high', MAC),
      installer,
      driver: createEngineDriver({
        'llama.cpp': createLlamaServerDriver(driverOptions),
        mlx: createMlxServerDriver(driverOptions),
      }),
      backends: options.backends ?? APPLE_SILICON,
      tier: 'high',
      idleUnloadMs: 0,
      maxRestarts: 0,
      log: (event) => log.push(event),
    });
    managers.push(manager);
    const runtime = createModelRuntime({ builtinProviders: [] });
    const attached = attachLocalRuntime(manager, [runtime]);
    const client = (chain: readonly ModelChoice[]) =>
      createModelClient({
        runtime,
        credentials: createStaticCredentialProvider(TEST_CREDENTIALS),
        callLog: createMemoryCloudCallSink(),
        localAdapter: attached.localAdapter,
        localLease: attached.localLease,
        retry: { maxRetries: 0 },
        selector: { resolve: (module) => ok({ module, choices: chain }) },
      });
    return { manager, client, installer };
  }

  const ask = async (chain: readonly ModelChoice[], client: ReturnType<typeof createModelClient>) => {
    const answer = await client.complete({ module: 'agent', messages: [{ role: 'user', content: 'Hi' }] });
    if (!answer.ok) throw new Error(answer.error.code);
    return { model: answer.value.model, ...(JSON.parse(answer.value.text) as Record<string, unknown>) };
  };

  it('starts the MLX server for the 9B, with its key and nothing else of this environment', async () => {
    const { client } = await setup();
    const chain = [NINE_B, FOUR_B];
    expect(await ask(chain, client(chain))).toMatchObject({
      model: 'qwen3.5-9b',
      served: 'qwen3.5-9b',
      engine: 'mlx',
    });
    expect(sidecars.spawned).toHaveLength(1);
    const [server] = sidecars.spawned;
    expect(server!.command).toBe('/components/local-llm-runtime-mlx/taalcut-mlx-server');
    expect(Object.keys(server!.env)).toEqual(['TAALCUT_MLX_API_KEY']);
    expect(server!.args.slice(0, 2)).toEqual(['--model', '/components/local-llm-qwen3-5-9b-mlx']);
  });

  it('serves the 4B on llama.cpp while the 9B isn’t installed, and the 9B’s call moves on at once', async () => {
    const { client } = await setup({ install: FOUR_B_PARTS });
    const chain = [NINE_B, FOUR_B];
    expect(await ask(chain, client(chain))).toMatchObject({ model: 'qwen3.5-4b', engine: 'llama.cpp' });
    expect(sidecars.spawned).toHaveLength(1);
  });

  it('treats the 9B as missing until its server is installed too', async () => {
    const { client } = await setup({ install: [...FOUR_B_PARTS, 'local-llm-qwen3-5-9b-mlx'] });
    const chain = [NINE_B, FOUR_B];
    expect(await ask(chain, client(chain))).toMatchObject({ model: 'qwen3.5-4b', engine: 'llama.cpp' });
  });

  it('falls back to the 4B on llama.cpp with the GPU turned off, and doesn’t try MLX again', async () => {
    const { client } = await setup({ backends: ['cpu'] });
    const chain = [NINE_B, FOUR_B];
    const agent = client(chain);
    expect(await ask(chain, agent)).toMatchObject({ model: 'qwen3.5-4b', engine: 'llama.cpp', gpu: false });
    expect(await ask(chain, agent)).toMatchObject({ model: 'qwen3.5-4b' });
    // One llama-server: the MLX launch failed before spawning anything, and isn't retried for the 9B's next call.
    expect(sidecars.spawned).toHaveLength(1);
  });

  it('switches to the 9B once it is installed, though the 4B started first', async () => {
    const { client, installer } = await setup({ install: FOUR_B_PARTS });
    const chain = [NINE_B, FOUR_B];
    expect(await ask(chain, client(chain))).toMatchObject({ model: 'qwen3.5-4b' });
    // The download (in the jobs process) finishes while the 4B serves.
    for (const id of NINE_B_PARTS) await installer.install(id);
    expect(await ask(chain, client(chain))).toMatchObject({ model: 'qwen3.5-9b', engine: 'mlx' });
    expect(sidecars.spawned).toHaveLength(2);
  });

  it('switches the process to the model a call names, once the calls in flight are done', async () => {
    const { client, manager } = await setup();
    const defaults = [NINE_B, FOUR_B];
    const picked = [FOUR_B];
    expect(await ask(defaults, client(defaults))).toMatchObject({ served: 'qwen3.5-9b' });
    // A person's pick of the 4B on this Mac.
    expect(await ask(picked, client(picked))).toMatchObject({ served: 'qwen3.5-4b', engine: 'llama.cpp' });
    expect(manager.servedModel()).toBe('qwen3.5-4b');
    expect(log).toContainEqual({ type: 'model_switch', from: 'qwen3.5-9b', to: 'qwen3.5-4b' });
    expect(sidecars.spawned.map((s) => s.exit() !== undefined)).toEqual([true, false]);
  });
});

describe('the supervisor without a manager', () => {
  it('launches the engine its first installed model names, with only that engine’s models', async () => {
    const installer = createMemoryComponentInstaller({ files: COMPONENT_FILES });
    for (const id of [...FOUR_B_PARTS, ...NINE_B_PARTS]) await installer.install(id);
    const driver = createFakeLocalRuntimeDriver(() => ({
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:9/v1',
    }));
    const runtime = createLocalRuntime({
      spec: localRuntimeSpec('high', MAC),
      installer,
      driver,
      backends: APPLE_SILICON,
      tier: 'high',
    });
    expect((await runtime.start()).ok).toBe(true);
    const [launch] = driver.launches;
    expect(launch!.runtime.id).toBe('local-llm-runtime-mlx');
    expect(launch!.models.map((m) => m.model.id)).toEqual(['qwen3.5-9b']);
    expect(runtime.servedModel()).toBe('qwen3.5-9b');
    expect(runtime.status().installedModels).toEqual(['qwen3.5-9b', 'qwen3.5-4b']);
    await runtime.stop();
    expect((await runtime.start({ model: 'qwen3.5-4b' })).ok).toBe(true);
    expect(driver.launches[1]!.runtime.id).toBe('local-llm-runtime');
    expect(driver.launches[1]!.models.map((m) => m.model.id)).toEqual(['qwen3.5-4b']);
    await runtime.stop();
  });
});
