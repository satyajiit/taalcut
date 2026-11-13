// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B7 "every call shows in the cost card and CloudCall log": one row per request that reached the wire
 * (success, 429, cancel), billed in images; OpenRouter's usage.cost wins over the table (a Grok still is
 * never US$0); estimates are the table × count, token-priced ones flagged, unknown ones null (never 0); the
 * key never reaches a row or an error.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloudCallRecordSchema } from '@taalcut/core';
import {
  chainEstimate,
  createImageProviders,
  createMemoryCloudCallSink,
  disableNetwork,
  generateImages,
  IMAGE_PRICES,
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
  prompt: 'A coffee cup on a wooden table',
  aspect: '9:16',
  size: 'final',
  count: 2,
  trace: { runId: 'run-1', spanId: 'span-1' },
};

function setup(providers: string[], answers: Parameters<typeof wire>[0]) {
  const net = wire(answers);
  const callLog = createMemoryCloudCallSink();
  let clock = 1_000;
  const list = createImageProviders({
    credentials: keys(...providers),
    callLog,
    localOnly: () => false,
    fetch: net.fetch,
    now: () => (clock += 250),
  });
  return { net, callLog, providers: list };
}

describe('CloudCall rows', () => {
  it('a success: one row, module images, billed per image, the provider usage.cost as the cost', async () => {
    const { callLog, providers } = setup(['openrouter'], {
      [URLS.openrouter]: () => json(fixtureBody('openrouter-grok', 2).replace('"cost":0.08', '"cost":0.16')),
    });
    const made = await generateImages({ providers, selector: selectorOf(GROK) }, REQUEST);
    expect(made.ok && made.value.images.map((i) => i.costUsd)).toEqual([0.08, 0.08]);
    expect(callLog.records).toHaveLength(1);
    const [row] = callLog.records;
    expect(cloudCallRecordSchema.safeParse(row).success).toBe(true);
    expect(row).toMatchObject({
      module: 'images',
      provider: 'openrouter',
      model: 'x-ai/grok-imagine-image-2.0',
      local: false,
      outcome: 'ok',
      costUsd: 0.16,
      billed: { unit: 'image', quantity: 2 },
      attempt: 1,
      runId: 'run-1',
      spanId: 'span-1',
      httpStatus: 200,
      latencyMs: 250,
    });
    expect(row?.bytesSent).toBeGreaterThan(0);
    expect(row?.bytesReceived).toBeGreaterThan(0);
  });

  it('a Grok still through OpenRouter is never US$0, whatever pi-ai records for it', async () => {
    const { callLog, providers } = setup(['openrouter'], {
      [URLS.openrouter]: () =>
        json(JSON.stringify({ ...JSON.parse(fixtureBody('openrouter-grok')), usage: {} })),
    });
    await generateImages({ providers, selector: selectorOf(GROK) }, { ...REQUEST, count: 1 });
    expect(callLog.records[0]?.costUsd).toBe(0.08);
  });

  it('a 429 then a fallback: two rows, the first an error at US$0 with the status, the second attempt 2', async () => {
    const { callLog, providers } = setup(['openrouter', 'xai'], {
      [URLS.openrouter]: () => json(fixtureBody('openrouter-429'), 429),
      [URLS.xai]: () => json(fixtureBody('xai-grok', 2)),
    });
    await generateImages({ providers, selector: selectorOf(GROK) }, REQUEST);
    expect(callLog.records.map((r) => [r.provider, r.outcome, r.errorCode, r.httpStatus, r.attempt])).toEqual(
      [
        ['openrouter', 'error', 'models.rate_limited', 429, 1],
        ['xai', 'ok', undefined, 200, 2],
      ],
    );
    expect(callLog.records[0]).toMatchObject({ costUsd: 0, billed: { unit: 'image', quantity: 0 } });
    // xAI's card price, two stills.
    expect(callLog.records[1]).toMatchObject({ costUsd: 0.08, billed: { unit: 'image', quantity: 2 } });
  });

  it('a cancel mid-request: one cancelled row; a request never sent: no row', async () => {
    const controller = new AbortController();
    const { callLog, providers } = setup(['xai'], {
      [URLS.xai]: () => {
        controller.abort();
        throw new DOMException('The operation was aborted.', 'AbortError');
      },
    });
    const made = await generateImages(
      { providers, selector: selectorOf(GROK) },
      { ...REQUEST, signal: controller.signal },
    );
    expect(!made.ok && made.error.code).toBe('core.cancelled');
    expect(callLog.records.map((r) => r.outcome)).toEqual(['cancelled']);
    const again = await generateImages(
      { providers, selector: selectorOf(GROK) },
      { ...REQUEST, signal: controller.signal },
    );
    expect(again.ok).toBe(false);
    expect(callLog.records).toHaveLength(1);
  });

  it('OpenAI bills by tokens: the usage it reports is the cost, and the tokens are on the row', async () => {
    const { callLog, providers } = setup(['openai'], {
      [URLS.openai]: () => json(fixtureBody('openai-flare')),
    });
    await generateImages({ providers, selector: selectorOf(FLARE) }, { ...REQUEST, count: 1 });
    // 52 text tokens at $5/M plus 1,720 image tokens at $30/M.
    expect(callLog.records[0]).toMatchObject({ inputTokens: 52, outputTokens: 1720, costUsd: 0.05186 });
  });

  it("Google: a row per still, each at the provider's reported tokens", async () => {
    const { callLog, providers } = setup(['google'], {
      [URLS.google]: () => json(fixtureBody('google-nano-banana')),
    });
    await generateImages({ providers, selector: selectorOf(NANO_BANANA) }, REQUEST);
    expect(callLog.records.map((r) => [r.costUsd, r.billed?.quantity])).toEqual([
      [0.0504, 1],
      [0.0504, 1],
    ]);
  });

  it('an answer OpenRouter sends without enough stills is one failed row at US$0 (all or nothing)', async () => {
    const { callLog, providers } = setup(['openrouter'], {
      [URLS.openrouter]: () => json(fixtureBody('openrouter-grok', 1)),
    });
    const made = await generateImages({ providers, selector: selectorOf(GROK) }, REQUEST);
    expect(!made.ok && made.error.code).toBe('models.image_output_invalid');
    expect(callLog.records).toEqual([expect.objectContaining({ outcome: 'error', costUsd: 0 })]);
  });

  // Review H2 and M8: the caller hears of every call that billed as its row is written, a refused answer too, so
  // a tool that fails later still reports what it spent.
  it('tells the caller of each billed call, a short xAI answer Taalcut refuses too', async () => {
    const { callLog, providers } = setup(['xai'], {
      [URLS.xai]: () => json(fixtureBody('xai-grok', 1)),
    });
    const charges: unknown[] = [];
    const made = await generateImages(
      { providers, selector: selectorOf(GROK) },
      { ...REQUEST, onCharge: (charge) => charges.push(charge) },
    );
    expect(!made.ok && made.error.code).toBe('models.image_output_invalid');
    // xAI bills the still it made (not all or nothing): the row and the caller both see it.
    expect(callLog.records.map((r) => [r.provider, r.outcome, r.costUsd])).toEqual([['xai', 'error', 0.04]]);
    expect(charges).toEqual([{ usd: 0.04, provider: 'xai', model: expect.any(String) }]);

    const paid: unknown[] = [];
    const again = setup(['xai'], { [URLS.xai]: () => json(fixtureBody('xai-grok', 2)) });
    await generateImages(
      { providers: again.providers, selector: selectorOf(GROK) },
      { ...REQUEST, onCharge: (charge) => paid.push(charge) },
    );
    expect(paid).toEqual([{ usd: 0.08, provider: 'xai', model: expect.any(String) }]);
  });

  it('the key never reaches a row or an error', async () => {
    const { callLog, providers } = setup(['openai'], {
      [URLS.openai]: () => json(fixtureBody('openai-401'), 401),
    });
    const made = await generateImages({ providers, selector: selectorOf(FLARE) }, REQUEST);
    expect(!made.ok && made.error.code).toBe('models.auth_invalid');
    const text = JSON.stringify([made, callLog.records]);
    expect(text).not.toContain('image-test-key-openai');
  });
});

