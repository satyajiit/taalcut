// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@taalcut/core';
import {
  BUILTIN_PROFILES,
  createImageProviders,
  createMemoryCloudCallSink,
  disableNetwork,
  generateImages,
  imagePathAvailable,
  SignInRequired,
  type CredentialProvider,
  type NetworkGuard,
} from '@taalcut/models';
import { XAI_IMAGES } from '../src/images/providers/xai';
import { refineImageCost } from '../src/images/image-chain';
import { CODEX_IMAGES_BASE_URL } from '../src/signin/codex-images';
import { fixtureBody, GROK, json, keys, selectorOf, signIns, URLS, wire } from './support/image-wire';

let guard: NetworkGuard;
beforeAll(() => {
  guard = disableNetwork();
});
afterAll(() => guard.restore());
const REQUEST = {
  prompt: 'Airport glass and warm daylight',
  aspect: '9:16',
  size: 'final',
  count: 1,
} as const;

function setup(answer = () => json(fixtureBody('xai-grok')), credentials?: CredentialProvider) {
  const paid = keys('openrouter');
  const subscription = signIns('xai');
  const invalidate = vi.fn();
  const net = wire({ [URLS.xai]: answer, [URLS.openrouter]: () => json(fixtureBody('openrouter-grok')) });
  const callLog = createMemoryCloudCallSink();
  const providers = createImageProviders({
    credentials: credentials ?? {
      get: (id, request) => (id === 'xai' ? subscription : paid).get(id, request),
      invalidate,
    },
    callLog,
    localOnly: () => false,
    fetch: net.fetch,
  });
  return { ...net, callLog, invalidate, deps: { providers, selector: selectorOf(GROK) } };
}

