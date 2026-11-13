// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Optional: the real llama-server (b11571) with a small GGUF, through the
 * Node adapters the desktop uses, when both are on this machine; skipped
 * otherwise. It checks that the binary accepts every flag the driver passes,
 * runs on Metal on a Mac, enforces the per-launch key and keeps thinking off.
 * Ollama's qwen3:0.6b blob is a GGUF:
 *
 *   TAALCUT_LLAMA_SERVER=<folder with llama-server> TAALCUT_LLAMA_GGUF=<file.gguf> \
 *     pnpm --filter @taalcut/models exec vitest run test/llama-server.live.test.ts
 */
import { dirname } from 'node:path';
import { ok } from '@taalcut/core';
import { afterAll, describe, expect, it } from 'vitest';
import {
  attachLocalRuntime,
  createLlamaServerDriver,
  createLocalRuntimeManager,
  createMemoryCloudCallSink,
  createModelClient,
  createModelRuntime,
  createStaticCredentialProvider,
  LLAMA_CPP_COMPUTE,
  type ComponentInstaller,
  type InstalledComponentRef,
  type LocalRuntimeSpec,
} from '@taalcut/models';
import { createNodeSpawnPort, findFreeLoopbackPort } from '@taalcut/models/node';

const folder = process.env.TAALCUT_LLAMA_SERVER;
const gguf = process.env.TAALCUT_LLAMA_GGUF;

const SPEC: LocalRuntimeSpec = {
  name: 'llama.cpp (live test)',
  runtimeComponentId: 'local-llm-runtime',
  models: [
    {
      id: 'qwen3-0.6b',
      componentId: 'live-model',
      minTier: 'minimum',
      vision: false,
      reasoning: true,
      thinkingKwarg: 'enable_thinking',
      contextWindow: 2_048,
      compute: LLAMA_CPP_COMPUTE,
    },
  ],
};

describe.skipIf(!folder || !gguf)('the real llama-server', () => {
  const spawn = createNodeSpawnPort();
  afterAll(() => spawn.dispose());

  it('takes the driver flags, enforces the key and answers with thinking off', async () => {
    const refs: Record<string, InstalledComponentRef> = {
      'local-llm-runtime': { id: 'local-llm-runtime', version: 'live', path: folder! },
      'live-model': { id: 'live-model', version: 'live', path: dirname(gguf!), file: gguf! },
    };
    const installer: ComponentInstaller = {
      install: async (id) => ok(refs[id]!),
      get: async (id) => refs[id],
    };
    const output: string[] = [];
    const manager = createLocalRuntimeManager({
      spec: SPEC,
      installer,
      driver: createLlamaServerDriver({
        spawn: { spawn: (request) => spawn.spawn({ ...request, onOutput: (line) => output.push(line) }) },
        freePort: findFreeLoopbackPort,
      }),
      backends: process.platform === 'darwin' ? ['metal', 'cpu'] : ['cpu'],
      tier: 'recommended',
      idleUnloadMs: 0,
    });
    const runtime = createModelRuntime({ builtinProviders: [] });
    const attached = attachLocalRuntime(manager, [runtime]);
    const client = createModelClient({
      runtime,
      credentials: createStaticCredentialProvider({}),
      callLog: createMemoryCloudCallSink(),
      localLease: attached.localLease,
      retry: { maxRetries: 0 },
    });

    if (process.platform === 'darwin') {
      // GPU first (ADR 0002): this build sees the Apple GPU through Metal.
      const devices: string[] = [];
      const listing = spawn.spawn({
        command: `${folder}/llama-server`,
        args: ['--list-devices'],
        env: {},
        onOutput: (line) => devices.push(line),
      });
      expect(await listing.exited).toMatchObject({ code: 0 });
      expect(devices.join('\n')).toMatch(/MTL0: Apple/);
    }

    const started = await manager.start();
    expect(started, output.slice(-20).join('\n')).toMatchObject({ ok: true });
    const endpoint = started.ok && started.value.kind === 'openai-compatible' ? started.value : undefined;
    const keyless = await fetch(`${endpoint?.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'qwen3-0.6b', messages: [{ role: 'user', content: 'Hi' }] }),
    });
    expect(keyless.status).toBe(401);

    const answer = await client.complete({
      module: 'agent',
      target: { provider: 'on-device', model: 'qwen3-0.6b', reasoning: 'off' },
      messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
      maxTokens: 64,
    });
    expect(answer, output.slice(-20).join('\n')).toMatchObject({ ok: true, value: { local: true } });
    if (answer.ok) {
      expect(answer.value.text.toLowerCase()).toContain('pong');
      expect(answer.value.message.parts.filter((p) => p.type === 'reasoning' && p.text.trim())).toEqual([]);
    }
    expect(await manager.stop()).toEqual(ok(undefined));
    expect(manager.status().state).toBe('installed');
  }, 120_000);
});
