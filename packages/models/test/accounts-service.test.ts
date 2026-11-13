// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The accounts service behind Settings → Accounts, over the AuthBroker:
 * ChatGPT sign-in, warning-gated sign-ins with the acknowledgement time,
 * write-only API keys with a separate test, and bring-your-own servers. No
 * reply, state or stream ever carries a key or token.
 */
import { CHATGPT_IMAGE_PROVIDER, err, isExternalLink, ok, type AccountsState } from '@taalcut/core';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ApiKeyInvalid,
  createAccountsService,
  createMemoryAcknowledgementStore,
  createModelRuntime,
  disableNetwork,
  signInOption,
  type AccountsService,
  type ApiKeyTester,
  type LocalServerStore,
  type LocalServerUrls,
  type NetworkGuard,
  SIGN_IN_OPTIONS,
} from '@taalcut/models';
import { createAccountsHarness, type AccountsHarness } from './support/accounts';

const KEY = 'sk-ant-accounts-test-0123456789abcdef';

let h: AccountsHarness | undefined;
let service: AccountsService | undefined;
let guard: NetworkGuard | undefined;
const servers: Server[] = [];

afterEach(async () => {
  guard?.restore();
  guard = undefined;
  service?.dispose();
  await h?.close();
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

async function setup(options: { tester?: ApiKeyTester; store?: LocalServerStore; opened?: string[] } = {}) {
  const acknowledgements = createMemoryAcknowledgementStore();
  h = await createAccountsHarness({
    acknowledgements,
    ...(options.opened ? { openExternal: (url: string) => void options.opened!.push(url) } : {}),
  });
  const localRuntime = createModelRuntime({ builtinProviders: [] });
  service = createAccountsService({
    broker: h.broker,
    runtime: h.mainRuntime,
    acknowledgements,
    testApiKey: options.tester ?? (async () => ok(undefined)),
    localServers: { runtimes: [localRuntime], ...(options.store ? { store: options.store } : {}) },
    now: () => 1_760_000_000_000,
  });
  return { h, service, acknowledgements, localRuntime };
}
const value = <T>(result: { ok: true; value: T } | { ok: false }) => {
  if (!result.ok) throw new Error('expected ok');
  return result.value;
};

describe('accounts service', () => {
  it("links only plan pages a window may open (core's external-link hosts)", () => {
    for (const option of SIGN_IN_OPTIONS)
      if (option.manageUsageUrl) expect(isExternalLink(option.manageUsageUrl), option.provider).toBe(true);
  });

  it('starts with nothing connected and the warning cards named', async () => {
    const { service } = await setup();
    expect(value(await service.state())).toEqual({
      chatgpt: {
        signedIn: false,
        imagesSignedIn: false,
        manageUsageUrl: 'https://chatgpt.com/settings/usage',
      },
      subscriptions: [
        {
          provider: 'anthropic',
          signedIn: false,
          warning: expect.objectContaining({ feature: 'signin.claude' }),
          usageUrl: 'https://claude.ai/settings/usage',
        },
        {
          provider: 'github-copilot',
          signedIn: false,
          warning: expect.objectContaining({ feature: 'signin.copilot' }),
          usageUrl: 'https://github.com/settings/copilot',
        },
        // Grok's plan has no usage page on a host Taalcut opens.
        { provider: 'xai', signedIn: false, warning: expect.objectContaining({ feature: 'signin.grok' }) },
      ],
      apiKeys: [
        { provider: 'anthropic', configured: false },
        { provider: 'openai', configured: false },
      ],
      localServers: [{ kind: 'ollama' }, { kind: 'lm-studio' }],
      // Listed apart from model keys; none is settable until this build's stock search gives its key check.
      stockKeys: [
        { provider: 'pexels', configured: false, available: false },
        { provider: 'freesound', configured: false, available: false },
      ],
    } satisfies AccountsState);
  });

  it('signs in with ChatGPT and out again, streaming each change', async () => {
    const { service } = await setup();
    const seen: AccountsState[] = [];
    const stop = new AbortController();
    const reading = (async () => {
      for await (const state of service.changed(stop.signal)) seen.push(state);
    })();
    expect(value(await service.signIn({ provider: 'openai-codex' })).chatgpt.signedIn).toBe(true);
    expect(value(await service.signOut({ provider: 'openai-codex' })).chatgpt.signedIn).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop.abort();
    await reading;
    expect(seen[0]?.chatgpt.signedIn).toBe(false);
    expect(seen.some((s) => s.chatgpt.signedIn)).toBe(true);
    expect(seen.at(-1)?.chatgpt.signedIn).toBe(false);
    expect(JSON.stringify(seen)).not.toMatch(/access|refresh|eyJ/);
  });

  it('reports image sign-in separately and signs it out without disconnecting ChatGPT chat', async () => {
    const { h, service } = await setup();
    await service.signIn({ provider: 'openai-codex' });
    expect(value(await service.state()).chatgpt).toMatchObject({ signedIn: true, imagesSignedIn: false });
    await h.secrets.set(
      `models.credential.${CHATGPT_IMAGE_PROVIDER}`,
      JSON.stringify({
        type: 'oauth',
        access: 'image-account-access-fixture',
        refresh: 'image-account-refresh-fixture',
        accountId: 'image-account',
        expires: Date.now() + 3_600_000,
      }),
    );
    const connected = value(await service.state());
    expect(connected.chatgpt).toMatchObject({ signedIn: true, imagesSignedIn: true });
    expect(JSON.stringify(connected)).not.toContain('image-account-');
    const disconnected = value(await service.signOut({ provider: CHATGPT_IMAGE_PROVIDER }));
    expect(disconnected.chatgpt).toMatchObject({ signedIn: true, imagesSignedIn: false });
  });

  it('needs the warning card for Claude, then records when it was acknowledged and starts the sign-in', async () => {
    const opened: string[] = [];
    const { service, acknowledgements, h } = await setup({ opened });
    expect(await service.signIn({ provider: 'anthropic' })).toMatchObject({
      ok: false,
      error: { code: 'models.acknowledgement_required' },
    });

    guard = disableNetwork();
    const signingIn = service.signIn({ provider: 'anthropic', acknowledgedAt: 1_759_999_000_000 });
    while (opened.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(new URL(opened[0]!).hostname).toBe('claude.ai');
    h.broker.cancelSignIn('anthropic');
    expect(await signingIn).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    expect(acknowledgements.records).toEqual([
      {
        feature: 'signin.claude',
        termsVersion: signInOption('anthropic')!.warning!.termsVersion,
        at: 1_759_999_000_000,
      },
    ]);
    expect(value(await service.state()).subscriptions[0]).toMatchObject({
      provider: 'anthropic',
      signedIn: false,
      acknowledgedAt: 1_759_999_000_000,
    });
  });

  it('stores an API key write-only, tests it on request, and removes it without touching a plan sign-in', async () => {
    let accept = true;
    const tested: string[] = [];
    const { service, h } = await setup({
      tester: async (provider, key) => {
        tested.push(`${provider}:${key === KEY}`);
        return accept ? ok(undefined) : err(ApiKeyInvalid({ provider }));
      },
    });
    expect(await service.testApiKey({ provider: 'anthropic' })).toMatchObject({
      ok: false,
      error: { code: 'models.not_configured' },
    });
    const stored = value(await service.setApiKey({ provider: 'anthropic', key: KEY }));
    expect(stored.apiKeys).toContainEqual({ provider: 'anthropic', configured: true });
    expect(JSON.stringify(stored)).not.toContain(KEY);
    expect(tested).toEqual([]);

    expect(await service.testApiKey({ provider: 'anthropic' })).toEqual(
      ok({ at: 1_760_000_000_000, ok: true }),
    );
    accept = false;
    expect(await service.testApiKey({ provider: 'anthropic' })).toEqual(
      ok({ at: 1_760_000_000_000, ok: false, errorCode: 'models.api_key_invalid' }),
    );
    expect(value(await service.state()).apiKeys).toContainEqual({
      provider: 'anthropic',
      configured: true,
      lastCheck: { at: 1_760_000_000_000, ok: false, errorCode: 'models.api_key_invalid' },
    });
    expect(tested).toEqual(['anthropic:true', 'anthropic:true']);

    // ChatGPT is a sign-in on the openai provider: removing "the OpenAI key" leaves it alone.
    await service.signIn({ provider: 'openai-codex' });
    expect(value(await service.removeApiKey({ provider: 'openai' })).chatgpt.signedIn).toBe(true);
    const removed = value(await service.removeApiKey({ provider: 'anthropic' }));
    expect(removed.apiKeys).toContainEqual({ provider: 'anthropic', configured: false });
    expect((await h.broker.status('anthropic')).ok).toBe(true);
    expect(JSON.stringify(h.secrets.entries)).not.toContain(KEY);
  });

  it('adds a bring-your-own server, tests it, and registers its models; off again with null', async () => {
    const ollama = await startOllama(['qwen3:0.6b', 'qwen3-vl:2b']);
    const saved: LocalServerUrls[] = [];
    const { service, localRuntime } = await setup({
      store: { load: async () => ok({}), save: async (urls) => ok(void saved.push(urls)) },
    });
    const set = value(await service.setLocalServer({ kind: 'ollama', baseUrl: ollama }));
    expect(set.localServers).toEqual([{ kind: 'ollama', baseUrl: ollama }, { kind: 'lm-studio' }]);
    expect(saved).toEqual([{ ollama }]);
    expect(localRuntime.listEndpoints()).toMatchObject([{ id: 'ollama', baseUrl: `${ollama}/v1` }]);

    expect(await service.testLocalServer({ kind: 'ollama' })).toEqual(
      ok({ at: 1_760_000_000_000, ok: true, models: 2 }),
    );
    expect(localRuntime.findModel('ollama', 'qwen3-vl:2b')).toMatchObject({ input: ['text', 'image'] });
    expect(await service.testLocalServer({ kind: 'lm-studio' })).toMatchObject({
      ok: false,
      error: { code: 'models.not_configured' },
    });

    const off = value(await service.setLocalServer({ kind: 'ollama', baseUrl: null }));
    expect(off.localServers).toEqual([{ kind: 'ollama' }, { kind: 'lm-studio' }]);
    expect(localRuntime.listEndpoints()).toEqual([]);
    expect(await service.setLocalServer({ kind: 'lm-studio', baseUrl: 'ftp://x' })).toMatchObject({
      ok: false,
      error: { code: 'models.endpoint_invalid' },
    });
  });

  it('refuses a server address with a password in it, and drops one saved before the check', async () => {
    const withPassword = 'http://ada:pa55-w0rd@127.0.0.1:11434';
    const saved: LocalServerUrls[] = [];
    const { service, localRuntime } = await setup({
      store: {
        load: async () => ok({ ollama: withPassword, 'lm-studio': 'http://127.0.0.1:1234' }),
        save: async (urls) => ok(void saved.push(urls)),
      },
    });
    expect(await service.load()).toEqual(ok(undefined));
    // Settings lose the password; the accounts rows and the runtime never see it.
    expect(saved).toEqual([{ 'lm-studio': 'http://127.0.0.1:1234' }]);
    expect(JSON.stringify(value(await service.state()))).not.toContain('pa55-w0rd');
    expect(localRuntime.listEndpoints().map((e) => e.id)).toEqual(['lm-studio']);

    for (const baseUrl of [withPassword, 'http://token@127.0.0.1:11434']) {
      expect(await service.setLocalServer({ kind: 'ollama', baseUrl })).toEqual(
        err(
          expect.objectContaining({ code: 'models.endpoint_has_credentials', params: { field: 'baseUrl' } }),
        ),
      );
    }
    expect(saved).toHaveLength(1);
  });

  it('registers the saved servers at start-up', async () => {
    const { service, localRuntime } = await setup({
      store: {
        load: async () => ok({ 'lm-studio': 'http://127.0.0.1:1234' }),
        save: async () => ok(undefined),
      },
    });
    expect(await service.load()).toEqual(ok(undefined));
    expect(localRuntime.listEndpoints()).toMatchObject([
      { id: 'lm-studio', name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', acceptUnlisted: true },
    ]);
  });
});

/** A tiny Ollama: /api/tags with capabilities, as Ollama 0.12+ answers. */
async function startOllama(models: readonly string[]): Promise<string> {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        models: models.map((model) => ({
          model,
          capabilities: model.includes('-vl') ? ['completion', 'vision'] : ['completion', 'thinking'],
        })),
      }),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
