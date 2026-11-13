// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The llama-server sidecar (spike 08) under LocalRuntimeManager, against a
 * fake server script spawned through the SpawnPort: spike 08's flags on a free
 * loopback port, the /health wait, a per-launch key, lazy start from
 * ModelClient, crash restart, idle unload, stop for export, the CPU retry, and
 * no orphan processes.
 */
import { ok } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  attachLocalRuntime,
  createLlamaServerDriver,
  createLocalRuntimeManager,
  createMemoryCloudCallSink,
  createMemoryComponentInstaller,
  createModelClient,
  createModelRuntime,
  createStaticCredentialProvider,
  llamaCppRuntimeSpec,
  llamaServerArgs,
  type ComputeBackend,
  type LocalRuntimeLogEvent,
  type LocalRuntimeManager,
  type LocalRuntimeManagerDeps,
  type ModelChoice,
  type ModelRuntime,
} from '@taalcut/models';
import { TEST_CREDENTIALS } from './support/harness';
import { startMockProviderServer, type MockProviderServer } from '@taalcut/models/test-support';
import { createFakeSidecarSpawn, freeLoopbackPort, type FakeSidecarSpawn } from './support/sidecar';

const APPLE_SILICON: readonly ComputeBackend[] = ['metal', 'mlx', 'coreml', 'ane', 'cpu'];
const QWEN: ModelChoice = { provider: 'on-device', model: 'qwen3.5-4b' };
const COMPONENT_FILES = {
  'local-llm-qwen3-5-4b': 'qwen3.5-4b-q4_k_m.gguf',
  'local-llm-qwen3-5-4b-mmproj': 'qwen3.5-4b-mmproj-bf16.gguf',
};
const FRAME = { type: 'image' as const, data: 'iVBORw0KGgo=', mimeType: 'image/png' };

let server: MockProviderServer;
let sidecars: FakeSidecarSpawn;
let agentRuntime: ModelRuntime;
let log: LocalRuntimeLogEvent[];
let managers: LocalRuntimeManager[];

beforeEach(async () => {
  server = await startMockProviderServer();
  sidecars = createFakeSidecarSpawn();
  agentRuntime = createModelRuntime({
    builtinProviders: ['openai'],
    baseUrlOverrides: { openai: server.openaiBaseUrl },
  });
  log = [];
  managers = [];
});
afterEach(async () => {
  for (const manager of managers) await manager.stop();
  await sidecars.killAll();
  await server.close();
});

async function setup(options: Partial<LocalRuntimeManagerDeps> & { install?: boolean } = {}) {
  const installer = createMemoryComponentInstaller({ files: COMPONENT_FILES });
  const manager = createLocalRuntimeManager({
    spec: llamaCppRuntimeSpec('recommended'),
    installer,
    driver: createLlamaServerDriver({
      spawn: sidecars,
      freePort: freeLoopbackPort,
      healthIntervalMs: 20,
      stopGraceMs: 1_000,
      log: (event) => log.push(event),
    }),
    backends: APPLE_SILICON,
    tier: 'recommended',
    idleUnloadMs: 0,
    maxRestarts: 2,
    restartDelayMs: () => 0,
    log: (event) => log.push(event),
    ...options,
  });
  managers.push(manager);
  if (options.install !== false) await manager.ensureInstalled('recommended');
  const attached = attachLocalRuntime(manager, [agentRuntime]);
  const client = createModelClient({
    runtime: agentRuntime,
    credentials: createStaticCredentialProvider(TEST_CREDENTIALS),
    callLog: createMemoryCloudCallSink(),
    localAdapter: attached.localAdapter,
    localLease: attached.localLease,
    retry: { maxRetries: 0 },
    selector: {
      resolve: (module) => ok({ module, choices: [QWEN, { provider: 'openai', model: 'gpt-5.4' }] }),
    },
  });
  return { manager, installer, client, attached };
}

