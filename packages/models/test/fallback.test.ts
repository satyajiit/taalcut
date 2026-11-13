// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Fallback chain (P1-F2, G8): when the primary is rate-limited, down or not
 * set up, the call moves to the next model and reports it with a 'fallback'
 * event. Balanced's agent chain is openai/gpt-6.1-sol → anthropic/claude-sonnet-5-5
 * → google/gemini-3.8-flash.
 */
import { newId } from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMemoryProfileStore,
  createModelProfiles,
  createStaticCredentialProvider,
  type ChatMessage,
  type ModelEvent,
} from '@taalcut/models';
import {
  collect,
  createHarness,
  TEST_CREDENTIALS,
  type Harness,
  type HarnessOptions,
} from './support/harness';

const PROMPT: ChatMessage[] = [{ role: 'user', content: 'Plan the cut.' }];

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

async function balancedHarness(options: HarnessOptions = {}): Promise<Harness> {
  const profiles = createModelProfiles({ store: createMemoryProfileStore(), tier: 'recommended' });
  await profiles.load();
  h = await createHarness({ ...options, selector: profiles });
  return h;
}

const types = (events: ModelEvent[]) => events.map((e) => e.type).filter((t) => t !== 'text_delta');

describe('fallback chain', () => {
  it('switches to the next model when the primary is rate-limited, and reports the switch', async () => {
    const harness = await balancedHarness();
    harness.server.script('openai', {
      kind: 'error',
      status: 429,
      message: 'Rate limit reached',
      headers: { 'retry-after': '20' },
    });

    const events = await collect(harness.client.stream({ module: 'agent', messages: PROMPT }));
    expect(types(events)).toEqual(['start', 'fallback', 'start', 'usage', 'done']);
    const fallback = events.find((e) => e.type === 'fallback');
    if (fallback?.type !== 'fallback') throw new Error('no fallback event');
    expect(fallback.from).toMatchObject({ provider: 'openai', model: 'gpt-6.1-sol' });
    expect(fallback.to).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      reasoning: 'medium',
    });
    expect(fallback.reason).toMatchObject({
      code: 'models.rate_limited',
      retryable: true,
      params: { retryAfterMs: 20_000 },
    });

    const done = events.at(-1);
    expect(done?.type === 'done' && done.result.provider).toBe('anthropic');
    // Both attempts went over the wire, so both are in the cloud-call log.
    expect(harness.callLog.records.map((r) => [r.provider, r.outcome, r.attempt])).toEqual([
      ['openai', 'error', 1],
      ['anthropic', 'ok', 2],
    ]);
  });

  it('switches when the primary provider is down, logging both calls for the project', async () => {
    const harness = await balancedHarness();
    harness.server.script('openai', { kind: 'error', status: 503, message: 'Service unavailable' });
    const projectId = newId<'Project'>();
    const result = await harness.client.complete({ module: 'agent', messages: PROMPT, trace: { projectId } });
    expect(result.ok && result.value.provider).toBe('anthropic');
    expect(harness.callLog.records.map((r) => r.projectId)).toEqual([projectId, projectId]);
  });

  it('skips a provider that is not set up', async () => {
    const harness = await balancedHarness({
      credentials: createStaticCredentialProvider({ anthropic: TEST_CREDENTIALS.anthropic! }),
    });
    const events = await collect(harness.client.stream({ module: 'agent', messages: PROMPT }));
    const fallback = events.find((e) => e.type === 'fallback');
    expect(fallback?.type === 'fallback' && fallback.reason.code).toBe('models.not_configured');
    expect(harness.server.requests.map((r) => r.route)).toEqual(['anthropic']);
    expect(harness.callLog.records).toHaveLength(1);
  });

  it('does not switch once output has streamed, so nothing is said twice', async () => {
    const harness = await balancedHarness();
    harness.server.script('openai', { kind: 'overload-mid-stream' });
    const events = await collect(harness.client.stream({ module: 'agent', messages: PROMPT }));
    expect(events.some((e) => e.type === 'text_delta')).toBe(true);
    expect(events.some((e) => e.type === 'fallback')).toBe(false);
    const last = events.at(-1);
    expect(last?.type === 'error' && last.error.code).toBe('models.provider_unavailable');
    expect(harness.server.requests).toHaveLength(1);
  });

  it('treats a stream whose connection drops ("terminated") as the provider unreachable: retryable', async () => {
    const harness = await balancedHarness();
    harness.server.script('openai', { kind: 'drop-mid-stream' });
    const events = await collect(harness.client.stream({ module: 'agent', messages: PROMPT }));
    expect(events.some((e) => e.type === 'text_delta')).toBe(true);
    // Half an answer has streamed: another model's answer would say it twice.
    expect(events.some((e) => e.type === 'fallback')).toBe(false);
    const last = events.at(-1);
    expect(last?.type === 'error' && last.error).toMatchObject({
      code: 'models.provider_unavailable',
      retryable: true,
      detail: 'terminated',
    });
  });

  it('moves on to the next model when the connection drops before anything streamed', async () => {
    const harness = await balancedHarness();
    harness.server.script('openai', { kind: 'drop-mid-stream', afterText: false });
    const events = await collect(harness.client.stream({ module: 'agent', messages: PROMPT }));
    const fallback = events.find((e) => e.type === 'fallback');
    expect(fallback?.type === 'fallback' && fallback.reason.code).toBe('models.provider_unavailable');
    expect(events.at(-1)?.type).toBe('done');
    expect(harness.server.requests.map((r) => r.route)).toEqual(['openai', 'anthropic']);
  });

  it('does not switch on errors another model would repeat', async () => {
    const harness = await balancedHarness();
    harness.server.script('openai', { kind: 'error', status: 400, message: "Invalid value for 'input'" });
    const result = await harness.client.complete({ module: 'agent', messages: PROMPT });
    expect(!result.ok && result.error.code).toBe('models.bad_request');
    expect(harness.server.requests).toHaveLength(1);
  });

  it('ends with the last set-up model’s error when every model in the chain fails', async () => {
    const harness = await balancedHarness({
      credentials: createStaticCredentialProvider({
        openai: TEST_CREDENTIALS.openai!,
        anthropic: TEST_CREDENTIALS.anthropic!,
      }),
    });
    harness.server.script('openai', { kind: 'error', status: 500, message: 'Internal server error' });
    harness.server.script('anthropic', { kind: 'error', status: 529, message: 'Overloaded' });
    const events = await collect(harness.client.stream({ module: 'agent', messages: PROMPT }));
    expect(events.filter((e) => e.type === 'fallback')).toHaveLength(2);
    const last = events.at(-1);
    // Google has no credential in this test: Anthropic's failure, the last model that was set up, explains it
    // (UX3-AGT: "not configured" from the last link hid the real cause).
    expect(last?.type === 'error' && last.error).toMatchObject({
      code: 'models.provider_unavailable',
      params: { provider: 'anthropic' },
    });
  });

  it('an explicit target runs alone, with no chain', async () => {
    const harness = await balancedHarness();
    harness.server.script('openai', { kind: 'error', status: 429, message: 'Rate limit reached' });
    const result = await harness.client.complete({
      module: 'agent',
      target: { provider: 'openai', model: 'gpt-5.4' },
      messages: PROMPT,
    });
    expect(!result.ok && result.error.code).toBe('models.rate_limited');
    expect(harness.server.requests).toHaveLength(1);
  });
});
