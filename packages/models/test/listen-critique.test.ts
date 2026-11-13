// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-X1: `audio.cloudCritique` end to end against a recorded Gemini response (no live call, no upload: the
 * cassette answers), and every way it refuses before anything leaves: Local only, no consent, no model that hears.
 *
 * With TAALCUT_RECORD=1 this also writes the cassette, from the mock server's Gemini route with the hand-written
 * answer in support/listen-critique.ts: pi-ai's real request, no Google key, nothing sent off this Mac.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RationalTime, toolSpecProblems, type AssetId } from '@taalcut/core';
import {
  CLOUD_CRITIQUE_TIMEOUT_MS,
  createCloudCritiqueTool,
  openCassette,
  type FetchFn,
  type MemoryCloudCallSink,
  type ModelClient,
} from '@taalcut/models';
import { startMockProviderServer, type MockProviderServer } from '@taalcut/models/test-support';
import {
  CLIP_SECONDS,
  critiqueDeps,
  RECORDED_ANSWER,
  refuseConsent,
  syntheticClip,
  toolContext,
} from './support/listen-critique';
import { CASSETTE_DIR, GEMINI_KEY, geminiClient } from './support/scenarios';

const CASSETTE = join(CASSETTE_DIR, 'google-gemini-listen-critique.json');
const INPUT = { assetId: '01JD0000000000000000000000' as AssetId };

/** A client whose every request is counted and refused: for the calls that must never reach a provider. */
function noNetwork(): { client: ModelClient; callLog: MemoryCloudCallSink; requests: string[] } {
  const requests: string[] = [];
  const fetch: FetchFn = async (input) => {
    requests.push(String(input instanceof Request ? input.url : input));
    throw new Error('no network in this test');
  };
  const { client, callLog } = geminiClient(fetch);
  return { client, callLog, requests };
}

describe.runIf(process.env.TAALCUT_RECORD === '1')('recording the cloud-critique cassette', () => {
  let server: MockProviderServer;
  beforeAll(async () => {
    server = await startMockProviderServer();
  });
  afterAll(async () => {
    await server.close();
  });

  it('records the request pi-ai builds, answered by the mock server', async () => {
    server.script('gemini', { kind: 'reply', text: RECORDED_ANSWER, usage: { input: 1460, output: 212 } });
    const cassette = openCassette({
      path: CASSETTE,
      mode: 'record',
      secrets: [GEMINI_KEY],
      upstream: (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        return globalThis.fetch(`${server.url}${url.pathname}${url.search}`, init);
      },
      note:
        "EAR1-X1: the answer is hand-written (test/support/listen-critique.ts) in Gemini's wire format from the mock " +
        "server, not Google's: no key was used and nothing was uploaded. The request is pi-ai's real one for " +
        'generativelanguage.googleapis.com with a synthetic 0.25 s clip. Re-record with TAALCUT_RECORD=1.',
    });
    const { client } = geminiClient(cassette.fetch);
    const { deps } = critiqueDeps({ models: client });
    const { ctx } = toolContext();
    const result = await createCloudCritiqueTool(deps).run(INPUT, ctx);
    expect(result).toMatchObject({ ok: true });
    await cassette.save();
  });
});

