// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX3-AGT: the ChatGPT sign-in runs only the plan's models. The owner's Everyday agent asked for the API's
 * gpt-5.4 and ChatGPT answered 400 models.unknown_model. On the plan each pick now goes out as its role's plan
 * model; if ChatGPT still turns one down, the client tries the plan's default once and says so, and only the
 * default's own refusal reaches the user, in plain words.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_PROFILES,
  CHATGPT_PLAN_DEFAULT,
  CHATGPT_PLAN_MODELS,
  CHATGPT_PLAN_ROLES,
  createModelRuntime,
  createStaticCredentialProvider,
  planModelFor,
  planRoleOf,
  type ChatMessage,
  type ResolvedCredential,
} from '@taalcut/models';
import { collect, createHarness, TEST_CREDENTIALS, type Harness } from './support/harness';

const PROMPT: ChatMessage[] = [{ role: 'user', content: 'Cut it to the beat.' }];
const PLAN: ResolvedCredential = {
  kind: 'oauth_access',
  secret: 'chatgpt-access-token-0123456789',
  expiresAt: Date.now() + 3_600_000,
  source: 'OAuth',
};
const NOT_ON_PLAN = {
  kind: 'error',
  status: 400,
  message: 'The model is not supported on this plan.',
} as const;

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
  vi.restoreAllMocks();
});

async function harness(credential: ResolvedCredential): Promise<Harness> {
  h = await createHarness({ credentials: createStaticCredentialProvider({ openai: credential }) });
  return h;
}

const runtime = createModelRuntime();
const ids = (provider: string) =>
  new Set(runtime.listModels(provider).flatMap((m) => (m.kind === 'chat' ? [m.id] : [])));

describe('the plan’s models', () => {
  it('are all in pi-ai’s ChatGPT catalogue and in the OpenAI catalogue that runs them', () => {
    const plan = ids('openai-codex');
    const api = ids('openai');
    for (const model of CHATGPT_PLAN_MODELS) {
      expect(plan.has(model), model).toBe(true);
      expect(api.has(model), model).toBe(true);
    }
    expect([...plan].sort()).toEqual([...CHATGPT_PLAN_MODELS].sort());
  });

  it('give every role one of them, and pass the plan’s own models through', () => {
    for (const model of Object.values(CHATGPT_PLAN_ROLES)) expect(CHATGPT_PLAN_MODELS).toContain(model);
    for (const model of CHATGPT_PLAN_MODELS) expect(planModelFor(model)).toBe(model);
  });

  it('map the API’s models by role', () => {
    expect(planModelFor('gpt-5.4')).toBe(CHATGPT_PLAN_ROLES.everyday);
    expect(planModelFor('gpt-5.4-mini')).toBe(CHATGPT_PLAN_ROLES.fast);
    expect(planModelFor('gpt-5.4-nano')).toBe(CHATGPT_PLAN_ROLES.fast);
    expect(planModelFor('gpt-5.5')).toBe(CHATGPT_PLAN_ROLES.best);
    expect(planRoleOf('gpt-5.5-pro')).toBe('best');
    expect(planRoleOf('gpt-4.1-nano')).toBe('fast');
    expect(planRoleOf('o3')).toBe('everyday');
  });

  it('cover every OpenAI pick in the built-in profiles', () => {
    const picks = BUILTIN_PROFILES.flatMap((p) => Object.values(p.modules).flatMap((m) => m.chain));
    for (const pick of picks.filter((c) => c.provider === 'openai')) {
      expect(CHATGPT_PLAN_MODELS, pick.model).toContain(planModelFor(pick.model));
    }
  });
});

describe('the plan’s thinking levels', () => {
  it('lists a level pi-ai sends under another level’s name once, under its own', () => {
    // pi-ai's ChatGPT catalogue takes minimal for GPT-6 Luna and sends it as low.
    expect(runtime.findModel('openai-codex', 'gpt-6-luna')?.thinking).toEqual([
      'off',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });

  it('sends ChatGPT’s lightest level, low, when a pick asks for none on the plan', async () => {
    const run = await harness(PLAN);
    const target = { provider: 'openai', model: 'gpt-6-luna', reasoning: 'off' } as const;
    const result = await run.client.complete({ module: 'agent', target, messages: PROMPT });
    expect(result.ok && result.value.reasoning).toBe('low');
    // pi-ai 1.4.0 sends a GPT-6 effort as a configuration_update item (on ChatGPT's own URL, as the request's).
    const input = run.server.requests[0]?.body.input as { type?: string; reasoning?: { effort?: string } }[];
    expect(input.find((item) => item.type === 'configuration_update')?.reasoning?.effort).toBe('low');
  });
});

describe('a call on the ChatGPT sign-in', () => {
  it('sends the role’s plan model and logs that model', async () => {
    const run = await harness(PLAN);
    const target = { provider: 'openai', model: 'gpt-5.4' };
    const result = await run.client.complete({ module: 'agent', target, messages: PROMPT });
    expect(result.ok && result.value).toMatchObject({ provider: 'openai', model: 'gpt-6.1-sol' });
    expect(run.server.requests[0]?.body).toMatchObject({ model: 'gpt-6.1-sol' });
    expect(run.callLog.records.map((r) => r.model)).toEqual(['gpt-6.1-sol']);
  });

  it('leaves an API key’s model alone', async () => {
    const run = await harness(TEST_CREDENTIALS.openai!);
    const target = { provider: 'openai', model: 'gpt-5.4' };
    const result = await run.client.complete({ module: 'agent', target, messages: PROMPT });
    expect(result.ok && result.value.model).toBe('gpt-5.4');
    expect(run.server.requests[0]?.body).toMatchObject({ model: 'gpt-5.4' });
  });

  it('tries the plan’s default once when ChatGPT turns the mapped model down, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const run = await harness(PLAN);
    run.server.script('openai', NOT_ON_PLAN);
    const target = { provider: 'openai', model: 'gpt-5.5' };
    const events = await collect(run.client.stream({ module: 'agent', target, messages: PROMPT }));

    const fallback = events.find((e) => e.type === 'fallback');
    expect(fallback?.type === 'fallback' && fallback).toMatchObject({
      from: { provider: 'openai', model: 'gpt-6-astra' },
      to: { provider: 'openai', model: CHATGPT_PLAN_DEFAULT },
      reason: { code: 'models.unknown_model' },
    });
    expect(events.at(-1)).toMatchObject({ type: 'done', result: { model: CHATGPT_PLAN_DEFAULT } });
    expect(run.server.requests.map((r) => (r.body as { model?: string }).model)).toEqual([
      'gpt-6-astra',
      CHATGPT_PLAN_DEFAULT,
    ]);
    expect(run.callLog.records.map((r) => [r.model, r.outcome])).toEqual([
      ['gpt-6-astra', 'error'],
      [CHATGPT_PLAN_DEFAULT, 'ok'],
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("trying the plan's default"));
  });

  it('reports the default’s own refusal as ChatGPT’s, without trying again', async () => {
    const run = await harness(PLAN);
    run.server.script('openai', NOT_ON_PLAN);
    const target = { provider: 'openai', model: CHATGPT_PLAN_DEFAULT };
    const result = await run.client.complete({ module: 'agent', target, messages: PROMPT });
    expect(!result.ok && result.error).toMatchObject({
      code: 'models.unknown_model',
      params: { provider: 'openai', model: CHATGPT_PLAN_DEFAULT, via: 'chatgpt' },
    });
    expect(run.server.requests).toHaveLength(1);
  });
});
