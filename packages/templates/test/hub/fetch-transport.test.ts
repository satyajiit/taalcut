// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** createFetchHubTransport: local only, status mapping, one retry, and a key that stays out of errors. */
import { describe, expect, it } from 'vitest';
import { err, newId, NotImplementedError, ok } from '@taalcut/core';
import { createFetchHubTransport } from '../../src/hub/fetch-transport';
import { sha256Hex } from '../../src/store/change-key';
import { sharedDocument } from './helpers';

const KEY = 'supersecretinstallkeyXXXX';
const ENDPOINTS = {
  indexUrl: 'https://hub.example/v0/index.json?cache=1',
  workerUrl: 'https://worker.example',
};

function transport(options?: {
  readonly localOnly?: boolean;
  readonly endpoints?: typeof ENDPOINTS | null;
  readonly fetch?: typeof fetch;
  readonly key?: string;
}) {
  return createFetchHubTransport({
    endpoints: options && 'endpoints' in options ? (options.endpoints ?? null) : ENDPOINTS,
    localOnly: () => options?.localOnly ?? false,
    installKey: async () => ok(options?.key ?? KEY),
    fetch: options?.fetch ?? (async () => new Response('{}', { status: 200 })),
  });
}

describe('fetch hub transport', () => {
  it('refuses local only and a missing endpoint before fetch', async () => {
    let calls = 0;
    const local = transport({
      localOnly: true,
      fetch: async () => {
        calls += 1;
        return new Response('{}');
      },
    });
    const refused = await local.ratings();
    expect(!refused.ok && refused.error.code).toBe('core.local_only');
    expect(calls).toBe(0);

    const missing = transport({
      endpoints: null,
      fetch: async () => {
        calls += 1;
        return new Response('{}');
      },
    });
    const unconfigured = await missing.index(null);
    expect(!unconfigured.ok && unconfigured.error.code).toBe('hub.not_configured');
    expect(calls).toBe(0);
  });

  it('maps 429 to hub.rate_limited and retries a retryable status once', async () => {
    let calls = 0;
    const limited = transport({
      fetch: async () => {
        calls += 1;
        return new Response(JSON.stringify({ code: 'hub.rate_limited', retryAfterSeconds: 4 }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '9' },
        });
      },
    });
    const result = await limited.ratings();
    expect(!result.ok && result.error.code).toBe('hub.rate_limited');
    expect(!result.ok && result.error.params).toMatchObject({ retryAfterSeconds: 4 });
    expect(calls).toBe(2);
    expect(JSON.stringify(result)).not.toContain(KEY);

    calls = 0;
    const flaky = transport({
      fetch: async () => {
        calls += 1;
        if (calls === 1) throw new Error(`offline ${KEY}`);
        return new Response(JSON.stringify({ generatedAt: 1, ratings: {} }), { status: 200 });
      },
    });
    const ratings = await flaky.ratings();
    expect(ratings.ok).toBe(true);
    expect(calls).toBe(2);
    expect(JSON.stringify(ratings)).not.toContain(KEY);
  });

  it('sends the install key only in the write body and never on an error', async () => {
    const seen: { url: string; body: string; match: string | null }[] = [];
    const client = transport({
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers);
        seen.push({
          url: String(url),
          body: typeof init?.body === 'string' ? init.body : '',
          match: headers.get('if-none-match'),
        });
        if (String(url).includes('/v0/ratings/')) {
          return new Response(JSON.stringify({ leaked: KEY, code: 'nope' }), { status: 400 });
        }
        if (String(url).includes('/v0/index.json')) {
          return new Response(JSON.stringify({ formatVersion: 0 }), {
            status: 200,
            headers: { etag: 'W/"e"' },
          });
        }
        const text = '{"hello":1}';
        return new Response(text, { status: 200 });
      },
    });
    const index = await client.index('W/"e"');
    expect(index.ok && index.value).toMatchObject({ status: 200, etag: 'W/"e"' });
    expect(seen[0]?.match).toBe('W/"e"');
    expect(seen[0]?.body).toBe('');

    const hubId = newId<'HubTemplate'>();
    const file = await client.template(hubId);
    expect(file.ok && file.value.sha256).toBe(sha256Hex('{"hello":1}'));
    expect(seen[1]?.url).toBe(`https://hub.example/v0/templates/${hubId}.json`);

    const rated = await client.rate(hubId, { stars: 5 });
    expect(!rated.ok && rated.error.code).toBe('hub.invalid');
    expect(JSON.stringify(rated)).not.toContain(KEY);
    expect(seen.some((call) => call.body.includes(KEY) && call.body.includes('"stars":5'))).toBe(true);

    const badKey = transport({ key: 'too-short', fetch: async () => new Response('{}', { status: 200 }) });
    const rejected = await badKey.submit({ template: sharedDocument().doc });
    expect(!rejected.ok && rejected.error.code).toBe('core.validation');
    expect(!rejected.ok && rejected.error.params).toMatchObject({ field: 'installKey' });
    expect(JSON.stringify(rejected)).not.toContain('too-short');
  });

  it('hashes the exact bytes of a template file and refuses bytes that are not UTF-8', async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"hello":1}')]);
    const client = transport({ fetch: async () => new Response(bom, { status: 200 }) });
    const file = await client.template(newId<'HubTemplate'>());
    expect(file.ok && file.value).toEqual({ body: { hello: 1 }, sha256: sha256Hex(bom) });

    const broken = transport({ fetch: async () => new Response(new Uint8Array([0x7b, 0xff, 0x7d])) });
    const refused = await broken.template(newId<'HubTemplate'>());
    expect(!refused.ok && refused.error.code).toBe('hub.invalid');
  });

  it('sends nothing when the keychain has no install key, and says why', async () => {
    let calls = 0;
    const client = createFetchHubTransport({
      endpoints: ENDPOINTS,
      localOnly: () => false,
      installKey: async () => err(NotImplementedError({ feature: 'hub.installKey' })),
      fetch: async () => {
        calls += 1;
        return new Response('{}');
      },
    });
    const sent = await client.report({ hubId: newId<'HubTemplate'>(), reason: 'spam' });
    expect(!sent.ok && sent.error.code).toBe('core.not_implemented');
    expect(calls).toBe(0);
  });

  it('checks a Worker reply against its schema', async () => {
    const client = transport({ fetch: async () => new Response(JSON.stringify({ issue: 'one' })) });
    const sent = await client.report({ hubId: newId<'HubTemplate'>(), reason: 'spam' });
    expect(!sent.ok && sent.error.code).toBe('hub.invalid');
  });
});