describe.skipIf(process.env.TAALCUT_RECORD === '1')('audio.cloudCritique', () => {
  it('replays a recorded critique: one CloudCall in the vision module with the bytes it sent', async () => {
    const cassette = openCassette({ path: CASSETTE, mode: 'replay' });
    const { client, callLog } = geminiClient(cassette.fetch);
    const { deps, watch } = critiqueDeps({ models: client });
    const { ctx, usage } = toolContext();
    const result = await createCloudCritiqueTool(deps).run(INPUT, ctx);
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail}`);
    const out = result.value;

    expect(cassette.misses()).toEqual([]);
    expect(cassette.unused()).toBe(0);
    expect(out).toMatchObject({ source: 'launch-sting.wav', provider: 'google', model: 'gemini-3.5-flash' });
    expect(out.uploaded).toMatchObject({
      bytes: syntheticClip().byteLength,
      trimmed: false,
      withTimeline: false,
    });
    expect(RationalTime.toSeconds(out.uploaded.end)).toBeCloseTo(CLIP_SECONDS, 6);
    expect(out.critique?.overall).toEqual({
      score: 4,
      verdict: 'A clean level, but the tone reads as a test beep, not a designed sound',
    });
    expect(out.critique?.scores).toEqual({ sync: null, realism: 3, mixBalance: 7, loudness: 6, music: null });
    // Most severe first.
    expect(out.critique?.issues.map((issue) => issue.severity)).toEqual(['high', 'low']);
    expect(out.summary).toMatch(/^gemini-3\.5-flash rates the soundtrack 4\/10: .* 2 issues \(1 high\)\./);
    expect(out.summary).toContain('An AI opinion, not a measurement');

    // The CloudCall row (Settings → Usage): one request, module vision, with every byte it put on the wire.
    expect(callLog.records).toHaveLength(1);
    const call = callLog.records[0]!;
    expect(call).toMatchObject({
      module: 'vision',
      provider: 'google',
      model: 'gemini-3.5-flash',
      local: false,
      outcome: 'ok',
      inputTokens: 1460,
      outputTokens: 212,
      runId: ctx.runId,
      spanId: ctx.callId,
    });
    const audioBase64 = Buffer.from(syntheticClip()).toString('base64');
    expect(call.bytesSent).toBeGreaterThan(audioBase64.length);
    expect(usage).toEqual([expect.objectContaining({ provider: 'google', inputTokens: 1460 })]);
    expect(watch).toMatchObject({ prepared: 1, done: 1, consentAsked: 1, facts: [{ timeline: false }] });
  });

  it('sends the audio inline as audio (never a picture), then the rubric with the measured loudness', () => {
    const file = JSON.parse(readFileSync(CASSETTE, 'utf8')) as {
      interactions: { request: { body: { contents: { parts: Record<string, unknown>[] }[] } } }[];
    };
    expect(file.interactions).toHaveLength(1);
    const [audio, prompt] = file.interactions[0]!.request.body.contents[0]!.parts;
    expect(audio).toEqual({
      inlineData: { mimeType: 'audio/wav', data: Buffer.from(syntheticClip()).toString('base64') },
    });
    expect(String(prompt?.text)).toContain('You are a senior re-recording mixer');
    expect(String(prompt?.text)).toContain('integrated loudness -14.2 LUFS, true peak -1.3 dBTP');
    expect(JSON.stringify(file)).not.toContain(GEMINI_KEY);
    expect(JSON.stringify(file)).not.toContain('/Users/someone');
  });

  it('refuses with Local only on, before anything is encoded or sent', async () => {
    const { client, callLog, requests } = noNetwork();
    const { deps, watch } = critiqueDeps({ models: client, localOnly: () => true });
    const result = await createCloudCritiqueTool(deps).run(INPUT, toolContext().ctx);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'core.local_only', params: { what: 'upload' } },
    });
    expect(watch).toMatchObject({ prepared: 0, consentAsked: 0 });
    expect(requests).toEqual([]);
    expect(callLog.records).toEqual([]);
  });

  it('refuses when Local only is turned on while this Mac listens, before the upload', async () => {
    const { client, callLog, requests } = noNetwork();
    let reads = 0;
    const { deps, watch } = critiqueDeps({ models: client, localOnly: () => reads++ > 0 });
    const result = await createCloudCritiqueTool(deps).run(INPUT, toolContext().ctx);
    expect(result).toMatchObject({ ok: false, error: { code: 'core.local_only' } });
    expect(watch).toMatchObject({ prepared: 1, done: 1 });
    expect(requests).toEqual([]);
    expect(callLog.records).toEqual([]);
  });

  it('refuses without the person’s consent: nothing is encoded or sent', async () => {
    const { client, callLog, requests } = noNetwork();
    const { deps, watch } = critiqueDeps({ models: client, consent: refuseConsent });
    const result = await createCloudCritiqueTool(deps).run(INPUT, toolContext().ctx);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'audio.cloud_critique_consent_required',
        messageKey: 'errors.audio.cloud_critique_consent_required',
      },
    });
    expect(watch).toMatchObject({ consentAsked: 1, prepared: 0 });
    expect(requests).toEqual([]);
    expect(callLog.records).toEqual([]);
  });

  it('says no model can hear when the vision chain has no Gemini, and sends nothing', async () => {
    const { client, requests } = noNetwork();
    const openai = { provider: 'openai', model: 'gpt-6-luna' };
    const { deps, watch } = critiqueDeps({ models: client, chain: [openai] });
    const result = await createCloudCritiqueTool(deps).run(INPUT, toolContext().ctx);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'models.model_unsuitable', params: { module: 'vision', need: 'audio-input' } },
    });
    expect(watch).toMatchObject({ prepared: 0, consentAsked: 0 });
    expect(requests).toEqual([]);
    const empty = critiqueDeps({ models: client, chain: [] });
    expect(await createCloudCritiqueTool(empty.deps).run(INPUT, toolContext().ctx)).toMatchObject({
      ok: false,
      error: { code: 'models.no_model_for_module' },
    });
  });

  it('fails before the upload when this Mac could not measure the sound', async () => {
    const { client, requests } = noNetwork();
    const { deps, watch } = critiqueDeps({
      models: client,
      facts: async () => ({
        ok: false,
        error: { code: 'audio.listen_failed', messageKey: 'x', retryable: true },
      }),
    });
    const result = await createCloudCritiqueTool(deps).run(INPUT, toolContext().ctx);
    expect(result).toMatchObject({ ok: false, error: { code: 'audio.listen_failed' } });
    expect(watch.done).toBe(1);
    expect(requests).toEqual([]);
  });
});

describe('audio.cloudCritique metadata', () => {
  const { deps } = critiqueDeps({ models: noNetwork().client });
  const tool = createCloudCritiqueTool(deps);

  it('is a cloud, external upload that always asks, never retries and is never on MCP', () => {
    expect(toolSpecProblems(tool)).toEqual([]);
    expect(tool).toMatchObject({
      name: 'audio.cloudCritique',
      costClass: 'cloud',
      sideEffect: 'external',
      alwaysAsk: true,
      timeoutMs: CLOUD_CRITIQUE_TIMEOUT_MS,
      retry: { maxAttempts: 1 },
      exposure: { mcp: false },
      permission: {
        network: 'internet',
        cloudModules: ['vision'],
        uploads: { what: 'user-media', consent: 'first-use', media: 'audio' },
      },
    });
    expect(CLOUD_CRITIQUE_TIMEOUT_MS).toBe(120_000);
    // The registry hands both schemas to the model as JSON Schema (packages/tools schemas.ts).
    for (const [schema, io] of [
      [tool.input, 'input'],
      [tool.output, 'output'],
    ] as const)
      expect(() => z.toJSONSchema(schema, { io, unrepresentable: 'throw' })).not.toThrow();
    expect(tool.summary?.length).toBeLessThanOrEqual(120);
  });

  it('estimates an upper bound from the catalogue price of the Gemini it would use', () => {
    const whole = tool.estimateCost!(tool.input.parse(INPUT));
    expect(whole.usd).toBeGreaterThan(0);
    expect(whole.basis).toContain('google/gemini-3.5-flash');
    const short = tool.estimateCost!(
      tool.input.parse({
        ...INPUT,
        range: {
          start: { value: 0, rate: { num: 1, den: 1 } },
          duration: { value: 10, rate: { num: 1, den: 1 } },
        },
      }),
    );
    expect(short.usd).toBeLessThan(whole.usd);
    const none = critiqueDeps({ models: noNetwork().client, chain: [] });
    expect(createCloudCritiqueTool(none.deps).estimateCost!(tool.input.parse(INPUT))).toMatchObject({
      usd: 0,
    });
  });

  it('keys a call by its source, window, flags and question, and takes exactly one source', () => {
    const key = (input: object) => tool.idempotencyKey!(tool.input.parse({ ...INPUT, ...input }));
    expect(key({})).toBe(key({}));
    expect(
      new Set([
        key({}),
        key({ prompt: 'Is the hit late?' }),
        key({ withTimeline: true }),
        key({ synthIntended: true }),
      ]).size,
    ).toBe(4);
    expect(tool.input.safeParse({}).success).toBe(false);
    expect(tool.input.safeParse({ ...INPUT, artifactId: INPUT.assetId }).success).toBe(false);
  });
});
