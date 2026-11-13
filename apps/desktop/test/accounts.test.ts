// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings → Accounts in main: models' accounts service over a fake
 * AuthBroker, with the library's acknowledgements and settings, served as
 * appContract.accounts. The state never carries a key; every credential or
 * local-server change tells the agent to forget its copy; a warned sign-in
 * stores its acknowledgement; device codes stream to windows.
 */
import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  accountsContract,
  connectRpc,
  createMemorySettingsStore,
  err,
  ok,
  serveRpc,
  type AcknowledgementRecord,
  type AcknowledgementStore,
} from '@taalcut/core';
import { ApiKeyInvalid, createModelRuntime, type AccountStatus, type AuthBroker } from '@taalcut/models';
import { LOCAL_SERVERS_SETTING } from '../src/shared/account-settings';
import { createMainAccounts, modelsAcknowledgements } from '../src/main/composition/accounts';
import { accountsRouter } from '../src/main/composition/main-routers';

const KEY = 'sk-test-1234567890abcdef';

function fakeBroker() {
  const stored = new Map<string, NonNullable<AccountStatus['method']>>();
  const listeners = new Set<(provider: string) => void>();
  const changed = (provider: string) => listeners.forEach((listener) => listener(provider));
  const status = (provider: string): AccountStatus => {
    const method = stored.get(provider);
    return { provider, signedIn: method !== undefined, ...(method ? { method } : {}), planLabelKey: 'k' };
  };
  const broker: Partial<AuthBroker> = {
    status: async (provider) => ok(status(provider)),
    statuses: async () => ok([...stored.keys()].map(status)),
    get: async (provider) =>
      ok(stored.get(provider) === 'api_key' ? { kind: 'api_key', secret: KEY, source: 'test' } : undefined),
    async signIn(provider) {
      stored.set(provider, 'subscription');
      changed(provider);
      return ok(status(provider));
    },
    async setApiKey(provider, key) {
      if (key.includes('bad')) return err(ApiKeyInvalid({ provider }));
      stored.set(provider, 'api_key');
      changed(provider);
      return ok(status(provider));
    },
    async signOut(provider) {
      stored.delete(provider);
      changed(provider);
      return ok(undefined);
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return broker as AuthBroker;
}

function memoryAcknowledgements(): AcknowledgementStore & { records: AcknowledgementRecord[] } {
  const records: AcknowledgementRecord[] = [];
  return {
    records,
    has: async (featureId, termsVersion) =>
      ok(records.some((r) => r.featureId === featureId && r.termsVersion === termsVersion)),
    async record({ featureId, termsVersion, at = 0, context = null }) {
      const record = { featureId, termsVersion, acknowledgedAt: at, context };
      records.push(record);
      return ok(record);
    },
    latest: async (featureId) => ok(records.findLast((r) => r.featureId === featureId) ?? null),
  };
}

const ports: MessageChannel[] = [];
afterEach(() => {
  for (const { port1, port2 } of ports.splice(0)) {
    port1.close();
    port2.close();
  }
});

function setup() {
  const notify = vi.fn();
  const acknowledgements = memoryAcknowledgements();
  const settings = createMemorySettingsStore();
  const accounts = createMainAccounts({
    broker: fakeBroker(),
    runtime: createModelRuntime(),
    settings,
    acknowledgements,
    callLog: { record: async () => ok(undefined) },
    notify,
  });
  const channel = new MessageChannel();
  ports.push(channel);
  serveRpc(accountsRouter(accounts), channel.port1, { context: {} });
  const client = connectRpc(accountsContract, channel.port2, { peer: 'main' }).client;
  return { accounts, client, notify, acknowledgements, settings };
}

describe('accounts', () => {
  it('lists every row with nothing configured, and never returns a key', async () => {
    const { client, notify } = setup();
    const empty = await client.state();
    expect(empty.chatgpt.signedIn).toBe(false);
    expect(empty.subscriptions.map((row) => row.provider)).toEqual(['anthropic', 'github-copilot', 'xai']);
    expect(empty.apiKeys.length).toBeGreaterThan(0);
    expect(empty.apiKeys.every((row) => !row.configured)).toBe(true);
    const state = await client.setApiKey({ provider: 'anthropic', key: KEY });
    expect(state.apiKeys.find((row) => row.provider === 'anthropic')?.configured).toBe(true);
    expect(JSON.stringify(state)).not.toContain(KEY);
    expect(notify).toHaveBeenCalledWith('anthropic');
    await expect(client.setApiKey({ provider: 'openai', key: 'sk-bad-0123456789' })).rejects.toMatchObject({
      data: { code: 'models.api_key_invalid' },
    });
  });

  it("stores a warned login's acknowledgement in the library and shows when it was given", async () => {
    const { client, acknowledgements } = setup();
    const state = await client.signIn({ provider: 'anthropic', acknowledgedAt: 500 });
    expect(acknowledgements.records).toMatchObject([{ featureId: 'signin.claude', acknowledgedAt: 500 }]);
    expect(state.subscriptions[0]).toMatchObject({
      provider: 'anthropic',
      signedIn: true,
      acknowledgedAt: 500,
    });
    // Both ids mean Continue with ChatGPT.
    expect((await client.signIn({ provider: 'openai-codex' })).chatgpt.signedIn).toBe(true);
    expect((await client.signOut({ provider: 'openai' })).chatgpt.signedIn).toBe(false);
  });

  it('keeps local servers in the settings table, tells the agent, and streams the change', async () => {
    const { client, notify, settings } = setup();
    const controller = new AbortController();
    const states = await client.changed(undefined, { signal: controller.signal });
    const next = async () => {
      const read = await states.next();
      if (read.done) throw new Error('the stream ended');
      return read.value;
    };
    expect((await next()).localServers.map((row) => row.kind)).toEqual(['ollama', 'lm-studio']);
    await client.setLocalServer({ kind: 'ollama', baseUrl: 'http://127.0.0.1:11434' });
    expect(await settings.get(LOCAL_SERVERS_SETTING)).toEqual(ok({ ollama: 'http://127.0.0.1:11434' }));
    expect(notify).toHaveBeenCalledWith('ollama');
    expect(notify).toHaveBeenCalledWith('lm-studio');
    expect((await next()).localServers[0]).toMatchObject({
      kind: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
    });
    controller.abort();
  });

  it('streams sign-in progress from the broker to windows', async () => {
    const { accounts, client } = setup();
    const controller = new AbortController();
    const events = await client.signInEvents(undefined, { signal: controller.signal });
    const first = events.next();
    accounts.signInEvents.emit({ type: 'browser_opened', provider: 'anthropic' });
    expect((await first).value).toEqual({ type: 'browser_opened', provider: 'anthropic' });
    controller.abort();
  });

  it('answers when a terms version was acknowledged, and only for that version', async () => {
    const store = memoryAcknowledgements();
    const gate = modelsAcknowledgements(store);
    expect(await gate.acknowledgedAt?.('signin.claude', '1')).toEqual(ok(undefined));
    await gate.record('signin.claude', '1', 700);
    expect(await gate.has('signin.claude', '1')).toEqual(ok(true));
    expect(await gate.acknowledgedAt?.('signin.claude', '1')).toEqual(ok(700));
    expect(await gate.acknowledgedAt?.('signin.claude', '2')).toEqual(ok(undefined));
  });
});
