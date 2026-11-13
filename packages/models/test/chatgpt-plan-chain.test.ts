// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX3-AGT: "Add a key first, then try again" after signing in with ChatGPT. Two causes, both covered here:
 * a chain whose only set-up model is ChatGPT's reported the last link's models.not_configured instead of
 * ChatGPT's own failure, and a pick on the ChatGPT plan (`openai-codex/…`, what the model picker offers once
 * ChatGPT is signed in) looked for a credential under `openai-codex`, where nothing is ever stored. Calls a
 * plan pays for cost nothing per token, so no budget counts them.
 */
import { CHATGPT_PROVIDER } from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMemoryProfileStore,
  createModelProfiles,
  createStaticCredentialProvider,
  type ChatMessage,
  type ResolvedCredential,
} from '@taalcut/models';
import { collect, createHarness, TEST_CREDENTIALS, type Harness } from './support/harness';

const PROMPT: ChatMessage[] = [{ role: 'user', content: 'Cut it to the beat.' }];
const ACCESS = 'chatgpt-access-token-0123456789';
const CHATGPT_ONLY = { openai: plan(ACCESS) };

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

function plan(secret: string): ResolvedCredential {
  return { kind: 'oauth_access', secret, expiresAt: Date.now() + 3_600_000, source: 'OAuth' };
}

/** Everyday (balanced): openai/gpt-6.1-sol, then anthropic/claude-sonnet-5-5, then google/gemini-3.8-flash. */
async function everyday(credentials: Readonly<Record<string, ResolvedCredential>>): Promise<Harness> {
  const profiles = createModelProfiles({ store: createMemoryProfileStore(), tier: 'recommended' });
  await profiles.load();
  h = await createHarness({ selector: profiles, credentials: createStaticCredentialProvider(credentials) });
  return h;
}

describe('a ChatGPT sign-in and nothing else', () => {
  it('reports ChatGPT’s own failure, not the unconfigured models after it', async () => {
    const harness = await everyday(CHATGPT_ONLY);
    harness.server.script('openai', { kind: 'error', status: 500, message: 'Internal server error' });
    const events = await collect(harness.client.stream({ module: 'agent', messages: PROMPT }));

    // The chain still moves on, and says why at each step.
    const reasons = events.flatMap((e) => (e.type === 'fallback' ? [e.reason.code] : []));
    expect(reasons).toEqual(['models.provider_unavailable', 'models.not_configured']);
    const last = events.at(-1);
    expect(last?.type === 'error' && last.error).toMatchObject({
      code: 'models.provider_unavailable',
      params: { provider: 'openai', model: 'gpt-6.1-sol' },
    });
  });

  it('says the plan is busy when ChatGPT rate-limits, rather than asking for a key', async () => {
    const harness = await everyday(CHATGPT_ONLY);
    harness.server.script('openai', { kind: 'error', status: 429, message: 'Rate limit reached' });
    const result = await harness.client.complete({ module: 'agent', messages: PROMPT });
    expect(!result.ok && result.error.code).toBe('models.rate_limited');
  });

  it('still asks to set up the primary when no model in the chain is set up', async () => {
    const harness = await everyday({});
    const result = await harness.client.complete({ module: 'agent', messages: PROMPT });
    expect(!result.ok && result.error).toMatchObject({
      code: 'models.not_configured',
      params: { provider: 'openai', model: 'gpt-6.1-sol' },
    });
    expect(harness.server.requests).toHaveLength(0);
  });
});

describe('a pick on the ChatGPT plan', () => {
  const PICK = { provider: CHATGPT_PROVIDER, model: 'gpt-5.5' };

  it('runs on openai with the ChatGPT sign-in', async () => {
    const harness = await everyday(CHATGPT_ONLY);
    const result = await harness.client.complete({ module: 'agent', target: PICK, messages: PROMPT });
    // gpt-5.5 is no longer one of the plan's models: its role's (the best) goes out instead.
    expect(result.ok && result.value).toMatchObject({ provider: CHATGPT_PROVIDER, model: 'gpt-6-astra' });
    expect(harness.server.requests.map((r) => r.route)).toEqual(['openai']);
    expect(harness.server.requests[0]?.headers.authorization).toBe(`Bearer ${ACCESS}`);
    // The plan's rules apply to it as to any ChatGPT call.
    expect(harness.server.requests[0]?.body).toMatchObject({
      model: 'gpt-6-astra',
      store: false,
      stream: true,
    });
    expect(harness.callLog.records.map((r) => [r.provider, r.outcome])).toEqual([[CHATGPT_PROVIDER, 'ok']]);
  });

  it('never runs on an OpenAI API key instead', async () => {
    const harness = await everyday({ openai: TEST_CREDENTIALS.openai! });
    const result = await harness.client.complete({ module: 'agent', target: PICK, messages: PROMPT });
    expect(!result.ok && result.error.code).toBe('models.not_configured');
    expect(harness.server.requests).toHaveLength(0);
  });
});

describe('what a call costs', () => {
  it('costs nothing per token on a plan, so no budget counts it', async () => {
    const harness = await everyday(CHATGPT_ONLY);
    const result = await harness.client.complete({ module: 'agent', messages: PROMPT });
    expect(result.ok && result.value.usage.inputTokens).toBeGreaterThan(0);
    expect(result.ok && result.value.usage.costUsd).toBe(0);
    // FIX-RUN: the result says the plan paid, so the agent's token budget doesn't count its tokens.
    expect(result.ok && result.value.planBilled).toBe(true);
    expect(harness.callLog.records.map((r) => r.costUsd)).toEqual([0]);
  });

  it('keeps the price of a call on an API key', async () => {
    const harness = await everyday({ openai: TEST_CREDENTIALS.openai! });
    const result = await harness.client.complete({ module: 'agent', messages: PROMPT });
    expect(result.ok && result.value.usage.costUsd).toBeGreaterThan(0);
    expect(result.ok && result.value.planBilled).toBeUndefined();
  });
});
