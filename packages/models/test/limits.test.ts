// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * G8 usage limits: what a call meets (rate, quota) is noted with its reset time and billing page, shown as
 * core's UsageLimit, cleared by the next success, and rate limits expire at their reset.
 */
import { usageLimitsSchema } from '@taalcut/core';
import {
  createMemoryCloudCallSink,
  createMemoryProfileStore,
  createModelClient,
  createModelProfiles,
  createModelRuntime,
  createStaticCredentialProvider,
  createUsageLimitsTracker,
  limitOfError,
  ModelQuotaExceeded,
  ModelRateLimited,
  parseDuration,
  resetFromHeaders,
  type ChatMessage,
} from '@taalcut/models';
import { startMockProviderServer, type MockProviderServer } from '@taalcut/models/test-support';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_CREDENTIALS } from './support/harness';

const PROMPT: ChatMessage[] = [{ role: 'user', content: 'Plan the cut.' }];
const NOW = 1_800_000_000_000;

let server: MockProviderServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function client(now: () => number = Date.now) {
  server = await startMockProviderServer();
  const profiles = createModelProfiles({ store: createMemoryProfileStore(), tier: 'recommended' });
  await profiles.load();
  const limits = createUsageLimitsTracker({ now });
  const runtime = createModelRuntime({
    baseUrlOverrides: { openai: `${server.url}/v1`, anthropic: server.url },
  });
  const models = createModelClient({
    runtime,
    credentials: createStaticCredentialProvider(TEST_CREDENTIALS),
    callLog: createMemoryCloudCallSink(),
    selector: profiles,
    limits,
    now,
    retry: { maxRetries: 0 },
  });
  return { server, limits, models };
}

describe('reset headers', () => {
  it('reads durations, RFC 3339 times, epochs and seconds-from-now, latest first', () => {
    expect(parseDuration('6m0s')).toBe(360_000);
    expect(parseDuration('1.5s')).toBe(1_500);
    expect(parseDuration('20ms')).toBe(20);
    expect(parseDuration('1h2m')).toBe(3_720_000);
    expect(parseDuration('soon')).toBeUndefined();
    const openai = new Headers({ 'x-ratelimit-reset-requests': '2s', 'x-ratelimit-reset-tokens': '30s' });
    expect(resetFromHeaders(openai, NOW)).toBe(NOW + 30_000);
    const anthropic = new Headers({
      'anthropic-ratelimit-tokens-reset': new Date(NOW + 45_000).toISOString(),
    });
    expect(resetFromHeaders(anthropic, NOW)).toBe(NOW + 45_000);
    expect(resetFromHeaders(new Headers({ 'x-ratelimit-reset': String(NOW + 9_000) }), NOW)).toBe(
      NOW + 9_000,
    );
    expect(resetFromHeaders(new Headers({ 'x-ratelimit-reset': String((NOW + 9_000) / 1000) }), NOW)).toBe(
      NOW + 9_000,
    );
    expect(resetFromHeaders(new Headers({ 'ratelimit-reset': '12' }), NOW)).toBe(NOW + 12_000);
    // Past times and nonsense are no reset.
    expect(resetFromHeaders(new Headers({ 'x-ratelimit-reset-requests': 'later' }), NOW)).toBeUndefined();
    expect(
      resetFromHeaders(new Headers({ 'anthropic-ratelimit-requests-reset': '2000-01-01T00:00:00Z' }), NOW),
    ).toBeUndefined();
  });
});

describe('limitOfError', () => {
  it('maps rate, quota and plan errors to limits, with the reset and the billing page', () => {
    const rate = ModelRateLimited({ provider: 'openai', model: 'gpt-5.4', retryAfterMs: 20_000 });
    expect(limitOfError(rate, 'agent', { provider: 'openai' }, NOW)).toEqual({
      provider: 'openai',
      model: 'gpt-5.4',
      module: 'agent',
      kind: 'rate',
      resetsAt: NOW + 20_000,
    });
    const quota = ModelQuotaExceeded({ provider: 'openai', model: 'gpt-5.4' });
    expect(limitOfError(quota, 'vision', { provider: 'openai' }, NOW)).toMatchObject({
      kind: 'quota',
      resetsAt: null,
      billingUrl: 'https://platform.openai.com/settings/organization/billing',
    });
    const plan = {
      code: 'models.plan_required',
      messageKey: 'errors.models.plan_required',
      retryable: false,
    };
    expect(limitOfError(plan, 'music', { provider: 'elevenlabs', model: 'music_v2_5' }, NOW)).toMatchObject({
      provider: 'elevenlabs',
      model: 'music_v2_5',
      kind: 'plan',
    });
    expect(limitOfError({ ...plan, code: 'models.bad_request' }, 'agent', { provider: 'x' }, NOW)).toBe(
      undefined,
    );
  });
});