describe('Grok subscription images', () => {
  it.each(['fast-cheap', 'balanced', 'best-quality'])(
    'uses a Grok sign-in with the %s profile',
    async (id) => {
      const profile = BUILTIN_PROFILES.find((profile) => profile.id === id)!;
      const test = setup(undefined, signIns('xai'));
      const made = await generateImages(
        {
          providers: test.deps.providers,
          selector: selectorOf(...profile.modules.images.chain),
        },
        REQUEST,
      );
      expect(made.ok && made.value.images[0]).toMatchObject({
        provider: 'xai',
        access: 'subscription',
        costUsd: 0,
      });
      expect(test.sent.map((request) => request.url)).toEqual([URLS.xai]);
    },
  );

  it('uses the xAI OAuth endpoint before a paid key, preserves plan provenance, and reports no API spend', async () => {
    const test = setup();
    const charges = vi.fn();
    expect(await imagePathAvailable(test.deps)).toEqual({
      provider: 'xai',
      model: GROK.model,
      access: 'subscription',
      estimateUsd: null,
      estimated: true,
    });
    const made = await generateImages(test.deps, { ...REQUEST, onCharge: charges });
    expect(made.ok && made.value.images[0]).toMatchObject({
      provider: 'xai',
      access: 'subscription',
      costUsd: 0,
    });
    expect(test.sent.map((request) => request.url)).toEqual([URLS.xai]);
    expect(test.sent[0]?.headers.authorization).toBe('Bearer oauth-xai');
    expect(test.callLog.records[0]).toMatchObject({
      billing: 'subscription',
      costUsd: 0,
      billed: { unit: 'image', quantity: 1 },
      outcome: 'ok',
    });
    expect(charges).not.toHaveBeenCalled();
    expect(JSON.stringify([made, test.callLog.records])).not.toContain('oauth-xai');
    const estimate = await refineImageCost(test.deps, { size: 'final', count: 3 });
    expect(estimate.ok && estimate.value).toMatchObject({ usd: 0, billed: { unit: 'image', quantity: 3 } });
    expect(estimate.ok && estimate.value.basis).toContain('quota is managed by the provider');
  });

  it.each([
    [401, 'expired oauth-xai', 'models.auth_invalid'],
    [403, 'account is not permitted to generate images oauth-xai', 'models.image_access_denied'],
    [403, 'subscription quota exhausted oauth-xai', 'models.quota_exceeded'],
    [429, 'weekly quota exhausted oauth-xai', 'models.quota_exceeded'],
    [429, 'usage_limit_reached oauth-xai', 'models.quota_exceeded'],
    [429, 'temporarily rate limited oauth-xai', 'models.rate_limited'],
    [500, 'temporary server failure oauth-xai', 'models.provider_unavailable'],
  ])('classifies %s without spending the paid fallback or leaking the bearer', async (status, body, code) => {
    const test = setup(() => json(body, status));
    const result = await generateImages(test.deps, REQUEST);
    expect(!result.ok && result.error.code).toBe(code);
    expect(test.sent.map((request) => request.url)).toEqual([URLS.xai]);
    expect(test.callLog.records[0]).toMatchObject({
      billing: 'subscription',
      costUsd: 0,
      httpStatus: status,
    });
    expect(test.invalidate.mock.calls).toEqual(status === 401 ? [['xai']] : []);
    expect(JSON.stringify([result, test.callLog.records])).not.toContain('oauth-xai');
  });

  it('does not spend a key when refreshing the signed-in account failed', async () => {
    const paid = keys('openrouter');
    const test = setup(undefined, {
      get: (id, request) =>
        id === 'xai' ? Promise.resolve(err(SignInRequired({ provider: id }))) : paid.get(id, request),
    });
    const result = await generateImages(test.deps, REQUEST);
    expect(!result.ok && result.error.code).toBe('models.sign_in_required');
    expect(test.sent).toEqual([]);
  });

  it('uses another healthy subscription when refreshing Grok fails', async () => {
    const paid = keys('openrouter');
    const net = wire({
      [`${CODEX_IMAGES_BASE_URL}/images/generations`]: () => json(fixtureBody('openai-flare')),
    });
    const providers = createImageProviders({
      credentials: {
        get: (id, request) => {
          if (id === 'xai') return Promise.resolve(err(SignInRequired({ provider: id })));
          if (id === 'openai-codex-images')
            return Promise.resolve(
              ok({
                kind: 'oauth_access',
                secret: 'healthy-plan',
                source: 'test',
                headers: { 'chatgpt-account-id': 'account' },
              }),
            );
          return paid.get(id, request);
        },
      },
      callLog: createMemoryCloudCallSink(),
      localOnly: () => false,
      fetch: net.fetch,
    });
    const made = await generateImages(
      { providers, selector: selectorOf(GROK, { provider: 'openai-codex-images', model: 'gpt-image-2' }) },
      REQUEST,
    );
    expect(made.ok && made.value.images[0]?.provider).toBe('openai-codex-images');
    expect(net.sent.map((request) => request.url)).toEqual([`${CODEX_IMAGES_BASE_URL}/images/generations`]);
  });

  it('blocks a billing-mode change between availability and dispatch', async () => {
    let reads = 0;
    const test = setup(undefined, {
      get: async (id) =>
        ok(
          id !== 'xai'
            ? undefined
            : ++reads === 1
              ? { kind: 'oauth_access', secret: 'plan', source: 'test' }
              : { kind: 'api_key', secret: 'paid', source: 'test' },
        ),
    });
    const result = await generateImages(test.deps, REQUEST);
    expect(!result.ok && result.error.code).toBe('models.image_access_denied');
    expect(test.sent).toEqual([]);
  });

  it('keeps xAI API keys valid and billed at the API price', async () => {
    const test = setup(undefined, keys('xai'));
    const made = await generateImages(test.deps, REQUEST);
    expect(made.ok && made.value.images[0]).toMatchObject({ access: 'api-key', costUsd: 0.04 });
    expect(test.callLog.records[0]).toMatchObject({ billing: 'apiKey', costUsd: 0.04 });
    const estimate = await refineImageCost(test.deps, { size: 'final', count: 1 });
    expect(estimate.ok && estimate.value.usd).toBeGreaterThan(0);
  });

  it('records invalid subscription output without inventing API charges', async () => {
    const test = setup(() => json('{"data":[{"b64_json":"broken"}]}'));
    const charges = vi.fn();
    const result = await generateImages(test.deps, { ...REQUEST, onCharge: charges });
    expect(!result.ok && result.error.code).toBe('models.image_output_invalid');
    expect(test.callLog.records[0]).toMatchObject({ billing: 'subscription', costUsd: 0, outcome: 'error' });
    expect(test.sent).toHaveLength(1);
    expect(charges).not.toHaveBeenCalled();
  });

  it('bounds an image response stream and rejects redirects on the authenticated endpoint', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json('x'.repeat(257)));
    const callLog = createMemoryCloudCallSink();
    const providers = createImageProviders({
      credentials: signIns('xai'),
      callLog,
      localOnly: () => false,
      fetch,
      routes: [{ ...XAI_IMAGES, maxResponseBytes: 256 }],
    });
    const result = await generateImages({ providers, selector: selectorOf(GROK) }, REQUEST);
    expect(!result.ok && result.error.code).toBe('models.image_output_invalid');
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe('error');
    expect(callLog.records[0]).toMatchObject({ costUsd: 0, billing: 'subscription' });
  });
});
