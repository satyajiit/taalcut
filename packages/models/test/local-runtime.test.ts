// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The embedded local runtime's supervisor (D16), driven by the fake driver:
 * tier-specific installs through the component manager port, the memory
 * guard, start, supervision after crashes, GPU-first compute reporting, and
 * ModelClient reaching it either over an OpenAI-compatible URL or through an
 * in-process adapter. The llama-server sidecar itself: llama-server.test.ts.
 */
import { ok } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  attachLocalRuntime,
  createFakeLocalRuntimeDriver,
  createLocalRuntime,
  createMemoryCloudCallSink,
  createMemoryComponentInstaller,
  createModelClient,
  createModelRuntime,
  createStaticCredentialProvider,
  llamaCppRuntimeSpec,
  LocalRuntimeFailed,
  type ComputeBackend,
  type LocalRuntimeEndpoint,
  type LocalRuntimeLogEvent,
  type ModelChoice,
  type ModelRuntime,
} from '@taalcut/models';
import { TEST_CREDENTIALS } from './support/harness';
import { startMockProviderServer, type MockProviderServer } from '@taalcut/models/test-support';

const APPLE_SILICON: readonly ComputeBackend[] = ['metal', 'mlx', 'coreml', 'ane', 'cpu'];
const QWEN: ModelChoice = { provider: 'on-device', model: 'qwen3.5-4b' };
const NOT_IN_SPEC: ModelChoice = { provider: 'on-device', model: 'qwen3.5-9b' };
const ask = (target: ModelChoice) => ({
  module: 'agent' as const,
  target,
  messages: [{ role: 'user' as const, content: 'Hi' }],
});

let server: MockProviderServer;
let agentRuntime: ModelRuntime;
let log: LocalRuntimeLogEvent[];

beforeEach(async () => {
  server = await startMockProviderServer();
  agentRuntime = createModelRuntime({
    builtinProviders: ['openai'],
    baseUrlOverrides: { openai: server.openaiBaseUrl },
  });
  log = [];
});
afterEach(async () => {
  await server.close();
});

