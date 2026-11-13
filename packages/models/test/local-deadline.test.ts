// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-CMT: an embedded-runtime call has an output cap and a deadline, so an answer that runs away fails instead of
 * hanging. The stall watch only catches silence, and a runaway answer keeps streaming; llama-server has no cap of its
 * own, so without one it ran on to the window. A request's own maxTokens is kept, and a cloud call gets neither.
 */
import { ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
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
  type FetchFn,
  type ModelChoice,
} from '@taalcut/models';
import { LOCAL_MAX_OUTPUT_TOKENS } from '../src/client/attempt';
import { TEST_CREDENTIALS } from './support/harness';

const QWEN: ModelChoice = { provider: 'on-device', model: 'qwen3.5-4b' };
const BASE_URL = 'http://127.0.0.1:9/v1';

const chunk = (content: string) =>
  `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'qwen3.5-4b', choices: [{ index: 0, delta: { content } }] })}\n\n`;

/** A server whose answer never ends: a word every 5 ms until the call is aborted. Keeps each request's body. */
function runaway() {
  const bodies: Record<string, unknown>[] = [];
  const fetch: FetchFn = async (input, init) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setInterval> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        timer = setInterval(() => controller.enqueue(encoder.encode(chunk('and '))), 5);
        init?.signal?.addEventListener('abort', () => {
          clearInterval(timer);
          controller.error(new Error('aborted'));
        });
      },
      cancel() {
        clearInterval(timer);
      },
    });
    void input;
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { fetch, bodies };
}

async function onDevice(localDeadlineMs: number) {
  const server = runaway();
  const local = createLocalRuntime({
    spec: llamaCppRuntimeSpec('recommended'),
    installer: createMemoryComponentInstaller(),
    driver: createFakeLocalRuntimeDriver(() => ({ kind: 'openai-compatible', baseUrl: BASE_URL })),
    backends: ['metal', 'mlx', 'cpu'],
  });
  const runtime = createModelRuntime({ builtinProviders: [] });
  const attached = attachLocalRuntime(local, [runtime]);
  await local.ensureInstalled('recommended');
  expect((await local.start()).ok).toBe(true);
  const client = createModelClient({
    runtime,
    credentials: createStaticCredentialProvider(TEST_CREDENTIALS),
    callLog: createMemoryCloudCallSink(),
    localAdapter: attached.localAdapter,
    fetch: server.fetch,
    retry: { maxRetries: 0 },
    localDeadlineMs,
    selector: { resolve: (module) => ok({ module, choices: [QWEN] }) },
  });
  return { client, bodies: server.bodies, stop: () => local.stop() };
}

const ask = (maxTokens?: number) => ({
  module: 'agent' as const,
  target: QWEN,
  messages: [{ role: 'user' as const, content: 'Plan the cut.' }],
  ...(maxTokens === undefined ? {} : { maxTokens }),
});

describe('an embedded-runtime answer that runs away (FIX-CMT)', () => {
  it('is capped at LOCAL_MAX_OUTPUT_TOKENS and aborted at its deadline, failing as a timeout', async () => {
    const { client, bodies, stop } = await onDevice(150);
    const started = Date.now();
    const result = await client.complete(ask());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatchObject({ code: 'models.provider_unavailable' });
      expect(result.error.detail).toMatch(/^timed out/);
    }
    expect(Date.now() - started).toBeLessThan(5_000);
    const sent = bodies[0]!;
    expect(sent.max_tokens ?? sent.max_completion_tokens).toBe(LOCAL_MAX_OUTPUT_TOKENS);
    await stop();
  });

  it('keeps a request’s own maxTokens', async () => {
    const { client, bodies, stop } = await onDevice(100);
    await client.complete(ask(64));
    expect(bodies[0]!.max_tokens ?? bodies[0]!.max_completion_tokens).toBe(64);
    await stop();
  });
});
