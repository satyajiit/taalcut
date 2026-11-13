// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Gate criterion 4: the same chat runs on Continue with ChatGPT and on an
 * API-key provider, switched live in Settings with no restart. Settings
 * changes go through core's real command bus (with undo), the accounts
 * service signs in and stores the key, and one ModelClient (whose selector is
 * the live profiles) carries the conversation across the switch.
 */
import {
  createCommandBus,
  createMemoryAuditLogStore,
  ok,
  systemClock,
  type CommandBus,
  type ModelSettings,
} from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createAccountsService,
  createMemoryCloudCallSink,
  createMemoryProfileStore,
  createModelClient,
  createModelProfiles,
  createModelSettingsService,
  type AccountsService,
  type ChatMessage,
  type ModelClient,
  type ModelProfiles,
  type ModelSettingsService,
  type MemoryCloudCallSink,
} from '@taalcut/models';
import { createAccountsHarness, type AccountsHarness } from './support/accounts';

const ANTHROPIC_KEY = 'sk-ant-settings-test-0123456789abcdef';
const USER = { source: 'ui', actor: 'user' } as const;

let h: AccountsHarness;
let profiles: ModelProfiles;
let settings: ModelSettingsService;
let accounts: AccountsService;
let bus: CommandBus;
let audit: ReturnType<typeof createMemoryAuditLogStore>;
let client: ModelClient;
let callLog: MemoryCloudCallSink;

beforeEach(async () => {
  h = await createAccountsHarness();
  // Like the real APIs: OpenAI takes only live ChatGPT access tokens, Anthropic only the stored key.
  h.provider.setAuthCheck((headers) =>
    headers['x-api-key'] !== undefined
      ? headers['x-api-key'] === ANTHROPIC_KEY
      : h.oauth.isValidAccess(headers.authorization?.replace(/^Bearer /, '') ?? undefined),
  );
  profiles = createModelProfiles({ store: createMemoryProfileStore() });
  settings = createModelSettingsService({ profiles, runtime: h.agentRuntime });
  accounts = createAccountsService({
    broker: h.broker,
    runtime: h.mainRuntime,
    testApiKey: async () => ok(undefined),
  });
  audit = createMemoryAuditLogStore();
  bus = createCommandBus({ store: audit, clock: systemClock });
  bus.register(...settings.commands);
  callLog = createMemoryCloudCallSink();
  // The agent's one client for the whole session: its selector reads the profiles on every call.
  client = createModelClient({
    runtime: h.agentRuntime,
    credentials: h.cache,
    callLog,
    selector: profiles,
    retry: { maxRetries: 0 },
  });
});

afterEach(async () => {
  settings.dispose();
  accounts.dispose();
  await h.close();
});

