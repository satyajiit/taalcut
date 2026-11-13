// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B7 consent and Local only: image models are all in the cloud, so Local only refuses before anything is
 * sent (core.local_only): no request, no CloudCall row, no fallback; and no path is offered.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createImageProviders,
  createMemoryCloudCallSink,
  disableNetwork,
  generateImages,
  imagePathAvailable,
  type NetworkGuard,
} from '@taalcut/models';
import { fixtureBody, FLARE, GROK, json, keys, selectorOf, URLS, wire } from './support/image-wire';

let guard: NetworkGuard;
beforeAll(() => {
  guard = disableNetwork();
});
afterAll(() => guard.restore());

describe('Local only', () => {
  it('refuses with core.local_only: no request, no row', async () => {
    const localOnly = { on: true };
    const net = wire({ [URLS.openrouter]: () => json(fixtureBody('openrouter-grok')) });
    const callLog = createMemoryCloudCallSink();
    const providers = createImageProviders({
      credentials: keys('openrouter', 'xai', 'google', 'openai'),
      callLog,
      localOnly: () => localOnly.on,
      fetch: net.fetch,
    });
    const fallbacks: unknown[] = [];
    const made = await generateImages(
      { providers, selector: selectorOf(GROK, FLARE) },
      { prompt: 'A mountain lake', aspect: '1:1', size: 'draft', count: 1 },
      (f) => fallbacks.push(f),
    );
    expect(!made.ok && made.error).toMatchObject({ code: 'core.local_only', params: { what: 'model' } });
    expect(net.sent).toEqual([]);
    expect(callLog.records).toEqual([]);
    expect(fallbacks).toEqual([]);
    expect(await imagePathAvailable({ providers, selector: selectorOf(GROK) })).toBeUndefined();
    for (const provider of providers)
      expect(await provider.available(GROK.model)).toEqual({ ok: false, reason: 'local_only' });

    // Read on every call: turned off, the same providers run.
    localOnly.on = false;
    const after = await generateImages(
      { providers, selector: selectorOf(GROK) },
      { prompt: 'A mountain lake', aspect: '9:16', size: 'draft', count: 1 },
    );
    expect(after.ok).toBe(true);
    expect(net.sent).toHaveLength(1);
  });

  it('a provider called directly refuses too', async () => {
    const net = wire({});
    const [openrouter] = createImageProviders({
      credentials: keys('openrouter'),
      callLog: createMemoryCloudCallSink(),
      localOnly: () => true,
      fetch: net.fetch,
    });
    const made = await openrouter?.generate(GROK.model, {
      prompt: 'x',
      aspect: '9:16',
      size: 'draft',
      count: 1,
    });
    expect(made && !made.ok && made.error.code).toBe('core.local_only');
    expect(net.sent).toEqual([]);
  });
});