function setup(
  endpoint: () => LocalRuntimeEndpoint = () => ({ kind: 'openai-compatible', baseUrl: server.openaiBaseUrl }),
) {
  const installer = createMemoryComponentInstaller();
  const driver = createFakeLocalRuntimeDriver(endpoint);
  const local = createLocalRuntime({
    spec: llamaCppRuntimeSpec('recommended'),
    installer,
    driver,
    backends: APPLE_SILICON,
    maxRestarts: 1,
    restartDelayMs: () => 0,
    log: (event) => log.push(event),
  });
  const callLog = createMemoryCloudCallSink();
  const attached = attachLocalRuntime(local, [agentRuntime]);
  const client = createModelClient({
    runtime: agentRuntime,
    credentials: createStaticCredentialProvider(TEST_CREDENTIALS),
    callLog,
    localAdapter: attached.localAdapter,
    retry: { maxRetries: 0 },
    selector: {
      resolve: (module) => ok({ module, choices: [QWEN, { provider: 'openai', model: 'gpt-5.4' }] }),
    },
  });
  return { installer, driver, local, client, callLog, attached };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const local08Components = ['local-llm-runtime', 'local-llm-qwen3-5-0-8b'];
const local4bComponents = ['local-llm-runtime', 'local-llm-qwen3-5-4b', 'local-llm-qwen3-5-4b-mmproj'];

describe('embedded local runtime (D16)', () => {
  it('installs the runtime, the weights and the projector a tier runs, through the component manager', async () => {
    const { local, installer } = setup();
    const recommended = ['local-llm-runtime', 'local-llm-qwen3-5-4b', 'local-llm-qwen3-5-4b-mmproj'];
    expect(local.componentsFor('recommended')).toEqual(recommended);
    expect(local.componentsFor('high')).toEqual(recommended);
    expect(local.status().state).toBe('not_installed');
    expect(await local.start()).toMatchObject({
      ok: false,
      error: { code: 'models.local_runtime_unavailable', params: { state: 'not_installed' } },
    });

    expect(await local.ensureInstalled('recommended')).toEqual(ok(['qwen3.5-4b']));
    expect(installer.installed).toEqual(recommended);
    expect(local.status()).toMatchObject({ state: 'installed', installedModels: ['qwen3.5-4b'] });
  });

  it('installs the 0.8B on the Minimum tier, never the 4B, and only the 4B above it (spike 08, J8b)', async () => {
    const { local, installer } = setup();
    const minimum = ['local-llm-runtime', 'local-llm-qwen3-5-0-8b'];
    expect(local.componentsFor('minimum')).toEqual(minimum);
    expect(local.componentsFor('recommended')).not.toContain('local-llm-qwen3-5-0-8b');
    expect(await local.ensureInstalled('minimum')).toEqual(ok(['qwen3.5-0.8b']));
    expect(installer.installed).toEqual(minimum);
    expect(local.status()).toMatchObject({ state: 'installed', installedModels: ['qwen3.5-0.8b'] });
  });

  it('runs the 0.8B, text only, on an 8 GB Mac with the 4B weights also on disk (memory guard)', async () => {
    const installer = createMemoryComponentInstaller();
    for (const id of new Set([...local08Components, ...local4bComponents])) await installer.install(id);
    const driver = createFakeLocalRuntimeDriver(() => ({
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:9/v1',
    }));
    const local = createLocalRuntime({
      spec: llamaCppRuntimeSpec('recommended'),
      installer,
      driver,
      backends: APPLE_SILICON,
      tier: 'minimum',
      log: (event) => log.push(event),
    });
    expect((await local.start()).ok).toBe(true);
    expect(driver.launches[0]?.models.map((m) => [m.model.id, m.model.vision, m.projector])).toEqual([
      ['qwen3.5-0.8b', false, undefined],
    ]);
    expect(log).toContainEqual({ type: 'memory_guard', model: 'qwen3.5-4b', tier: 'minimum' });
    await local.stop();
  });

  it('never loads weights above the machine tier, even when they are installed (memory guard)', async () => {
    const installer = createMemoryComponentInstaller();
    for (const id of ['local-llm-runtime', 'local-llm-qwen3-5-4b', 'local-llm-qwen3-5-4b-mmproj'])
      await installer.install(id);
    const driver = createFakeLocalRuntimeDriver(() => ({
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:9/v1',
    }));
    const local = createLocalRuntime({
      spec: llamaCppRuntimeSpec('recommended'),
      installer,
      driver,
      backends: APPLE_SILICON,
      tier: 'minimum',
      log: (event) => log.push(event),
    });
    expect(await local.start()).toMatchObject({
      ok: false,
      error: { code: 'models.local_runtime_unavailable', params: { state: 'insufficient_memory' } },
    });
    expect(driver.launches).toHaveLength(0);
    expect(log).toContainEqual({ type: 'memory_guard', model: 'qwen3.5-4b', tier: 'minimum' });
  });

  it('does not count weights as installed until their vision projector is', async () => {
    const { local, installer } = setup();
    await installer.install('local-llm-runtime');
    await installer.install('local-llm-qwen3-5-4b');
    expect(await local.start()).toMatchObject({ ok: false, error: { params: { state: 'not_installed' } } });
    await installer.install('local-llm-qwen3-5-4b-mmproj');
    expect(await local.start()).toMatchObject({ ok: true });
  });

  it('serves its models to ModelClient over an OpenAI-compatible URL while it runs', async () => {
    const { local, client, callLog, driver } = setup();
    expect(await client.complete(ask(QWEN))).toMatchObject({
      ok: false,
      error: { code: 'models.local_runtime_unavailable', params: { state: 'not_running' } },
    });

    await local.ensureInstalled('recommended');
    expect(await local.start()).toEqual(ok({ kind: 'openai-compatible', baseUrl: server.openaiBaseUrl }));
    expect(driver.launches[0]?.backends).toEqual(APPLE_SILICON);

    const answer = await client.complete(ask(QWEN));
    expect(answer).toMatchObject({
      ok: true,
      value: { provider: 'on-device', model: 'qwen3.5-4b', local: true },
    });
    // Thinking off is said out loud: Qwen3.5's template would think by default (spike 08).
    expect(server.requests.at(-1)).toMatchObject({
      route: 'chat',
      body: { model: 'qwen3.5-4b', chat_template_kwargs: { enable_thinking: false } },
    });
    expect(server.requests.at(-1)?.body).not.toHaveProperty('reasoning_effort');
    expect(callLog.records.at(-1)).toMatchObject({ provider: 'on-device', local: true, costUsd: 0 });

    // A model the runtime doesn't serve.
    expect(await client.complete(ask(NOT_IN_SPEC))).toMatchObject({
      ok: false,
      error: { code: 'models.local_runtime_unavailable', params: { state: 'model_not_installed' } },
    });

    await local.stop();
    expect(local.status().state).toBe('installed');
    expect(agentRuntime.hasProvider('on-device')).toBe(false);
    // Stopped, it is still local: what counts as a cloud provider (upload consent) doesn't flip with it.
    expect(agentRuntime.isLocalProvider('on-device')).toBe(true);
  });

  it('falls back to the next model in the chain when the runtime is down', async () => {
    const { client } = setup();
    const events: string[] = [];
    const stream = client.stream({ module: 'agent', messages: [{ role: 'user', content: 'Hi' }] });
    for await (const event of stream) events.push(event.type);
    expect(events).toContain('fallback');
    expect(await stream.result()).toMatchObject({ ok: true, value: { provider: 'openai' } });
  });

  it('restarts after a crash, then gives up and reports it', async () => {
    const { local, driver } = setup();
    await local.ensureInstalled('recommended');
    await local.start();

    driver.crash(139);
    await settle();
    expect(local.status()).toMatchObject({ state: 'running', restarts: 1 });
    expect(driver.launches).toHaveLength(2);
    expect(log).toContainEqual({ type: 'restart', attempt: 1, exitCode: 139 });
    expect(agentRuntime.hasProvider('on-device')).toBe(true);

    driver.crash(139);
    await settle();
    expect(local.status()).toMatchObject({ state: 'failed', error: { code: LocalRuntimeFailed.code } });
    expect(agentRuntime.hasProvider('on-device')).toBe(false);
  });

  it('reports where each model runs, GPU first, and logs a CPU fallback with its reason (ADR 0002)', async () => {
    const { local, driver } = setup();
    await local.ensureInstalled('recommended');
    await local.start();
    expect(await local.loadedModels()).toEqual(
      ok([
        {
          id: 'qwen3.5-4b',
          compute: { backend: 'metal', accelerated: true, labelKey: 'models.compute.metal' },
        },
      ]),
    );
    driver.setBackend('qwen3.5-4b', 'cpu');
    const loaded = await local.loadedModels();
    expect(loaded.ok && loaded.value[0]?.compute).toEqual({
      backend: 'cpu',
      accelerated: false,
      cpuReason: 'gpu_failed_at_runtime',
      labelKey: 'models.compute.cpu',
    });
    expect(log).toContainEqual({
      type: 'cpu_fallback',
      model: 'qwen3.5-4b',
      reason: 'gpu_failed_at_runtime',
    });
  });

  it('delegates to an in-process adapter when the runtime has no HTTP server', async () => {
    // The adapter here is itself a ModelClient on its own runtime; a native bridge would be the real one.
    const adapterRuntime = createModelRuntime({
      builtinProviders: [],
      endpoints: [
        { id: 'on-device', name: 'Bridge', baseUrl: server.openaiBaseUrl, models: [{ id: 'qwen3.5-4b' }] },
      ],
    });
    const adapter = createModelClient({
      runtime: adapterRuntime,
      credentials: createStaticCredentialProvider({}),
      callLog: createMemoryCloudCallSink(),
      retry: { maxRetries: 0 },
    });
    const { local, client } = setup(() => ({ kind: 'adapter', client: adapter }));
    await local.ensureInstalled('recommended');
    await local.start();
    // Nothing registered with pi-ai: the call can only have gone through the adapter.
    expect(agentRuntime.hasProvider('on-device')).toBe(false);
    expect(await client.complete(ask(QWEN))).toMatchObject({ ok: true, value: { provider: 'on-device' } });
    expect(server.requests.at(-1)).toMatchObject({ route: 'chat', body: { model: 'qwen3.5-4b' } });
  });

  it('surfaces an install failure as a value', async () => {
    const { local, installer } = setup();
    installer.failNext('local-llm-runtime', LocalRuntimeFailed({ step: 'install' }));
    expect(await local.ensureInstalled('high')).toMatchObject({
      ok: false,
      error: { code: 'models.local_runtime_failed' },
    });
    expect(local.status().state).toBe('not_installed');
  });
});
