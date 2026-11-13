// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B7 "works with at least 2 providers": the same request through OpenRouter's /api/v1/images and xAI
 * directly (and Google's Interactions and OpenAI's Image API) comes back as decoded stills of the asked
 * aspect; a provider error moves to the next key with a fallback event. Fixtures, never the network.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createImageProviders,
  createMemoryCloudCallSink,
  disableNetwork,
  generateImages,
  imageFacts,
  type ImageFallback,
  type ImageRequest,
  type NetworkGuard,
} from '@taalcut/models';
import {
  FLARE,
  fixtureBody,
  GROK,
  json,
  keys,
  NANO_BANANA,
  png,
  selectorOf,
  URLS,
  wire,
} from './support/image-wire';

let guard: NetworkGuard;
beforeAll(() => {
  guard = disableNetwork();
});
afterAll(() => guard.restore());

const REQUEST: ImageRequest = {
  prompt: 'A sunrise over a quiet beach',
  aspect: '9:16',
  size: 'final',
  count: 1,
};

function setup(providers: string[], answers: Parameters<typeof wire>[0]) {
  const net = wire(answers);
  const callLog = createMemoryCloudCallSink();
  const list = createImageProviders({
    credentials: keys(...providers),
    callLog,
    localOnly: () => false,
    fetch: net.fetch,
  });
  return { net, callLog, providers: list };
}

describe('the same still through each provider', () => {
  it('OpenRouter: one POST to /api/v1/images, a portrait PNG back', async () => {
    const { net, providers } = setup(['openrouter'], {
      [URLS.openrouter]: () => json(fixtureBody('openrouter-grok')),
    });
    const made = await generateImages({ providers, selector: selectorOf(GROK) }, REQUEST);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const [image] = made.value.images;
    expect(image).toMatchObject({
      provider: 'openrouter',
      model: 'x-ai/grok-imagine-image-2.0',
      access: 'openrouter',
    });
    expect(image?.mediaType).toBe('image/png');
    expect(image && image.height > image.width).toBe(true);
    expect(image && imageFacts(image.bytes)).toMatchObject({ width: 1152, height: 2048 });
    expect(net.sent).toHaveLength(1);
    expect(net.sent[0]?.headers.authorization).toBe('Bearer image-test-key-openrouter');
    expect(net.sent[0]?.body).toMatchObject({
      model: 'x-ai/grok-imagine-image-2.0',
      n: 1,
      aspect_ratio: '9:16',
      resolution: '2k',
      quality: 'medium',
    });
  });

  it('xAI directly: the Grok still as a JPEG, b64 asked for', async () => {
    const { net, providers } = setup(['xai'], { [URLS.xai]: () => json(fixtureBody('xai-grok')) });
    const made = await generateImages({ providers, selector: selectorOf(GROK) }, REQUEST);
    expect(made.ok && made.value.images[0]).toMatchObject({
      provider: 'xai',
      model: 'grok-imagine-image-2.0',
      access: 'api-key',
      mediaType: 'image/jpeg',
      width: 1152,
      height: 2048,
    });
    expect(net.sent[0]?.body).toMatchObject({
      response_format: 'b64_json',
      resolution: '2k',
      aspect_ratio: '9:16',
    });
  });

  it('Google: Nano Banana 2.1 on the Interactions API, one call per still, key in x-goog-api-key', async () => {
    const { net, providers } = setup(['google'], {
      [URLS.google]: () => json(fixtureBody('google-nano-banana')),
    });
    const made = await generateImages(
      { providers, selector: selectorOf(NANO_BANANA) },
      { ...REQUEST, count: 2 },
    );
    expect(made.ok && made.value.images).toHaveLength(2);
    expect(net.sent).toHaveLength(2);
    expect(net.sent[0]?.headers['x-goog-api-key']).toBe('image-test-key-google');
    expect(net.sent[0]?.body).toMatchObject({
      model: 'gemini-nano-banana-2.1',
      response_format: { type: 'image', aspect_ratio: '9:16', image_size: '2K' },
    });
  });

  it('OpenAI: GPT Image 2.5 Flare at its tall size and medium quality, never xhigh or max', async () => {
    const { net, providers } = setup(['openai'], { [URLS.openai]: () => json(fixtureBody('openai-flare')) });
    const made = await generateImages({ providers, selector: selectorOf(FLARE) }, REQUEST);
    expect(made.ok && made.value.images[0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-image-2.5-flare',
    });
    expect(net.sent[0]?.body).toMatchObject({
      model: 'gpt-image-2.5-flare',
      size: '1024x1536',
      quality: 'medium',
    });
    const drafted = await generateImages(
      { providers, selector: selectorOf(FLARE) },
      { ...REQUEST, size: 'draft' },
    );
    expect(drafted.ok).toBe(true);
    expect(net.sent.map((s) => s.body.quality)).toEqual(['medium', 'low']);
  });

  it('what to avoid joins the prompt as a sentence', async () => {
    const { net, providers } = setup(['xai'], { [URLS.xai]: () => json(fixtureBody('xai-grok')) });
    await generateImages({ providers, selector: selectorOf(GROK) }, { ...REQUEST, avoid: 'people' });
    expect(net.sent[0]?.body.prompt).toBe('A sunrise over a quiet beach\n\nAvoid: people');
  });
});

