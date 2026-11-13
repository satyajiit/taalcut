// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ElevenLabs failures (SPEC P3.2): 401 auth, a quota body (401 or 402) quota, 429 rate limit with Retry-After, 422
 * bad request naming the field, 5xx unavailable, a dropped connection, a cancel. One CloudCall row per request that
 * went out, and the key never reaches a row, an error or a log line.
 */
import { createElevenLabsVoice, disableNetwork, type NetworkGuard } from '@taalcut/models';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ELEVEN_KEY, elevenLabsHarness, errorBody, fixture, type WireReply } from './support/elevenlabs-wire';

let guard: NetworkGuard;
beforeAll(() => {
  guard = disableNetwork();
});
afterAll(() => guard.restore());
afterEach(() => vi.restoreAllMocks());

const LINE = { text: 'One line.', voiceId: 'v1', language: 'en', quality: 'final' as const, seed: 1 };
const TTS = 'POST /v1/text-to-speech/v1/with-timestamps';

async function failWith(reply: WireReply) {
  const harness = elevenLabsHarness();
  harness.wire.script('GET /v1/user/subscription', { json: fixture('subscription-creator') });
  harness.wire.script(TTS, reply);
  const made = await createElevenLabsVoice({ session: harness.session }).synthesize(LINE);
  if (made.ok) throw new Error('expected a failure');
  return { error: made.error, ...harness };
}

describe('ElevenLabs error mapping', () => {
  it('maps a rejected key to auth_invalid and scrubs the key from the detail', async () => {
    const logs: unknown[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args) => logs.push(args));
    vi.spyOn(console, 'error').mockImplementation((...args) => logs.push(args));
    const { error, calls } = await failWith({ status: 401, json: errorBody('invalid_api_key') });
    expect(error.code).toBe('models.auth_invalid');
    expect(error.detail).toContain('[REDACTED]');
    expect(JSON.stringify(error)).not.toContain(ELEVEN_KEY);
    expect(JSON.stringify(calls.records)).not.toContain(ELEVEN_KEY);
    expect(JSON.stringify(logs)).not.toContain(ELEVEN_KEY);
    expect(calls.records[1]).toMatchObject({
      outcome: 'error',
      errorCode: 'models.auth_invalid',
      httpStatus: 401,
    });
  });

  it.each([
    ['401 with quota_exceeded', { status: 401, json: errorBody('quota_exceeded') }, 'models.quota_exceeded'],
    ['402', { status: 402, json: errorBody('quota_exceeded') }, 'models.quota_exceeded'],
    ['402 payment_required', { status: 402, json: errorBody('payment_required') }, 'models.plan_required'],
    ['503 system_busy', { status: 503, json: errorBody('system_busy') }, 'models.provider_unavailable'],
    [
      'a 500 page that is not JSON',
      { status: 500, bytes: new TextEncoder().encode('<html>') },
      'models.provider_unavailable',
    ],
    ['418', { status: 418, json: { detail: 'teapot' } }, 'models.provider_error'],
  ] as [string, WireReply, string][])('maps %s', async (_name, reply, code) => {
    const { error } = await failWith(reply);
    expect(error.code).toBe(code);
  });

  it('maps 429 to rate_limited with Retry-After', async () => {
    const { error } = await failWith({
      status: 429,
      json: errorBody('too_many_concurrent_requests'),
      headers: { 'retry-after': '3' },
    });
    expect(error.code).toBe('models.rate_limited');
    expect(error.retryable).toBe(true);
    expect(error.params).toMatchObject({ provider: 'elevenlabs', model: 'eleven_v4', retryAfterMs: 3000 });
  });

  it('maps 422 to bad_request naming the field', async () => {
    const { error } = await failWith({ status: 422, json: errorBody('validation') });
    expect(error.code).toBe('models.bad_request');
    expect(error.detail).toMatch(/^field: text;/);
  });

  it('maps a 2xx answer that is not the documented shape to a provider error', async () => {
    const { error, calls } = await failWith({ json: { audio_base64: 'AAAA' } });
    expect(error.code).toBe('models.provider_error');
    // The request itself went fine: its row is 'ok'.
    expect(calls.records[1]?.outcome).toBe('ok');
  });

  it('maps a dropped connection to provider_unavailable, and a cancel to core.cancelled', async () => {
    const harness = elevenLabsHarness();
    harness.wire.script('GET /v1/user/subscription', { json: fixture('subscription-creator') });
    const voice = createElevenLabsVoice({ session: harness.session });
    // Nothing scripted for the speech route: the fake fetch throws like a reset connection.
    const dropped = await voice.synthesize(LINE);
    expect(!dropped.ok && dropped.error.code).toBe('models.provider_unavailable');

    harness.wire.script(TTS, { abort: true });
    const cancelled = await voice.synthesize(LINE);
    expect(!cancelled.ok && cancelled.error.code).toBe('core.cancelled');
    expect(harness.calls.records.map((r) => r.outcome)).toEqual(['ok', 'error', 'cancelled']);

    // Cancelled before it starts: nothing goes out and nothing is logged.
    const controller = new AbortController();
    controller.abort();
    const early = await voice.synthesize({ ...LINE, signal: controller.signal });
    expect(!early.ok && early.error.code).toBe('core.cancelled');
    expect(harness.wire.requests).toHaveLength(3);
    expect(harness.calls.records).toHaveLength(3);
  });

  it('writes one row per request that went out, each with its own trace', async () => {
    const harness = elevenLabsHarness();
    harness.wire.script('GET /v1/user/subscription', { json: fixture('subscription-creator') });
    harness.wire.script(TTS, { json: fixture('tts-with-timestamps') }, { status: 429, json: {} });
    const voice = createElevenLabsVoice({ session: harness.session });
    const trace = { runId: 'run-1', spanId: 'span-1', projectId: '01J00000000000000000000001' as never };
    await voice.synthesize({ ...LINE, trace });
    await voice.synthesize({ ...LINE, trace });
    expect(harness.wire.requests).toHaveLength(3);
    expect(harness.calls.records).toHaveLength(3);
    expect(harness.calls.records[1]).toMatchObject({
      runId: 'run-1',
      spanId: 'span-1',
      local: false,
      attempt: 1,
    });
    expect(harness.calls.records.every((r) => r.inputTokens === 0 && r.outputTokens === 0)).toBe(true);
    expect(harness.wire.pending()).toBe(0);
  });
});
