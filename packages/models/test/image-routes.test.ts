// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * API-key route order stays stable; dedicated subscription credentials are checked separately.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BUILTIN_PROFILES,
  createImageProviders,
  createMemoryCloudCallSink,
  disableNetwork,
  generateImages,
  imageCandidates,
  imagePathAvailable,
  MODEL_CATALOG,
  NEVER_ROUTED_IMAGE_MODELS,
  type CredentialProvider,
  type NetworkGuard,
} from '@taalcut/models';
import {
  FLARE,
  fixtureBody,
  GROK,
  json,
  keys,
  NANO_BANANA,
  selectorOf,
  signIns,
  URLS,
  wire,
} from './support/image-wire';

let guard: NetworkGuard;
beforeAll(() => {
  guard = disableNetwork();
});
afterAll(() => guard.restore());

const REQUEST = { prompt: 'A neon street at night', aspect: '9:16', size: 'draft', count: 1 } as const;
const ALL_ANSWERS = {
  [URLS.openrouter]: () => json(fixtureBody('openrouter-grok')),
  [URLS.xai]: () => json(fixtureBody('xai-grok')),
  [URLS.google]: () => json(fixtureBody('google-nano-banana')),
  [URLS.openai]: () => json(fixtureBody('openai-flare')),
};

function providersWith(credentials: CredentialProvider) {
  const net = wire(ALL_ANSWERS);
  const callLog = createMemoryCloudCallSink();
  const providers = createImageProviders({
    credentials,
    callLog,
    localOnly: () => false,
    fetch: net.fetch,
  });
  return { net, providers, callLog };
}

describe('route order', () => {
  it('is OpenRouter, xAI, Google, OpenAI', () => {
    const { providers } = providersWith(keys());
    expect(providers.map((p) => p.id)).toEqual([
      'openrouter',
      'xai',
      'google',
      'openai',
      'openai-codex-images',
    ]);
    expect(providers.map((p) => p.access)).toEqual([
      'openrouter',
      'api-key',
      'api-key',
      'api-key',
      'subscription',
    ]);
  });

  it('with all four keys, every model goes through OpenRouter first', async () => {
    const { net, providers } = providersWith(keys('openrouter', 'xai', 'google', 'openai'));
    const candidates = imageCandidates({ providers, selector: selectorOf(GROK, NANO_BANANA, FLARE) });
    expect(candidates.ok && candidates.value.map((c) => `${c.provider.id}:${c.model}`)).toEqual([
      'openrouter:x-ai/grok-imagine-image-2.0',
      'xai:x-ai/grok-imagine-image-2.0',
      'openrouter:google/gemini-nano-banana-2.1',
      'google:google/gemini-nano-banana-2.1',
      'openrouter:openai/gpt-image-2.5-flare',
      'openai:openai/gpt-image-2.5-flare',
    ]);
    const made = await generateImages({ providers, selector: selectorOf(GROK) }, REQUEST);
    expect(made.ok && made.value.images[0]?.provider).toBe('openrouter');
    expect(net.sent.map((s) => s.url)).toEqual([URLS.openrouter]);
  });

  it('with only an OpenAI key, OpenAI runs (the paths without a key are skipped, nothing sent to them)', async () => {
    const { net, providers } = providersWith(keys('openai'));
    const made = await generateImages({ providers, selector: selectorOf(GROK, NANO_BANANA, FLARE) }, REQUEST);
    expect(made.ok && made.value.images[0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-image-2.5-flare',
    });
    expect(made.ok && made.value.fallbacks).toEqual([]);
    expect(net.sent.map((s) => s.url)).toEqual([URLS.openai]);
  });

  it('a single chain entry naming a provider directly stays on that provider', () => {
    const { providers } = providersWith(keys());
    const candidates = imageCandidates({
      providers,
      selector: selectorOf({ provider: 'xai', model: 'grok-imagine-image-2.0' }),
    });
    expect(candidates.ok && candidates.value.map((c) => c.provider.id)).toEqual(['xai']);
  });
});

