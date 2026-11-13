// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-RUN: a stream that delivers nothing is aborted after the quiet time and fails as a dropped connection
 * (models.provider_unavailable, retryable), which the agent tries again. The owner's call hung 5 minutes on a
 * socket that had died. A plan-billed call says so on its result, so no token budget counts it.
 */
import { describe, expect, it } from 'vitest';
import {
  createMemoryCloudCallSink,
  createModelClient,
  createModelRuntime,
  createStaticCredentialProvider,
  type ChatMessage,
  type FetchFn,
} from '@taalcut/models';
import { TEST_CREDENTIALS } from './support/harness';

const PROMPT: ChatMessage[] = [{ role: 'user', content: 'Plan the cut.' }];

/** A provider that answers 200 and then never sends a byte (the body ends only when the call is aborted). */
const silent: FetchFn = async (_input, init) => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
};

function client(stallMs: number) {
  return createModelClient({
    runtime: createModelRuntime({ baseUrlOverrides: { openai: 'http://127.0.0.1:9/v1' } }),
    credentials: createStaticCredentialProvider(TEST_CREDENTIALS),
    callLog: createMemoryCloudCallSink(),
    fetch: silent,
    retry: { maxRetries: 0 },
    stallMs,
  });
}

describe('a quiet stream (FIX-RUN)', () => {
  it('is aborted after the quiet time and fails as a dropped connection the agent retries', async () => {
    const started = Date.now();
    const result = await client(80).complete({
      module: 'agent',
      target: { provider: 'openai', model: 'gpt-5.4' },
      messages: PROMPT,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'models.provider_unavailable', retryable: true });
    expect(result.error.detail).toMatch(/^stalled/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('a cancel is still a cancel, not a stall', async () => {
    const controller = new AbortController();
    const call = client(60_000).complete({
      module: 'agent',
      target: { provider: 'openai', model: 'gpt-5.4' },
      messages: PROMPT,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);
    const result = await call;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('core.cancelled');
  });
});
