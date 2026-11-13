// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Google's Gemini models through ModelClient, against the mock server's
 * Gemini route. Every request must go through the fetch ModelClient was
 * given, as for other providers: that is where the cloud-call log meters
 * bytes, and where cassettes record and replay. pi-ai refuses a custom fetch
 * for Google (1.1.0 and 1.4.0 alike); patches/ fixes it (see SPEC.md, "Google").
 *
 * With TAALCUT_RECORD=1 this also writes the Gemini cassettes the offline
 * replay suite uses (from the mock server: no Google key is involved).
 */
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openCassette, type FetchFn } from '@taalcut/models';
import { startMockProviderServer, type MockProviderServer } from '@taalcut/models/test-support';
import { askGeminiText, askGeminiVision, CASSETTE_DIR, GEMINI_KEY, geminiClient } from './support/scenarios';

let server: MockProviderServer;
beforeEach(async () => {
  server = await startMockProviderServer();
});
afterEach(async () => {
  await server.close();
});

const viaMock = (fetch: FetchFn) => geminiClient(fetch, server.geminiBaseUrl);

/** globalThis.fetch, counting what passes through it. */
function countingFetch() {
  const urls: string[] = [];
  const fetch: FetchFn = (input, init) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return globalThis.fetch(input, init);
  };
  return { urls, fetch };
}

describe('Gemini through ModelClient', () => {
  it('sends a text call through the given fetch and logs it', async () => {
    server.script('gemini', { kind: 'reply', text: 'Cut on the downbeat.', usage: { input: 40, output: 6 } });
    const { urls, fetch } = countingFetch();
    const { client, callLog } = viaMock(fetch);
    const result = await askGeminiText(client);
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail}`);
    expect(result.value).toMatchObject({ provider: 'google', model: 'gemini-3.5-flash', local: false });
    expect(result.value.text).toBe('Cut on the downbeat.');
    expect(urls).toEqual([`${server.geminiBaseUrl}/models/gemini-3.5-flash:streamGenerateContent?alt=sse`]);
    expect(server.requests.at(-1)).toMatchObject({
      route: 'gemini',
      headers: { 'x-goog-api-key': GEMINI_KEY },
    });
    expect(callLog.records).toEqual([
      expect.objectContaining({
        provider: 'google',
        model: 'gemini-3.5-flash',
        outcome: 'ok',
        inputTokens: 40,
        outputTokens: 6,
      }),
    ]);
    expect(callLog.records[0]?.bytesSent).toBeGreaterThan(0);
    expect(callLog.records[0]?.bytesReceived).toBeGreaterThan(0);
  });

  it('sends a frame as inline image data for a vision call', async () => {
    server.script('gemini', { kind: 'reply', text: 'A red square on white.' });
    const { urls, fetch } = countingFetch();
    const { client } = viaMock(fetch);
    const result = await askGeminiVision(client);
    expect(result).toMatchObject({ ok: true, value: { text: 'A red square on white.' } });
    expect(urls).toHaveLength(1);
    const contents = server.requests.at(-1)?.body.contents as { parts: Record<string, unknown>[] }[];
    expect(contents.at(-1)?.parts).toContainEqual({
      inlineData: { mimeType: 'image/png', data: expect.any(String) },
    });
  });

  it('keeps the key out of an error the provider sends back, and still logs the call', async () => {
    server.script('gemini', { kind: 'error', status: 400, message: `API key ${GEMINI_KEY} not valid.` });
    const { fetch } = countingFetch();
    const { client, callLog } = viaMock(fetch);
    const result = await askGeminiText(client);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).not.toContain(GEMINI_KEY);
    expect(callLog.records).toEqual([expect.objectContaining({ provider: 'google', outcome: 'error' })]);
    expect(JSON.stringify(callLog.records)).not.toContain(GEMINI_KEY);
  });
});

describe.runIf(process.env.TAALCUT_RECORD === '1')('recording the Gemini cassettes', () => {
  it.each([
    ['google-gemini-text', askGeminiText, 'Cut on the downbeat.'],
    ['google-gemini-vision', askGeminiVision, 'A red square on white.'],
  ] as const)('records %s from the mock server', async (name, ask, text) => {
    server.script('gemini', { kind: 'reply', text, usage: { input: 1290, output: 9, cached: 0 } });
    const cassette = openCassette({
      path: join(CASSETTE_DIR, `${name}.json`),
      mode: 'record',
      secrets: [GEMINI_KEY],
      // The request is built for Google's URL; only the bytes come from the mock.
      upstream: (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        return globalThis.fetch(`${server.url}${url.pathname}${url.search}`, init);
      },
      note: "Gemini wire format from the mock server (test/support/wire.ts geminiStream), not Google: no Google key was used. Requests are pi-ai's real ones for generativelanguage.googleapis.com. Re-record with TAALCUT_RECORD=1.",
    });
    const { client } = geminiClient(cassette.fetch);
    expect(await ask(client)).toMatchObject({ ok: true });
    await cassette.save();
  });
});
