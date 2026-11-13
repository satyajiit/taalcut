// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it, vi } from 'vitest';
import type { OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai';
import { CHATGPT_IMAGE_PROVIDER, ok } from '@taalcut/core';
import { createAuthBroker, createMemorySecretStore, createModelRuntime } from '@taalcut/models';
import { runtimeInternals } from '../src/runtime/runtime';
import { createCodexImagesAuthProvider } from '../src/signin/codex-images';

const IMAGE_GRANT: OAuthCredential = {
  type: 'oauth',
  access: 'image-access-fixture',
  refresh: 'image-refresh-fixture',
  accountId: 'image-account-fixture',
  expires: Date.now() + 3_600_000,
};
const CHAT_GRANT: OAuthCredential = {
  type: 'oauth',
  access: 'siwc-access-fixture',
  refresh: 'siwc-refresh-fixture',
  expires: Date.now() + 3_600_000,
};

async function harness(oauth?: Partial<OAuthAuth>) {
  const secrets = createMemorySecretStore();
  await secrets.set('models.credential.openai', JSON.stringify(CHAT_GRANT));
  const runtime = createModelRuntime({ secrets, builtinProviders: ['openai', CHATGPT_IMAGE_PROVIDER] });
  const upstream: OAuthAuth = {
    name: 'Recorded Codex OAuth',
    isSubscription: true,
    login: vi.fn(async () => IMAGE_GRANT),
    refresh: vi.fn(async () => ({ ...IMAGE_GRANT, access: 'refreshed-image-access-fixture' })),
    toAuth: vi.fn(async (credential) => ({ apiKey: credential.access })),
    ...oauth,
  };
  runtimeInternals(runtime).models.setProvider(createCodexImagesAuthProvider(upstream));
  const broker = createAuthBroker({ runtime, openExternal: vi.fn() });
  return { secrets, runtime, upstream, broker };
}

describe('the separate ChatGPT image connection', () => {
  it('registers without exposing Codex chat models or accepting a local endpoint shadow', () => {
    const runtime = createModelRuntime();
    expect(runtime.hasProvider(CHATGPT_IMAGE_PROVIDER)).toBe(true);
    expect(runtime.listModels(CHATGPT_IMAGE_PROVIDER)).toEqual([]);
    expect(runtime.hasProvider('openai')).toBe(true);
    expect(
      runtime.setEndpoint({
        id: CHATGPT_IMAGE_PROVIDER,
        name: 'Shadow',
        models: [],
        baseUrl: 'http://localhost:1234/v1',
      }).ok,
    ).toBe(false);
  });

  it('stores, refreshes and signs out images independently from SIWC chat', async () => {
    const { secrets, upstream, broker } = await harness();
    expect(await broker.get(CHATGPT_IMAGE_PROVIDER)).toEqual(ok(undefined));
    expect(await broker.signIn(CHATGPT_IMAGE_PROVIDER)).toMatchObject(
      ok({
        provider: CHATGPT_IMAGE_PROVIDER,
        signedIn: true,
        method: 'subscription',
        planLabelKey: 'models.account.chatgptImages.usingPlan',
      }),
    );
    expect(upstream.login).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentName: 'Taalcut' }),
    );
    const resolved = await broker.get(CHATGPT_IMAGE_PROVIDER);
    expect(resolved).toMatchObject(
      ok({
        kind: 'oauth_access',
        secret: IMAGE_GRANT.access,
        headers: { 'chatgpt-account-id': IMAGE_GRANT.accountId },
      }),
    );
    expect(JSON.stringify(resolved)).not.toContain(IMAGE_GRANT.refresh);
    expect(await broker.get('openai')).toMatchObject(ok({ secret: CHAT_GRANT.access }));
    const refreshed = await broker.get(CHATGPT_IMAGE_PROVIDER, { forceRefresh: true });
    expect(refreshed).toMatchObject(ok({ secret: 'refreshed-image-access-fixture' }));
    expect(upstream.refresh).toHaveBeenCalledOnce();
    expect(await secrets.get('models.credential.openai')).toEqual(ok(JSON.stringify(CHAT_GRANT)));
    const statuses = JSON.stringify(await broker.statuses());
    for (const secret of [IMAGE_GRANT.access, IMAGE_GRANT.refresh, CHAT_GRANT.access])
      expect(statuses).not.toContain(secret);
    await broker.signOut(CHATGPT_IMAGE_PROVIDER);
    expect(await broker.get(CHATGPT_IMAGE_PROVIDER)).toEqual(ok(undefined));
    expect(await broker.status('openai')).toMatchObject(ok({ signedIn: true }));
  });

  it.each([undefined, '', 'account\r\ninjected', 'a'.repeat(257)])(
    'rejects missing or invalid account identity %j',
    async (accountId) => {
      const { broker } = await harness({ login: async () => ({ ...IMAGE_GRANT, accountId }) });
      await broker.signIn(CHATGPT_IMAGE_PROVIDER);
      const result = await broker.get(CHATGPT_IMAGE_PROVIDER);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain(IMAGE_GRANT.access);
      expect(JSON.stringify(result)).not.toContain(IMAGE_GRANT.refresh);
    },
  );

  it('cancels a pending image sign-in without writing or changing the chat grant', async () => {
    const entered = Promise.withResolvers<void>();
    const { broker, secrets } = await harness({
      login: async (interaction) => {
        entered.resolve();
        return new Promise((_, reject) =>
          interaction.signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }),
        );
      },
    });
    const pending = broker.signIn(CHATGPT_IMAGE_PROVIDER);
    await entered.promise;
    broker.cancelSignIn(CHATGPT_IMAGE_PROVIDER);
    expect(await pending).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    expect(await secrets.get(`models.credential.${CHATGPT_IMAGE_PROVIDER}`)).toEqual(ok(undefined));
    expect(await secrets.get('models.credential.openai')).toEqual(ok(JSON.stringify(CHAT_GRANT)));
  });
});
