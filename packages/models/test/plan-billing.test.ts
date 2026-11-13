// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX3-AGT: a ChatGPT plan is not money. Its models are priced at US$0 under the plan's own id, so no step asks
 * to spend on it and nothing counts against a project's budget; an API key is still priced per token.
 */
import { CHATGPT_PROVIDER, ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createCachingCredentialProvider,
  createMemoryProfileStore,
  createModelProfiles,
  createModelRuntime,
  createPlanBilling,
  createPriceLookup,
  type CredentialProvider,
  type ResolvedCredential,
} from '@taalcut/models';

const TODAY = () => '2026-10-12';

async function lookup(planBilled?: (provider: string) => boolean) {
  const profiles = createModelProfiles({ store: createMemoryProfileStore(), tier: 'minimum', today: TODAY });
  await profiles.load();
  const runtime = createModelRuntime({ builtinProviders: ['openai', 'openai-codex', 'google', 'anthropic'] });
  return createPriceLookup({
    selector: profiles,
    runtime,
    today: TODAY,
    configured: () => new Set(['openai', CHATGPT_PROVIDER]),
    ...(planBilled ? { planBilled } : {}),
  });
}

function source(kinds: Record<string, ResolvedCredential['kind']>): CredentialProvider {
  return {
    get: async (provider) =>
      ok(kinds[provider] ? { kind: kinds[provider]!, secret: 'secret', source: 'test' } : undefined),
  };
}

describe('plan billing', () => {
  it('knows a ChatGPT sign-in from main’s list before any call, and the plan’s own id always', async () => {
    let configured = new Set(['openai', CHATGPT_PROVIDER]);
    const plans = createPlanBilling({ configured: async () => configured });
    expect(plans.isPlanBilled(CHATGPT_PROVIDER)).toBe(true);
    expect(plans.isPlanBilled('openai')).toBe(false);
    await plans.refresh();
    expect(plans.isPlanBilled('openai')).toBe(true);
    expect(plans.isPlanBilled('google')).toBe(false);
    // Signed out, and an OpenAI API key added instead.
    configured = new Set(['openai']);
    await plans.refresh();
    expect(plans.isPlanBilled('openai')).toBe(false);
  });

  it('goes by the credential a call got once there is one: a key is money, any plan’s sign-in is not', async () => {
    const credentials = createCachingCredentialProvider({
      source: source({ openai: 'api_key', anthropic: 'oauth_access' }),
    });
    const plans = createPlanBilling({
      configured: async () => new Set(['openai', CHATGPT_PROVIDER, 'anthropic']),
      credentials,
    });
    await plans.refresh();
    await credentials.get('openai');
    await credentials.get('anthropic');
    expect(credentials.kindOf('openai')).toBe('api_key');
    expect(plans.isPlanBilled('openai')).toBe(false);
    expect(plans.isPlanBilled('anthropic')).toBe(true);
    credentials.forget('anthropic');
    expect(credentials.kindOf('anthropic')).toBeUndefined();
    expect(plans.isPlanBilled('anthropic')).toBe(false);
  });

  it('keeps what it knew when main can’t answer', async () => {
    let fail = false;
    const plans = createPlanBilling({
      configured: async () => {
        if (fail) throw new Error('main went away');
        return new Set(['openai', CHATGPT_PROVIDER]);
      },
    });
    await plans.refresh();
    fail = true;
    await plans.refresh();
    expect(plans.isPlanBilled('openai')).toBe(true);
  });
});

describe('prices on a plan', () => {
  it('prices OpenAI’s model on the ChatGPT plan at US$0, under the plan’s id and the model that runs', async () => {
    const plan = await lookup((provider) => provider === 'openai' || provider === CHATGPT_PROVIDER);
    expect(plan.price('agent')).toEqual({
      module: 'agent',
      provider: CHATGPT_PROVIDER,
      model: 'gpt-6.1-sol',
      local: false,
      // FIX-RUN: free per token, so the agent's token budget doesn't count the call.
      planBilled: true,
      usdPerMTok: { input: 0, output: 0, cacheRead: 0 },
    });
    const key = await lookup(() => false);
    expect(key.price('agent')).toMatchObject({ provider: 'openai', model: 'gpt-6.1-sol', local: false });
    expect(key.price('agent')!.usdPerMTok.input).toBeGreaterThan(0);
    expect(key.price('agent')!.planBilled).toBeUndefined();
  });

  it('offers a model on the plan once, not once as OpenAI’s and again as ChatGPT’s', async () => {
    const plan = await lookup((provider) => provider === 'openai' || provider === CHATGPT_PROVIDER);
    const options = plan.options('agent');
    const keys = options.map((o) => `${o.provider}/${o.model}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(options.some((o) => o.provider === 'openai')).toBe(false);
    const onPlan = options.filter((o) => o.provider === CHATGPT_PROVIDER);
    expect(onPlan.length).toBeGreaterThan(0);
    expect(onPlan.every((o) => o.usdPerMTok.input === 0 && o.usdPerMTok.output === 0)).toBe(true);
  });
});