describe('the tracker', () => {
  it('keeps one limit per model with its modules and first time, and tells followers', () => {
    let now = NOW;
    const tracker = createUsageLimitsTracker({ now: () => now });
    const seen: number[] = [];
    const stop = tracker.subscribe((limits) => seen.push(limits.length));
    tracker.met({
      provider: 'openai',
      model: 'gpt-5.4',
      module: 'agent',
      kind: 'rate',
      resetsAt: NOW + 60_000,
    });
    now += 1_000;
    tracker.met({
      provider: 'openai',
      model: 'gpt-5.4',
      module: 'vision',
      kind: 'rate',
      resetsAt: NOW + 90_000,
    });
    const [limit] = tracker.current();
    expect(limit).toMatchObject({
      modules: ['agent', 'vision'],
      since: NOW,
      resetsAt: NOW + 90_000,
      waiting: [],
    });
    expect(usageLimitsSchema.safeParse(tracker.current()).success).toBe(true);
    const release = tracker.hold('openai', 'run');
    expect(tracker.current()[0]?.waiting).toEqual(['run']);
    release();
    release();
    expect(tracker.current()[0]?.waiting).toEqual([]);
    tracker.cleared('openai', 'gpt-5.4');
    expect(tracker.current()).toEqual([]);
    stop();
    expect(seen).toEqual([1, 1, 1, 1, 0]);
  });

  it('drops a rate limit once its reset passes; a quota stays until a call succeeds', () => {
    let now = NOW;
    const tracker = createUsageLimitsTracker({ now: () => now });
    tracker.met({ provider: 'openai', model: 'a', module: 'agent', kind: 'rate', resetsAt: NOW + 10_000 });
    tracker.met({ provider: 'anthropic', module: 'agent', kind: 'quota', resetsAt: null });
    now += 10_000;
    expect(tracker.current().map((l) => l.provider)).toEqual(['anthropic']);
    // A whole-provider limit lifts with any of its models.
    tracker.cleared('anthropic', 'claude-sonnet-5');
    expect(tracker.current()).toEqual([]);
  });

  it('keeps the 64 newest', () => {
    const tracker = createUsageLimitsTracker({ now: () => NOW });
    for (let i = 0; i < 70; i++)
      tracker.met({ provider: `p${i}`, module: 'agent', kind: 'quota', resetsAt: null });
    const limits = tracker.current();
    expect(limits).toHaveLength(64);
    expect(limits[0]?.provider).toBe('p6');
  });
});

describe('the model client reports limits', () => {
  it('notes a 429 with its Retry-After as a reset time, and clears it on the next success', async () => {
    const { limits, models, server: mock } = await client(() => NOW);
    mock.script('openai', {
      kind: 'error',
      status: 429,
      message: 'Rate limit reached',
      headers: { 'retry-after': '20' },
    });
    const first = await models.complete({ module: 'agent', messages: PROMPT });
    // Anthropic answered: the chain moved on, and OpenAI's limit is tracked.
    expect(first.ok && first.value.provider).toBe('anthropic');
    expect(limits.current()).toEqual([
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-6.1-sol',
        kind: 'rate',
        resetsAt: NOW + 20_000,
      }),
    ]);
    const second = await models.complete({ module: 'agent', messages: PROMPT });
    expect(second.ok && second.value.provider).toBe('openai');
    expect(limits.current()).toEqual([]);
  });

  it('gives a used-up quota its billing page and a rate limit its reset header', async () => {
    const { models, server: mock } = await client(() => NOW);
    mock.script('openai', { kind: 'error', status: 402, message: 'You exceeded your current quota' });
    mock.script('anthropic', {
      kind: 'error',
      status: 429,
      message: 'rate_limit_error',
      headers: { 'anthropic-ratelimit-requests-reset': new Date(Date.now() + 60_000).toISOString() },
    });
    const result = await models.complete({
      module: 'agent',
      messages: PROMPT,
      target: { provider: 'openai', model: 'gpt-5.4' },
    });
    expect(!result.ok && result.error).toMatchObject({
      code: 'models.quota_exceeded',
      params: { billingUrl: 'https://platform.openai.com/settings/organization/billing' },
    });
    const limited = await models.complete({
      module: 'agent',
      messages: PROMPT,
      target: { provider: 'anthropic', model: 'claude-sonnet-5' },
    });
    expect(!limited.ok && limited.error.code).toBe('models.rate_limited');
    const params = !limited.ok ? limited.error.params : undefined;
    expect(typeof params?.resetsAt).toBe('number');
  });
});