describe('estimates', () => {
  it('are the price table × count; token-priced ones are flagged; an unknown model is null, never 0', () => {
    const { providers } = setup([], {});
    const [openrouter, xai, , openai] = providers;
    expect(xai?.estimate(GROK.model, { size: 'final', count: 3 })).toEqual({ usd: 0.12, estimated: false });
    expect(openrouter?.estimate(GROK.model, { size: 'draft', count: 2 })).toEqual({
      usd: 0.08,
      estimated: false,
    });
    expect(openai?.estimate(FLARE.model, { size: 'final', count: 1 })).toEqual({
      usd: 0.053,
      estimated: true,
    });
    expect(openai?.estimate(GROK.model, { size: 'final', count: 1 })).toBeNull();
  });

  it("the tool's estimate is the chain's first model at its dearest route", () => {
    const { providers } = setup([], {});
    expect(
      chainEstimate({ providers, selector: selectorOf(GROK, FLARE) }, { size: 'final', count: 2 }),
    ).toEqual({
      usd: 0.16,
      estimated: false,
      model: GROK.model,
    });
    expect(chainEstimate({ providers, selector: selectorOf() }, { size: 'final', count: 1 })).toBeNull();
  });

  it('every price row names its source and every routed model has one', () => {
    const { providers } = setup([], {});
    for (const row of IMAGE_PRICES) expect(row.source).toMatch(/^https:\/\//);
    for (const provider of providers.filter((candidate) => candidate.access !== 'subscription'))
      for (const model of provider.models())
        expect(
          provider.estimate(model, { size: 'draft', count: 1 }),
          `${provider.id} ${model}`,
        ).not.toBeNull();
  });
});