describe('subscription paths', () => {
  it.each([
    ['openai', 'openai', FLARE],
    ['openai-codex', 'openai', FLARE],
  ] as const)('never sends a %s sign-in token to the %s image API', async (id, route, model) => {
    const { net, providers, callLog } = providersWith(signIns(id));
    const deps = { providers, selector: selectorOf(model) };
    const provider = providers.find((candidate) => candidate.id === route)!;
    expect(await provider.available(model.model)).toEqual({ ok: false, reason: 'not_configured' });
    expect(await imagePathAvailable(deps)).toBeUndefined();
    const made = await generateImages(deps, REQUEST);
    expect(!made.ok && made.error.code).toBe('models.image_no_provider');
    // Direct callers must obey the same credential boundary as chain availability.
    const direct = await provider.generate(model.model, REQUEST);
    expect(!direct.ok && direct.error.code).toBe('models.not_configured');
    expect(net.sent).toEqual([]);
    expect(callLog.records).toEqual([]);
    expect(JSON.stringify({ made, direct })).not.toContain(`oauth-${id}`);
  });

  it('uses a configured compatible API-key route when ChatGPT is also signed in', async () => {
    const plan = signIns('openai', 'openai-codex');
    const api = keys('openrouter');
    const { net, providers, callLog } = providersWith({
      get: (provider, request) => (provider === 'openrouter' ? api : plan).get(provider, request),
    });
    const made = await generateImages({ providers, selector: selectorOf(FLARE) }, REQUEST);
    expect(made.ok && made.value.images[0]?.provider).toBe('openrouter');
    expect(net.sent.map((request) => request.url)).toEqual([URLS.openrouter]);
    expect(JSON.stringify({ sent: net.sent, records: callLog.records })).not.toContain('oauth-');
  });

  it('a non-image subscription sign-in alone (Claude, Copilot) is models.image_no_provider, and nothing is sent', async () => {
    const { net, providers } = providersWith(signIns('anthropic', 'github-copilot'));
    const made = await generateImages({ providers, selector: selectorOf(GROK, FLARE) }, REQUEST);
    expect(!made.ok && made.error.code).toBe('models.image_no_provider');
    expect(net.sent).toEqual([]);
    expect(await imagePathAvailable({ providers, selector: selectorOf(GROK, FLARE) })).toBeUndefined();
  });
});

describe('retired models', () => {
  it('never route, even when a profile or override names them', async () => {
    const { net, providers } = providersWith(keys('openrouter', 'openai', 'google'));
    for (const model of NEVER_ROUTED_IMAGE_MODELS) {
      expect(providers.some((p) => p.models().includes(model))).toBe(false);
      const candidates = imageCandidates({
        providers,
        selector: selectorOf({ provider: 'openrouter', model }),
      });
      expect(!candidates.ok && candidates.error.code).toBe('models.no_model_for_module');
    }
    const made = await generateImages(
      { providers, selector: selectorOf({ provider: 'openrouter', model: 'openai/gpt-image-1' }) },
      REQUEST,
    );
    expect(made.ok).toBe(false);
    expect(net.sent).toEqual([]);
  });

  it('the catalogue retires them and points gpt-image-1 at GPT Image 2.5 Flare', () => {
    const retired = (model: string) =>
      MODEL_CATALOG.find((e) => e.provider === 'openrouter' && e.model === model);
    expect(retired('openai/gpt-image-1')).toMatchObject({
      retiresOn: '2026-10-23',
      replacement: { provider: 'openrouter', model: 'openai/gpt-image-2.5-flare' },
    });
    for (const model of NEVER_ROUTED_IMAGE_MODELS) expect(retired(model)?.retiresOn, model).toBeDefined();
  });

  it("every built-in profile's images chain routes", () => {
    const { providers } = providersWith(keys());
    for (const profile of BUILTIN_PROFILES) {
      const chain = profile.modules.images.chain;
      if (chain.length === 0) continue;
      const candidates = imageCandidates({ providers, selector: selectorOf(...chain) });
      expect(candidates.ok, profile.id).toBe(true);
    }
  });
});

describe('the path the gap card offers', () => {
  it('is the first configured route, with its price for one final still', async () => {
    const { providers } = providersWith(keys('xai', 'openai'));
    const path = await imagePathAvailable({ providers, selector: selectorOf(GROK, FLARE) });
    expect(path).toEqual({
      provider: 'xai',
      model: 'x-ai/grok-imagine-image-2.0',
      access: 'api-key',
      estimateUsd: 0.04,
      estimated: false,
    });
  });
});
