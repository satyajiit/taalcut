// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it, vi } from 'vitest';
import { CHATGPT_IMAGE_PROVIDER } from '@taalcut/core';
import {
  BUILTIN_PROFILES,
  createImageProviders,
  createMemoryCloudCallSink,
  createStaticCredentialProvider,
  generateImages,
  type CredentialProvider,
  type FetchFn,
  type ResolvedCredential,
} from '@taalcut/models';
import { createImageProvider } from '../src/images/image-provider';
import { CODEX_IMAGES } from '../src/images/providers/codex';
import { fixtureBody, json, keys, png, selectorOf, wire } from './support/image-wire';

const ENDPOINT = 'https://chatgpt.com/backend-api/codex/images/generations';
const MODEL = 'openai/gpt-image-2';
const REQUEST = { prompt: 'An airport at dawn', aspect: '9:16', size: 'final', count: 1 } as const;
const OAUTH: ResolvedCredential = {
  kind: 'oauth_access',
  secret: 'codex-image-test-access',
  source: 'OAuth',
  headers: { 'chatgpt-account-id': 'codex-image-test-account' },
};
const IMAGE_BODY = () => fixtureBody('openai-flare');

function setup(
  options: {
    credentials?: CredentialProvider;
    fetch?: FetchFn;
    localOnly?: boolean;
    maxResponseBytes?: number;
  } = {},
) {
  const net = wire({ [ENDPOINT]: () => json(IMAGE_BODY()) });
  const callLog = createMemoryCloudCallSink();
  const credentials =
    options.credentials ?? createStaticCredentialProvider({ [CHATGPT_IMAGE_PROVIDER]: OAUTH });
  const provider = createImageProvider(
    { ...CODEX_IMAGES, ...(options.maxResponseBytes && { maxResponseBytes: options.maxResponseBytes }) },
    {
      credentials,
      callLog,
      localOnly: () => options.localOnly ?? false,
      fetch: options.fetch ?? net.fetch,
    },
  );
  return { provider, callLog, net, credentials };
}