const until = async (check: () => boolean, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the condition.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const report = (text: string) => JSON.parse(text) as Record<string, unknown>;

/** The 4B as the Recommended tier runs it (12,288 tokens). */
function fourB() {
  const model = llamaCppRuntimeSpec('recommended').models.find((m) => m.id === 'qwen3.5-4b');
  if (!model) throw new Error('the runtime serves no Qwen3.5 4B');
  return model;
}

describe('llama-server arguments', () => {
  const model = fourB();

  it('uses spike 08 flags on the GPU, with the projector and the 1,024-token image floor', () => {
    expect(
      llamaServerArgs({ model, weights: '/w.gguf', projector: '/p.gguf', port: 4100, backend: 'metal' }),
    ).toEqual([
      ...['--model', '/w.gguf', '--alias', 'qwen3.5-4b', '--host', '127.0.0.1', '--port', '4100'],
      ...['--ctx-size', '12288', '--parallel', '1', '--n-gpu-layers', '99'],
      // The q8_0 KV cache the windows are measured with; its V half needs flash attention.
      ...['--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0', '--flash-attn', 'on', '--jinja'],
      // The model's own template, its tools written compact (test/chat-templates.test.ts).
      ...['--chat-template', model.chatTemplate],
      ...['--no-webui', '--no-slots', '--offline'],
      // AGT1: no host prompt cache on Recommended (b11571's default is 8 GiB).
      ...['--cache-ram', '0'],
      ...['--mmproj', '/p.gguf', '--image-min-tokens', '1024'],
    ]);
  });

  it('caps the host prompt cache at the tier’s: 1 GiB on High, none below (AGT1)', () => {
    const cap = (tier: 'minimum' | 'recommended' | 'high') =>
      llamaCppRuntimeSpec(tier).models.map((m) => {
        const args = llamaServerArgs({ model: m, weights: '/w.gguf', port: 1, backend: 'metal' });
        return args[args.indexOf('--cache-ram') + 1];
      });
    expect(cap('high')).toEqual(['1024', '1024']);
    expect(cap('recommended')).toEqual(['0', '0']);
    expect(cap('minimum')).toEqual(['0', '0']);
  });

  it('keeps every layer and the projector off the GPU on the CPU, with the same cache and flash attention on', () => {
    const args = llamaServerArgs({
      model,
      weights: '/w.gguf',
      projector: '/p.gguf',
      port: 1,
      backend: 'cpu',
    });
    // b11571 refuses a q8_0 V cache with flash attention off, and turns `auto` on for it (logs/ctx/kv/kv-cpu.py).
    expect(args.join(' ')).toContain(
      '--n-gpu-layers 0 --cache-type-k q8_0 --cache-type-v q8_0 --flash-attn on',
    );
    expect(args.at(-1)).toBe('--no-mmproj-offload');
  });
});

describe('LocalRuntimeManager with the llama-server sidecar', () => {
  it('starts the bundled binary on a free loopback port with a per-launch key, once /health is ok', async () => {
    const { manager } = await setup();
    const started = await manager.start();
    expect(started).toMatchObject({
      ok: true,
      value: { kind: 'openai-compatible', baseUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/v1$/) },
    });
    const endpoint = started.ok && started.value.kind === 'openai-compatible' ? started.value : undefined;
    const [sidecar] = sidecars.spawned;
    expect(sidecar?.command).toBe('/components/local-llm-runtime/llama-server');
    expect(sidecar?.args).toContain('/components/local-llm-qwen3-5-4b/qwen3.5-4b-q4_k_m.gguf');
    expect(sidecar?.args).toContain('/components/local-llm-qwen3-5-4b-mmproj/qwen3.5-4b-mmproj-bf16.gguf');
    // The key travels in the environment, not on the command line; nothing else is inherited.
    expect(sidecar?.env).toEqual({ LLAMA_API_KEY: endpoint?.apiKey });
    expect(sidecar?.args.join(' ')).not.toContain(endpoint?.apiKey);
    expect(endpoint?.models).toEqual(['qwen3.5-4b']);
    expect(manager.status()).toMatchObject({ state: 'running', installedModels: ['qwen3.5-4b'] });
    // Still one process when asked again.
    await manager.start();
    expect(sidecars.spawned).toHaveLength(1);
  });

  it('starts on the first call, then answers text and frames with thinking off and the key sent', async () => {
    const { client, manager } = await setup();
    expect(manager.status().state).toBe('installed');

    const [text, frame] = await Promise.all([
      client.complete({ module: 'agent', messages: [{ role: 'user', content: 'Hi' }] }),
      client.complete({
        module: 'vision',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'What is in it?' }, FRAME] }],
      }),
    ]);
    // Two calls at once share one launch.
    expect(sidecars.spawned).toHaveLength(1);
    expect(text).toMatchObject({
      ok: true,
      value: { provider: 'on-device', model: 'qwen3.5-4b', local: true },
    });
    expect(text.ok && report(text.value.text)).toEqual({
      served: 'qwen3.5-4b',
      engine: 'llama.cpp',
      kwargs: { enable_thinking: false },
      gpu: true,
      images: 0,
    });
    expect(frame.ok && report(frame.value.text)).toMatchObject({ images: 1 });
    // The key never leaves the models package through the endpoint list.
    expect(agentRuntime.listEndpoints()[0]).not.toHaveProperty('apiKey');
  });

  it('restarts the sidecar on a new port after a crash and keeps serving', async () => {
    const { manager, client } = await setup();
    await manager.start();
    sidecars.spawned[0]?.process.kill('SIGKILL');
    await until(() => manager.status().state === 'running' && sidecars.spawned.length === 2);
    expect(manager.status().restarts).toBe(1);
    expect(log).toContainEqual({ type: 'restart', attempt: 1, exitCode: null });
    const answer = await client.complete({ module: 'agent', messages: [{ role: 'user', content: 'Hi' }] });
    expect(answer).toMatchObject({ ok: true, value: { provider: 'on-device' } });
  });

  it('unloads after a quiet spell and starts again on the next call', async () => {
    const { manager, client } = await setup({ idleUnloadMs: 150 });
    const ask = () => client.complete({ module: 'agent', messages: [{ role: 'user', content: 'Hi' }] });
    expect(await ask()).toMatchObject({ ok: true, value: { provider: 'on-device' } });
    await until(() => manager.status().state === 'installed');
    expect(await sidecars.spawned[0]?.exited).toMatchObject({ code: 0 });
    expect(log).toContainEqual({ type: 'idle_unload', idleMs: 150 });
    expect(agentRuntime.hasProvider('on-device')).toBe(false);

    expect(await ask()).toMatchObject({ ok: true, value: { provider: 'on-device' } });
    expect(sidecars.spawned).toHaveLength(2);
  });

  it('stops for an export after calls in flight finish, and comes back afterwards', async () => {
    const { manager, client } = await setup();
    const lease = await manager.acquire();
    expect(lease.ok).toBe(true);

    const stopping = manager.stopForExport();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(manager.status().state).toBe('running');
    if (lease.ok) lease.value.release();
    expect(await stopping).toEqual(ok(undefined));
    expect(manager.status().state).toBe('paused');
    expect(sidecars.spawned[0]?.exit()).toBeDefined();

    // During the export, on-device calls move down the chain instead of loading the model again.
    const events: string[] = [];
    const stream = client.stream({ module: 'agent', messages: [{ role: 'user', content: 'Hi' }] });
    for await (const event of stream) events.push(event.type);
    expect(events).toContain('fallback');
    expect(await stream.result()).toMatchObject({ ok: true, value: { provider: 'openai' } });
    expect(sidecars.spawned).toHaveLength(1);

    expect(await manager.resumeAfterExport()).toEqual(ok(undefined));
    expect(manager.status().state).toBe('running');
    expect(sidecars.spawned).toHaveLength(2);
    expect(log.filter((e) => e.type === 'export_pause' || e.type === 'export_resume')).toHaveLength(2);
  });

  it('moves to the CPU when the GPU launch dies twice while loading, and logs why (ADR 0002)', async () => {
    sidecars.setControl({ FAKE_EXIT_ON_GPU: '1' });
    const { manager } = await setup();
    expect((await manager.start()).ok).toBe(true);
    expect(sidecars.spawned.map((s) => s.args[s.args.indexOf('--n-gpu-layers') + 1])).toEqual([
      '99',
      '99',
      '0',
    ]);
    expect(log).toContainEqual({
      type: 'cpu_fallback',
      model: 'qwen3.5-4b',
      reason: 'gpu_failed_at_runtime',
    });
    expect(await manager.loadedModels()).toMatchObject({
      ok: true,
      value: [{ id: 'qwen3.5-4b', compute: { backend: 'cpu', cpuReason: 'gpu_failed_at_runtime' } }],
    });
  });

  it('gives up when /health never says ok, kills the process and keeps the key out of the error', async () => {
    sidecars.setControl({ FAKE_NEVER_READY: '1' });
    const { manager } = await setup({
      driver: createLlamaServerDriver({
        spawn: sidecars,
        freePort: freeLoopbackPort,
        healthIntervalMs: 20,
        startTimeoutMs: 300,
        newApiKey: () => 'per-launch-key-0123456789',
      }),
    });
    const started = await manager.start();
    expect(started).toMatchObject({ ok: false, error: { code: 'models.local_runtime_failed' } });
    expect(!started.ok && started.error.detail).toContain('not ready after 300 ms');
    expect(!started.ok && started.error.detail).not.toContain('per-launch-key-0123456789');
    // Our SIGTERM ended it either way, but how depends on how far the fake got before the
    // deadline: under load Node may not have installed its handler yet, and then the signal
    // itself ends it instead of a clean exit 0.
    expect([
      { code: 0, signal: null },
      { code: null, signal: 'SIGTERM' },
    ]).toContainEqual(await sidecars.spawned[0]?.exited);
    expect(manager.status().state).toBe('failed');
  });

  it('leaves no process behind when stopped while starting', async () => {
    sidecars.setControl({ FAKE_LOAD_MS: '5000' });
    const { manager } = await setup();
    const starting = manager.start();
    await until(() => sidecars.spawned.length === 1);
    await manager.stop();
    expect(await starting).toMatchObject({ ok: false, error: { code: 'models.local_runtime_unavailable' } });
    await sidecars.spawned[0]?.exited;
    expect(manager.status().state).toBe('installed');
  });

  it('never starts the 4B on a Minimum-tier Mac, even with the weights on disk', async () => {
    const { manager, installer, client } = await setup({ tier: 'minimum', install: false });
    for (const id of manager.componentsFor('recommended')) await installer.install(id);
    expect(await manager.acquire()).toMatchObject({
      ok: false,
      error: { code: 'models.local_runtime_unavailable', params: { state: 'insufficient_memory' } },
    });
    expect(
      await client.complete({ module: 'agent', messages: [{ role: 'user', content: 'Hi' }] }),
    ).toMatchObject({ ok: true, value: { provider: 'openai' } });
    expect(sidecars.spawned).toHaveLength(0);
  });
});