/** Reads `changed` in the background, keeping every value. */
function follow(stream: AsyncGenerator<ModelSettings>) {
  const seen: ModelSettings[] = [];
  const done = (async () => {
    for await (const value of stream) seen.push(value);
  })();
  return { seen, done };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('switching models live in Settings (gate criterion 4)', () => {
  it('moves one conversation from Continue with ChatGPT to an API-key provider and back, no restart', async () => {
    const watcher = new AbortController();
    const followed = follow(settings.changed(watcher.signal));

    expect(await accounts.signIn({ provider: 'openai-codex' })).toMatchObject({
      ok: true,
      value: { chatgpt: { signedIn: true } },
    });
    const conversation: ChatMessage[] = [{ role: 'user', content: 'Plan a 30 s edit of the beach clips.' }];
    const first = await client.complete({ module: 'agent', messages: conversation });
    if (!first.ok) throw new Error(`${first.error.code}: ${first.error.detail}`);
    // On the plan, Everyday's agent runs the plan's everyday model (chatgpt-plan-models.ts).
    expect(first.value).toMatchObject({ provider: 'openai', model: 'gpt-6.1-sol' });
    expect(h.provider.requests.at(-1)).toMatchObject({ route: 'openai' });

    const keyed = await accounts.setApiKey({ provider: 'anthropic', key: ANTHROPIC_KEY });
    expect(keyed.ok && keyed.value.apiKeys.find((k) => k.provider === 'anthropic')).toEqual({
      provider: 'anthropic',
      configured: true,
    });

    const switched = await bus.dispatch(
      'models.setModuleOverride',
      { module: 'agent', override: { primary: { provider: 'anthropic', model: 'claude-sonnet-5-5' } } },
      USER,
    );
    expect(switched.ok).toBe(true);
    await tick();
    const agent = followed.seen.at(-1)?.modules[0];
    expect(agent?.chain[0]).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
    expect(agent?.override).toEqual({ primary: { provider: 'anthropic', model: 'claude-sonnet-5-5' } });

    // The very next call of the same conversation goes to Anthropic with the stored key.
    conversation.push(first.value.message, { role: 'user', content: 'Make it 15 s.' });
    const second = await client.complete({ module: 'agent', messages: conversation });
    if (!second.ok) throw new Error(`${second.error.code}: ${second.error.detail}`);
    expect(second.value).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5' });
    const sent = h.provider.requests.at(-1);
    expect(sent).toMatchObject({ route: 'anthropic', headers: { 'x-api-key': ANTHROPIC_KEY } });
    expect(JSON.stringify(sent?.body.messages)).toContain('Plan a 30 s edit');

    // Undo in Settings puts ChatGPT back for the call after.
    expect(await bus.undo(null, USER)).toMatchObject({ ok: true });
    conversation.push(second.value.message, { role: 'user', content: 'Thanks.' });
    const third = await client.complete({ module: 'agent', messages: conversation });
    expect(third).toMatchObject({ ok: true, value: { provider: 'openai' } });
    expect(callLog.records.map((r) => r.provider)).toEqual(['openai', 'anthropic', 'openai']);

    watcher.abort();
    await followed.done;
    // Neither the settings, the accounts state nor the audit log ever held the key.
    const everything = JSON.stringify([followed.seen, await accounts.state(), audit.entries()]);
    expect(everything).not.toContain(ANTHROPIC_KEY);
  });
});

describe('model settings service', () => {
  it('reports every module as the next call will run it, in module order', () => {
    const current = settings.settings();
    expect(current).toMatchObject({
      activeProfileId: 'balanced',
      recommendedProfileId: 'balanced',
      tier: 'minimum',
      retirements: [],
    });
    expect(current.profiles.map((p) => [p.id, p.builtin])).toEqual([
      ['fast-cheap', true],
      ['balanced', true],
      ['best-quality', true],
      ['local-only', true],
    ]);
    expect(current.modules.map((m) => [m.module, m.reasoning])).toEqual([
      ['agent', true],
      ['router', true],
      ['vision', true],
      ['embeddings', false],
      ['speech', false],
      ['voice', false],
      ['music', false],
      ['images', false],
    ]);
    // An 8 GB Mac: the on-device vision models (the 9B for High Macs since MLX1, then the 4B) are skipped, with the
    // reason.
    expect(current.modules[2]?.skipped).toEqual([
      {
        choice: { provider: 'on-device', model: 'qwen3.5-9b', reasoning: 'off' },
        reason: 'needs-higher-tier',
      },
      {
        choice: { provider: 'on-device', model: 'qwen3.5-4b', reasoning: 'off' },
        reason: 'needs-higher-tier',
      },
    ]);
  });

  it('"Use recommended" picks the tier\'s profile and clears overrides; undo and redo restore both', async () => {
    settings.setHardware({
      tier: 'high',
      defaultProfileId: 'best-quality',
      compute: { backends: ['metal', 'cpu'], gpuMemoryBytes: 0, neuralEngine: true },
    });
    await bus.dispatch('models.setProfile', { profileId: 'fast-cheap' }, USER);
    await bus.dispatch(
      'models.setModuleOverride',
      { module: 'vision', override: { reasoning: 'high' } },
      USER,
    );
    const before = profiles.state();

    expect(await bus.dispatch('models.useRecommended', {}, USER)).toMatchObject({ ok: true });
    expect(profiles.state()).toMatchObject({ activeProfileId: 'best-quality', overrides: {} });

    await bus.undo(null, USER);
    expect(profiles.state()).toMatchObject({
      activeProfileId: before.activeProfileId,
      overrides: before.overrides,
    });
    await bus.redo(null, USER);
    expect(profiles.state()).toMatchObject({ activeProfileId: 'best-quality', overrides: {} });
    // models.restore is only undo's and redo's: a person can't run it directly.
    expect(
      await bus.dispatch('models.restore', { activeProfileId: 'fast-cheap', overrides: {} }, USER),
    ).toMatchObject({ ok: false, error: { code: 'core.internal_command' } });
    expect(profiles.state().activeProfileId).toBe('best-quality');
  });

  it('turns a bad change into an error value and changes nothing', async () => {
    expect(await bus.dispatch('models.setProfile', { profileId: 'no-such' }, USER)).toMatchObject({
      ok: false,
      error: { code: 'models.profile_not_found' },
    });
    expect(
      await bus.dispatch('models.setModuleOverride', { module: 'agent', override: {} }, USER),
    ).toMatchObject({ ok: false });
    expect(profiles.state().activeProfileId).toBe('balanced');
  });
});
