// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The chat's effort (Quick, Balanced, Deep, Max) per provider: what each
 * model the profiles use offers, the reasoning level ModelClient sends for
 * each effort, and that the level reaches the provider's wire format and the
 * cloud-call log. pi-ai's real OpenAI, Anthropic and Gemini code paths talk
 * to the mock provider server.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHAT_EFFORTS, effortReasoning, type ChatEffort } from '@taalcut/core';
import {
  createModelRuntime,
  LOCAL_RUNTIME_PROVIDER,
  thinkingLevels,
  type ModelChoice,
  type ModelRuntime,
} from '@taalcut/models';
import { collect, createHarness, type Harness } from './support/harness';
import { GEMINI_KEY, geminiClient } from './support/scenarios';

let runtime: ModelRuntime;
beforeEach(() => {
  runtime = createModelRuntime({
    endpoints: [
      {
        id: LOCAL_RUNTIME_PROVIDER,
        name: 'On-device',
        baseUrl: 'http://127.0.0.1:9/v1',
        local: true,
        models: [{ id: 'qwen3.5-4b', reasoning: true, thinkingKwarg: 'enable_thinking' }],
      },
    ],
  });
});

describe('effort per provider', () => {
  it('lists the reasoning levels each provider’s models take', () => {
    expect(runtime.findModel('openai', 'gpt-5.4')?.thinking).toEqual([
      'off',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(runtime.findModel('anthropic', 'claude-sonnet-5')?.thinking).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(runtime.findModel('anthropic', 'claude-opus-5-5')?.thinking).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(runtime.findModel('google', 'gemini-3.6-flash')?.thinking).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
    ]);
    expect(runtime.findModel('google', 'gemini-3.1-pro-preview')?.thinking).toEqual([
      'low',
      'medium',
      'high',
    ]);
    // A model that doesn't think, and the bundled runtime (thinking off: its context can't hold it).
    expect(runtime.findModel('openai', 'gpt-4.1')?.thinking).toEqual(['off']);
    expect(runtime.findModel(LOCAL_RUNTIME_PROVIDER, 'qwen3.5-4b')?.thinking).toEqual(['off']);
  });

  it.each([
    ['openai', 'gpt-5.4', { quick: 'low', balanced: 'medium', deep: 'high', max: 'xhigh' }],
    ['anthropic', 'claude-sonnet-5', { quick: 'low', balanced: 'medium', deep: 'high', max: 'max' }],
    ['anthropic', 'claude-opus-5-5', { quick: 'low', balanced: 'medium', deep: 'high', max: 'max' }],
    // Gemini stops at high: Max runs as Deep.
    ['google', 'gemini-3.6-flash', { quick: 'low', balanced: 'medium', deep: 'high', max: 'high' }],
    ['google', 'gemini-3.1-pro-preview', { quick: 'low', balanced: 'medium', deep: 'high', max: 'high' }],
    ['openai', 'gpt-4.1', { quick: 'off', balanced: 'off', deep: 'off', max: 'off' }],
    [LOCAL_RUNTIME_PROVIDER, 'qwen3.5-4b', { quick: 'off', balanced: 'off', deep: 'off', max: 'off' }],
  ] as const)('%s/%s: %o', (provider, model, expected) => {
    const levels = runtime.findModel(provider, model)?.thinking ?? [];
    const sent = Object.fromEntries(CHAT_EFFORTS.map((effort) => [effort, effortReasoning(effort, levels)]));
    expect(sent).toEqual(expected);
  });

  it('reads levels from the model itself, so a model pi-ai knows nothing about thinks not at all', () => {
    expect(thinkingLevels({ provider: 'custom', reasoning: false })).toEqual(['off']);
    expect(thinkingLevels({ provider: LOCAL_RUNTIME_PROVIDER, reasoning: true })).toEqual(['off']);
  });
});

describe('effort on the wire', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  const ask = async (target: ModelChoice, effort: ChatEffort) => {
    const events = await collect(
      h.client.stream({
        module: 'agent',
        target: { ...target, reasoning: 'medium' },
        messages: [{ role: 'user', content: 'Cut on the beat.' }],
        effort,
      }),
    );
    const start = events[0];
    if (start?.type !== 'start') throw new Error('expected start');
    return start.reasoning;
  };

  it('OpenAI: Max goes out as reasoning effort xhigh, Quick as low, over the profile’s level', async () => {
    h.server.script('openai', { kind: 'reply', text: 'Done.' });
    h.server.script('openai', { kind: 'reply', text: 'Done.' });
    expect(await ask({ provider: 'openai', model: 'gpt-5.4' }, 'max')).toBe('xhigh');
    expect(await ask({ provider: 'openai', model: 'gpt-5.4' }, 'quick')).toBe('low');
    const bodies = h.server.requests.filter((r) => r.route === 'openai').map((r) => r.body);
    expect(bodies.map((b) => (b.reasoning as { effort?: string } | undefined)?.effort)).toEqual([
      'xhigh',
      'low',
    ]);
    expect(h.callLog.records.map((r) => r.reasoning)).toEqual(['xhigh', 'low']);
  });

  it('Anthropic: Max goes out as Claude’s max effort, Deep as high', async () => {
    h.server.script('anthropic', { kind: 'reply', text: 'Done.' });
    h.server.script('anthropic', { kind: 'reply', text: 'Done.' });
    expect(await ask({ provider: 'anthropic', model: 'claude-opus-5-5' }, 'max')).toBe('max');
    expect(await ask({ provider: 'anthropic', model: 'claude-opus-5-5' }, 'deep')).toBe('high');
    const bodies = h.server.requests
      .filter((r) => r.route === 'anthropic')
      .map((r) => JSON.stringify(r.body));
    expect(bodies[0]).toContain('"max"');
    expect(bodies[1]).toContain('"high"');
    expect(bodies.every((b) => b.includes('thinking'))).toBe(true);
    expect(h.callLog.records.map((r) => r.reasoning)).toEqual(['max', 'high']);
  });

  it('Gemini: Max on a model that stops at high goes out as high', async () => {
    h.server.script('gemini', { kind: 'reply', text: 'Done.' });
    const { client, callLog } = geminiClient(
      (input, init) => globalThis.fetch(input, init),
      h.server.geminiBaseUrl,
    );
    const result = await client.complete({
      module: 'agent',
      target: { provider: 'google', model: 'gemini-3.6-flash' },
      messages: [{ role: 'user', content: 'Cut on the beat.' }],
      effort: 'max',
    });
    expect(result.ok && result.value.reasoning).toBe('high');
    const body = JSON.stringify(h.server.requests.find((r) => r.route === 'gemini')?.body);
    expect(body).toContain('thinkingConfig');
    expect(body).not.toContain(GEMINI_KEY);
    expect(callLog.records.map((r) => r.reasoning)).toEqual(['high']);
  });
});
