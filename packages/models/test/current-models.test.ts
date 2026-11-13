// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX3-AGT: pi-ai 1.4.0 is the source of truth, and Taalcut offers each provider's latest generation only, one
 * model per role. An older choice saved in Settings moves to its role's current model when the profiles load,
 * Settings says so for that session, and until then a call runs the current model in its place.
 */
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PROFILES,
  createCatalog,
  createMemoryProfileStore,
  createModelProfiles,
  createModelRuntime,
  CURRENT_MODELS,
  currentModels,
  defaultProfileState,
  isRetired,
  replacementFor,
  roleOf,
  SUPERSEDED_ON,
  type ModelChoice,
} from '@taalcut/models';

const runtime = createModelRuntime();
const AFTER = '2026-10-27';
const OLD_AGENT: ModelChoice = { provider: 'openai', model: 'gpt-5.4', reasoning: 'medium' };

describe('the current models', () => {
  it('are all in pi-ai’s catalogue for their provider, as chat models', () => {
    for (const provider of Object.keys(CURRENT_MODELS)) {
      for (const model of currentModels(provider)) {
        expect(runtime.findModel(provider, model, 'chat'), `${provider}/${model}`).toBeDefined();
      }
    }
  });

  it('name each model’s role from the provider’s own naming', () => {
    expect(roleOf('gpt-6-luna')).toBe('fast');
    expect(roleOf('gpt-5.4-nano')).toBe('fast');
    expect(roleOf('claude-haiku-5-5')).toBe('fast');
    expect(roleOf('gemini-3.5-flash-lite')).toBe('fast');
    expect(roleOf('gemini-3.8-flash')).toBe('everyday');
    expect(roleOf('claude-sonnet-5')).toBe('everyday');
    expect(roleOf('gemini-3.1-pro-preview')).toBe('best');
    expect(roleOf('gpt-5.5')).toBe('best');
    expect(roleOf('claude-fable-5')).toBe('frontier');
  });

  it('replace an older generation by its role, at the same provider and maker', () => {
    expect(replacementFor({ provider: 'openai', model: 'gpt-5.4' })).toEqual({
      provider: 'openai',
      model: 'gpt-6.1-sol',
    });
    expect(replacementFor({ provider: 'openai', model: 'gpt-5.4-mini' })?.model).toBe('gpt-6-luna');
    expect(replacementFor({ provider: 'openai', model: 'gpt-5.5' })?.model).toBe('gpt-6-astra');
    expect(replacementFor({ provider: 'anthropic', model: 'claude-sonnet-5' })?.model).toBe(
      'claude-sonnet-5-5',
    );
    expect(replacementFor({ provider: 'google', model: 'gemini-3.1-pro-preview' })?.model).toBe(
      'gemini-4-argon',
    );
    expect(replacementFor({ provider: 'google', model: 'gemini-3.6-flash' })?.model).toBe('gemini-3.8-flash');
    expect(replacementFor({ provider: 'github-copilot', model: 'claude-sonnet-5' })?.model).toBe(
      'claude-sonnet-5.5',
    );
    // pi-ai 1.4.0 dropped these: a saved choice of one still has somewhere to go.
    expect(replacementFor({ provider: 'openai', model: 'gpt-5.3-chat-latest' })?.model).toBe('gpt-6.1-sol');
    expect(replacementFor({ provider: 'github-copilot', model: 'gpt-5.5' })?.model).toBe('gpt-6-astra');
  });

  it('leave current models, unlisted providers and unlisted makers alone', () => {
    expect(replacementFor({ provider: 'openai', model: 'gpt-6.1-sol' })).toBeUndefined();
    expect(replacementFor({ provider: 'openrouter', model: 'openai/gpt-5.4' })).toBeUndefined();
    expect(replacementFor({ provider: 'github-copilot', model: 'kimi-k3' })).toBeUndefined();
  });

  it('are what the catalogue retires the rest in favour of, from pi-ai 1.4.0’s release', () => {
    const entry = createCatalog().find(OLD_AGENT);
    expect(entry).toMatchObject({ retiresOn: SUPERSEDED_ON, replacement: { model: 'gpt-6.1-sol' } });
    expect(isRetired(entry, '2026-10-20')).toBe(false);
    expect(isRetired(entry, SUPERSEDED_ON)).toBe(true);
    expect(createCatalog().find({ provider: 'openai', model: 'gpt-6.1-sol' })).toBeUndefined();
  });
});

describe('a saved choice of a superseded model', () => {
  async function saved(choice: ModelChoice) {
    const store = createMemoryProfileStore();
    const state = defaultProfileState();
    await store.save({ ...state, overrides: { agent: { primary: choice } } });
    return store;
  }

  it('never fails a run: until the choice moves, a call runs the current model in its place', async () => {
    const profiles = createModelProfiles({ store: createMemoryProfileStore(), today: () => AFTER });
    const everyday = BUILTIN_PROFILES.find((p) => p.id === 'balanced')!;
    const mine = { ...everyday, id: 'mine', modules: { ...everyday.modules, agent: { chain: [OLD_AGENT] } } };
    expect((await profiles.saveCustomProfile(mine)).ok).toBe(true);
    expect((await profiles.setActiveProfile('mine')).ok).toBe(true);

    const current = { provider: 'openai', model: 'gpt-6.1-sol', reasoning: 'medium' };
    const chain = profiles.resolve('agent');
    expect(chain.ok && chain.value.choices).toEqual([current]);
    expect(profiles.effective('agent').skipped).toEqual([
      { choice: OLD_AGENT, reason: 'retired', replacedBy: current },
    ]);
  });

  it('moves to its replacement when the profiles load, saved, and says so once for the session', async () => {
    const store = await saved(OLD_AGENT);
    const profiles = createModelProfiles({ store, today: () => AFTER });
    expect(await profiles.load()).toEqual({ ok: true, value: 'loaded' });

    const moved = { provider: 'openai', model: 'gpt-6.1-sol', reasoning: 'medium' };
    expect(profiles.state().overrides.agent?.primary).toEqual(moved);
    const stored = await store.load();
    expect(stored.ok && stored.value).toMatchObject({ overrides: { agent: { primary: moved } } });
    expect(profiles.state().migrations).toEqual([
      { on: AFTER, module: 'agent', where: 'override', from: OLD_AGENT, to: moved, retiresOn: SUPERSEDED_ON },
    ]);
    expect(profiles.retirements()).toEqual([
      {
        module: 'agent',
        where: 'override',
        choice: OLD_AGENT,
        retiresOn: SUPERSEDED_ON,
        daysLeft: -6,
        replacement: moved,
      },
    ]);

    // The next start finds nothing left to move, so it says nothing.
    const next = createModelProfiles({ store, today: () => AFTER });
    await next.load();
    expect(next.retirements()).toEqual([]);
  });
});
