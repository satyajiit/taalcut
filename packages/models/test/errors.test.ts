// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Provider failures become TaalcutErrors with the right code and retryability, and no secret. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCachingCredentialProvider,
  createStaticCredentialProvider,
  type ChatMessage,
  type ModelChoice,
  type ResolvedCredential,
} from '@taalcut/models';
import { createHarness, OPENAI_KEY, TEST_CREDENTIALS, type Harness } from './support/harness';
import type { MockStep, Route } from '@taalcut/models/test-support';

const PROMPT: ChatMessage[] = [{ role: 'user', content: 'Hi' }];
const OPENAI: ModelChoice = { provider: 'openai', model: 'gpt-5.4' };
const ANTHROPIC: ModelChoice = { provider: 'anthropic', model: 'claude-sonnet-5' };

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(async () => {
  await h.close();
  vi.unstubAllEnvs();
});

async function failWith(route: Route, target: ModelChoice, step: MockStep) {
  h.server.script(route, step);
  const result = await h.client.complete({ module: 'agent', target, messages: PROMPT });
  if (result.ok) throw new Error('expected a failure');
  return result.error;
}

describe('error mapping', () => {
  it.each([
    ['openai', OPENAI, 429, 'Rate limit reached for gpt-5.4', 'models.rate_limited', true],
    [
      'anthropic',
      ANTHROPIC,
      429,
      'Number of request tokens has exceeded your per-minute rate limit',
      'models.rate_limited',
      true,
    ],
    ['openai', OPENAI, 503, 'The server is overloaded', 'models.provider_unavailable', true],
    ['anthropic', ANTHROPIC, 529, 'Overloaded', 'models.provider_unavailable', true],
    ['openai', OPENAI, 401, 'Incorrect API key provided', 'models.auth_invalid', false],
    [
      'anthropic',
      ANTHROPIC,
      400,
      'prompt is too long: 1250000 tokens > 1000000 maximum',
      'models.context_too_long',
      false,
    ],
    [
      'openai',
      OPENAI,
      400,
      'Your input exceeds the context window of this model.',
      'models.context_too_long',
      false,
    ],
    [
      'openai',
      OPENAI,
      429,
      'You exceeded your current quota (insufficient_quota)',
      'models.quota_exceeded',
      false,
    ],
    ['openai', OPENAI, 400, "Invalid value for 'tool_choice'", 'models.bad_request', false],
  ] as const)('%s %i "%s" → %s', async (route, target, status, message, code, retryable) => {
    const error = await failWith(route, target, { kind: 'error', status, message });
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
    expect(error.messageKey).toBe(`errors.${code}`);
    expect(error.params).toMatchObject({ provider: target.provider, model: target.model });
    expect(h.callLog.records.at(-1)).toMatchObject({ outcome: 'error', errorCode: code, httpStatus: status });
  });

  it('reads Retry-After into the rate-limit error', async () => {
    const error = await failWith('openai', OPENAI, {
      kind: 'error',
      status: 429,
      message: 'slow down',
      headers: { 'retry-after': '2' },
    });
    expect(error.params).toMatchObject({ retryAfterMs: 2000 });
  });

  it('keeps secrets out of the developer detail', async () => {
    const error = await failWith('openai', OPENAI, {
      kind: 'error',
      status: 401,
      message: `Incorrect API key provided: ${OPENAI_KEY}`,
    });
    expect(error.detail).toContain('[REDACTED]');
    expect(error.detail).not.toContain(OPENAI_KEY);
  });

  it('treats a 401 on a sign-in token as expired, forces a refresh and retries once', async () => {
    const tokens = [1, 2, 3, 4].map((n) => `eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.c2lnbmF0dXJlMDA${n}`);
    const source = { get: vi.fn(async () => ({ ok: true as const, value: oauth(tokens.shift()!) })) };
    const credentials = createCachingCredentialProvider({ source });
    await h.close();
    h = await createHarness({ credentials });

    h.server.script('openai', { kind: 'error', status: 401, message: 'Token expired' });
    const result = await h.client.complete({ module: 'agent', target: OPENAI, messages: PROMPT });
    expect(result.ok).toBe(true);
    expect(source.get).toHaveBeenCalledTimes(2);
    expect(source.get).toHaveBeenLastCalledWith('openai', expect.objectContaining({ forceRefresh: true }));
    expect(h.server.requests.at(-1)?.headers.authorization).toMatch(/c2lnbmF0dXJlMDA2$/);
    expect(h.callLog.records.map((r) => [r.errorCode, r.attempt])).toEqual([
      ['models.auth_expired', 1],
      [undefined, 2],
    ]);

    // Rejected again after the refresh: the call ends as auth_expired, which is retryable.
    h.server.script('openai', { kind: 'error', status: 401 });
    const error = await failWith('openai', OPENAI, { kind: 'error', status: 401, message: 'Token expired' });
    expect(error).toMatchObject({ code: 'models.auth_expired', retryable: true });
  });

  it('never falls back to API keys from the environment', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-from-env-should-never-be-used-1234');
    await h.close();
    h = await createHarness({ credentials: createStaticCredentialProvider({}) });
    const result = await h.client.complete({ module: 'agent', target: OPENAI, messages: PROMPT });
    expect(!result.ok && result.error.code).toBe('models.not_configured');
    expect(!result.ok && result.error.fix?.command).toBe('settings.openAccounts');
    expect(h.server.requests).toHaveLength(0);
    // Nothing went over the wire, so there is no cloud-call row.
    expect(h.callLog.records).toHaveLength(0);
  });

  it('rejects unknown models and models that lack what the module needs', async () => {
    const unknown = await h.client.complete({
      module: 'agent',
      target: { provider: 'openai', model: 'gpt-0' },
      messages: PROMPT,
    });
    expect(!unknown.ok && unknown.error.code).toBe('models.unknown_model');
    const blind = await h.client.complete({
      module: 'vision',
      target: { provider: 'mock-local', model: 'tiny' },
      messages: PROMPT,
    });
    expect(!blind.ok && blind.error.code).toBe('models.model_unsuitable');
    const speech = await h.client.complete({ module: 'speech', target: OPENAI, messages: PROMPT });
    expect(!speech.ok && speech.error.code).toBe('models.unsupported_module');
  });

  it('passes credential lookup failures through unchanged', async () => {
    const failure = {
      code: 'models.provider_error',
      messageKey: 'errors.models.provider_error',
      retryable: false,
    };
    await h.close();
    h = await createHarness({ credentials: { get: async () => ({ ok: false, error: failure }) } });
    const result = await h.client.complete({ module: 'agent', target: OPENAI, messages: PROMPT });
    expect(!result.ok && result.error).toEqual(failure);
  });

  it('a failing cloud-call sink never fails the call', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await h.close();
    h = await createHarness();
    const original = h.callLog.record;
    h.callLog.record = () => {
      throw new Error('disk full');
    };
    const result = await h.client.complete({ module: 'agent', target: ANTHROPIC, messages: PROMPT });
    expect(result.ok).toBe(true);
    expect(warn).toHaveBeenCalled();
    h.callLog.record = original;
    warn.mockRestore();
  });
});

function oauth(secret: string): ResolvedCredential {
  return {
    ...TEST_CREDENTIALS.openai!,
    kind: 'oauth_access',
    secret,
    expiresAt: Date.now() + 3_600_000,
    source: 'chatgpt-sign-in',
  };
}