describe('Codex subscription image requests', () => {
  it('posts the dedicated image request with the separate account, and records subscription billing', async () => {
    const fetch = vi.fn<FetchFn>(async () => json(IMAGE_BODY()));
    const { provider, callLog } = setup({ fetch });
    expect(await provider.available(MODEL)).toEqual({ ok: true, access: 'subscription' });
    expect(provider.estimate(MODEL, REQUEST)).toBeNull();
    const charged = vi.fn();
    const made = await provider.generate(MODEL, { ...REQUEST, avoid: 'Unreadable text', onCharge: charged });
    expect(made.ok && made.value[0]).toMatchObject({
      provider: CHATGPT_IMAGE_PROVIDER,
      model: 'gpt-image-2',
      access: 'subscription',
      width: 1024,
      height: 1536,
      mediaType: 'image/png',
      costUsd: 0,
    });
    expect(fetch).toHaveBeenCalledWith(
      ENDPOINT,
      expect.objectContaining({ redirect: 'error', method: 'POST' }),
    );
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(Object.fromEntries(new Headers(init.headers))).toEqual({
      authorization: `Bearer ${OAUTH.secret}`,
      'chatgpt-account-id': 'codex-image-test-account',
      'content-type': 'application/json',
      accept: 'application/json',
      originator: 'taalcut',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'gpt-image-2',
      prompt: `${REQUEST.prompt}\n\nAvoid: Unreadable text\n\nCompose for a 9:16 aspect ratio. Keep key content within a centered crop at that ratio.`,
      background: 'opaque',
      quality: 'auto',
      size: 'auto',
    });
    expect(callLog.records).toHaveLength(1);
    expect(callLog.records[0]).toMatchObject({
      billing: 'subscription',
      costUsd: 0,
      outcome: 'ok',
      billed: { unit: 'image', quantity: 1 },
    });
    expect(JSON.stringify(callLog.records)).not.toContain(OAUTH.secret);
    expect(charged).not.toHaveBeenCalled();
  });

  it.each<Readonly<Record<string, ResolvedCredential>>>([
    { openai: OAUTH },
    { 'openai-codex': OAUTH },
    { [CHATGPT_IMAGE_PROVIDER]: { ...OAUTH, kind: 'api_key' as const } },
    { [CHATGPT_IMAGE_PROVIDER]: { ...OAUTH, headers: {} } },
  ])('rejects chat grants, API keys and incomplete image grants before sending (%j)', async (stored) => {
    const { provider, net, callLog } = setup({ credentials: createStaticCredentialProvider(stored) });
    expect(await provider.available(MODEL)).toEqual({ ok: false, reason: 'not_configured' });
    expect(await provider.generate(MODEL, REQUEST)).toMatchObject({
      ok: false,
      error: { code: 'models.not_configured' },
    });
    expect(net.sent).toEqual([]);
    expect(callLog.records).toEqual([]);
  });

  it.each([
    [401, 'expired token', 'models.auth_invalid'],
    [403, 'account is not entitled', 'models.image_access_denied'],
    [429, 'usage_limit_reached', 'models.quota_exceeded'],
    [429, 'too many requests', 'models.rate_limited'],
  ])('surfaces HTTP %i (%s) without pretending an image exists', async (status, message, code) => {
    const invalidate = vi.fn();
    const credentials = {
      ...createStaticCredentialProvider({ [CHATGPT_IMAGE_PROVIDER]: OAUTH }),
      invalidate,
    };
    const fetch = vi.fn(async () =>
      json(JSON.stringify({ error: { message: `${message} ${OAUTH.secret}` } }), status),
    );
    const { provider, callLog } = setup({ credentials, fetch });
    const result = await provider.generate(MODEL, REQUEST);
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(JSON.stringify(result)).not.toContain(OAUTH.secret);
    expect(fetch).toHaveBeenCalledOnce();
    expect(callLog.records[0]).toMatchObject({
      billing: 'subscription',
      outcome: 'error',
      costUsd: 0,
      errorCode: code,
    });
    expect(invalidate.mock.calls).toEqual(status === 401 ? [[CHATGPT_IMAGE_PROVIDER]] : []);
  });

  it('cancels before dispatch and while a response is streaming', async () => {
    const before = setup();
    const signal = AbortSignal.abort();
    expect(await before.provider.generate(MODEL, { ...REQUEST, signal })).toMatchObject({
      ok: false,
      error: { code: 'core.cancelled' },
    });
    expect(before.net.sent).toEqual([]);
    const controller = new AbortController();
    const reading = Promise.withResolvers<void>();
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      { pull: () => reading.resolve(), cancel: cancelled },
      { highWaterMark: 0 },
    );
    const during = setup({ fetch: async () => new Response(body) });
    const pending = during.provider.generate(MODEL, { ...REQUEST, signal: controller.signal });
    await reading.promise;
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it.each(['{}', '{"data":[{"b64_json":"not an image"}]}'])(
    'rejects empty or invalid output (%s)',
    async (body) => {
      const { provider } = setup({ fetch: async () => json(body) });
      expect(await provider.generate(MODEL, REQUEST)).toMatchObject({
        ok: false,
        error: { code: 'models.image_output_invalid' },
      });
    },
  );

  it('bounds the streaming response even without a Content-Length', async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(65));
      },
      cancel: cancelled,
    });
    const { provider } = setup({ maxResponseBytes: 64, fetch: async () => new Response(body) });
    expect(await provider.generate(MODEL, REQUEST)).toMatchObject({
      ok: false,
      error: { code: 'models.image_output_invalid' },
    });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('keeps a valid native-size image with its measured dimensions for the renderer to crop', async () => {
    const body = JSON.stringify({ data: [{ b64_json: Buffer.from(png(1024, 1024)).toString('base64') }] });
    const { provider } = setup({ fetch: async () => json(body) });
    const made = await provider.generate(MODEL, REQUEST);
    expect(made.ok && made.value[0]).toMatchObject({ width: 1024, height: 1024, mediaType: 'image/png' });
  });

  it('still rejects unusably small images when native aspect is preserved', async () => {
    const body = JSON.stringify({ data: [{ b64_json: Buffer.from(png(128, 128)).toString('base64') }] });
    const { provider } = setup({ fetch: async () => json(body) });
    expect(await provider.generate(MODEL, REQUEST)).toMatchObject({
      ok: false,
      error: { code: 'models.image_output_invalid' },
    });
  });

  it('keeps Local only offline, and uses one request per generated image', async () => {
    const local = setup({ localOnly: true });
    expect(await local.provider.generate(MODEL, REQUEST)).toMatchObject({
      ok: false,
      error: { code: 'core.local_only' },
    });
    expect(local.net.sent).toEqual([]);
    const cloud = setup();
    const made = await cloud.provider.generate(MODEL, { ...REQUEST, count: 2 });
    expect(made.ok && made.value).toHaveLength(2);
    expect(cloud.net.sent).toHaveLength(2);
    expect(cloud.net.sent.every((request) => request.body.n === undefined)).toBe(true);
  });

  it.each(['fast-cheap', 'balanced', 'best-quality'])(
    'selects the documented subscription model in %s without spending a key',
    async (id) => {
      const profile = BUILTIN_PROFILES.find((profile) => profile.id === id)!;
      const plan = createStaticCredentialProvider({ [CHATGPT_IMAGE_PROVIDER]: OAUTH });
      const paid = keys('openrouter');
      const fetch = vi.fn(async (input) => {
        expect(input).toBe(ENDPOINT);
        return json(IMAGE_BODY());
      });
      const providers = createImageProviders({
        credentials: {
          get: (provider, request) =>
            (provider === CHATGPT_IMAGE_PROVIDER ? plan : paid).get(provider, request),
        },
        fetch,
        callLog: createMemoryCloudCallSink(),
        localOnly: () => false,
      });
      const made = await generateImages(
        { providers, selector: selectorOf(...profile.modules.images.chain) },
        REQUEST,
      );
      expect(made.ok && made.value.images[0]).toMatchObject({
        provider: CHATGPT_IMAGE_PROVIDER,
        model: 'gpt-image-2',
        access: 'subscription',
      });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );
});