describe('falling back', () => {
  it('a rate-limited OpenRouter key moves to the xAI key with a fallback event', async () => {
    const { net, providers } = setup(['openrouter', 'xai'], {
      [URLS.openrouter]: () => json(fixtureBody('openrouter-429'), 429, { 'retry-after': '20' }),
      [URLS.xai]: () => json(fixtureBody('xai-grok')),
    });
    const events: ImageFallback[] = [];
    const made = await generateImages({ providers, selector: selectorOf(GROK) }, REQUEST, (f) =>
      events.push(f),
    );
    expect(made.ok && made.value.images[0]?.provider).toBe('xai');
    expect(events).toHaveLength(1);
    expect(events[0]?.from).toEqual({ provider: 'openrouter', model: GROK.model });
    expect(events[0]?.to).toEqual({ provider: 'xai', model: GROK.model });
    expect(events[0]?.reason).toMatchObject({
      code: 'models.rate_limited',
      params: { retryAfterMs: 20_000 },
    });
    expect(made.ok && made.value.fallbacks).toHaveLength(1);
    expect(net.sent.map((s) => s.url)).toEqual([URLS.openrouter, URLS.xai]);
  });

  it("after a model's keys, the chain's next model", async () => {
    const { providers } = setup(['xai', 'google'], {
      [URLS.xai]: () => json('{"error":"overloaded"}', 503),
      [URLS.google]: () => json(fixtureBody('google-nano-banana')),
    });
    const made = await generateImages({ providers, selector: selectorOf(GROK, NANO_BANANA) }, REQUEST);
    expect(made.ok && made.value).toMatchObject({
      model: NANO_BANANA.model,
      fallbacks: [{ to: { provider: 'google' } }],
    });
  });

  it('a request the provider refuses as malformed does not fall back', async () => {
    const { net, providers } = setup(['openrouter', 'xai'], {
      [URLS.openrouter]: () => json('{"error":{"message":"bad aspect"}}', 400),
      [URLS.xai]: () => json(fixtureBody('xai-grok')),
    });
    const made = await generateImages({ providers, selector: selectorOf(GROK) }, REQUEST);
    expect(!made.ok && made.error.code).toBe('models.bad_request');
    expect(net.sent).toHaveLength(1);
  });

  it('a still of the wrong orientation is refused as invalid output, and falls back', async () => {
    const { providers } = setup(['openrouter', 'xai'], {
      [URLS.openrouter]: () =>
        json(JSON.stringify({ data: [{ b64_json: landscape() }], usage: { cost: 0.08 } })),
      [URLS.xai]: () => json(fixtureBody('xai-grok')),
    });
    const made = await generateImages({ providers, selector: selectorOf(GROK) }, REQUEST);
    expect(made.ok && made.value.fallbacks[0]?.reason.code).toBe('models.image_output_invalid');
  });
});

/** A landscape PNG, base64. */
const landscape = () => Buffer.from(png(2048, 1152)).toString('base64');
