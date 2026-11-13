// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The hub's install key (P3-B12): main makes it once in the keychain vault and serves it to the agent process
 * alone, through the credentials service it already asks; the agent reads it on each hub write. The key is never
 * in a window's contract, a provider list or an error.
 */
import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appContract,
  connectRpc,
  credentialsContract,
  err,
  hubInstallKeySchema,
  ok,
  serveRpc,
  type AsyncResult,
} from '@taalcut/core';
import { createMemorySecretStore, SecretStoreFailed, type SecretStore } from '@taalcut/models';
import { credentialsRouter, mainServicesRouter } from '../src/main/composition/main-routers';
import {
  createHubInstallKey,
  HUB_INSTALL_KEY_SECRET,
  newHubInstallKey,
  withHubInstallKey,
} from '../src/main/hub/hub-install-key';
import { HUB_INSTALL_KEY_PROVIDER, readHubInstallKey } from '../src/shared/hub-install-key';
import { HubInstallKeyToken } from '../src/utility/roots/agent-templates-hub';
import { closeAllPorts, fakeHost, nodeChannel } from './helpers/fake-utility';
import { testAgent, testConfig, testRoots } from './helpers/roots';

const KEY = 'AAAAAAAAAAAAAAAAAAAAAA';

const ports: MessageChannel[] = [];
afterEach(() => {
  closeAllPorts();
  for (const { port1, port2 } of ports.splice(0)) {
    port1.close();
    port2.close();
  }
});

/** main's credentials service for the agent, over a real port. */
function agentCredentials(installKey: () => AsyncResult<string>) {
  const broker = {
    get: vi.fn(async (provider: string) =>
      ok(
        provider === 'anthropic'
          ? { kind: 'api_key' as const, secret: 'sk-ant', source: 'stored' }
          : undefined,
      ),
    ),
    invalidate: vi.fn(),
    statuses: async () =>
      ok([{ provider: 'anthropic', signedIn: true, method: 'api_key' as const, planLabelKey: 'k' }]),
  };
  const channel = new MessageChannel();
  ports.push(channel);
  serveRpc(credentialsRouter(withHubInstallKey(broker, installKey)), channel.port1, { context: {} });
  return { broker, client: connectRpc(credentialsContract, channel.port2, { peer: 'main' }).client };
}

describe('hub install key, main', () => {
  it('makes 128 random bits, base64url, once, and keeps them in the vault', async () => {
    expect(newHubInstallKey()).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(newHubInstallKey()).not.toBe(newHubInstallKey());

    const vault = createMemorySecretStore();
    const mint = vi.fn(() => KEY);
    const installKey = createHubInstallKey(vault, mint);
    // Two hub writes at once on first use share one key.
    const [first, second] = await Promise.all([installKey(), installKey()]);
    expect(first).toEqual(ok(KEY));
    expect(second).toEqual(ok(KEY));
    expect(await installKey()).toEqual(ok(KEY));
    expect(mint).toHaveBeenCalledTimes(1);
    expect(vault.entries.get(HUB_INSTALL_KEY_SECRET)).toBe(KEY);

    // The next launch reads the stored key.
    const relaunched = vi.fn(() => 'never-used-never-used-x');
    expect(await createHubInstallKey(vault, relaunched)()).toEqual(ok(KEY));
    expect(relaunched).not.toHaveBeenCalled();
  });

  it('replaces a stored value that is not a key', async () => {
    const vault = createMemorySecretStore();
    await vault.set(HUB_INSTALL_KEY_SECRET, 'short');
    const fresh = newHubInstallKey();
    expect(await createHubInstallKey(vault, () => fresh)()).toEqual(ok(fresh));
    expect(vault.entries.get(HUB_INSTALL_KEY_SECRET)).toBe(fresh);
  });

  it("answers the vault's error, keeps no failed read and returns no unsaved key", async () => {
    const locked = SecretStoreFailed({ operation: 'get' }, { detail: 'encryption unavailable' });
    const memory = createMemorySecretStore();
    let available = false;
    const vault: Pick<SecretStore, 'get' | 'set'> = {
      get: async (key) => (available ? memory.get(key) : err(locked)),
      set: async (key, value) => memory.set(key, value),
    };
    const installKey = createHubInstallKey(vault, () => KEY);
    expect(await installKey()).toEqual(err(locked));
    available = true;
    expect(await installKey()).toEqual(ok(KEY));

    const unwritable = createHubInstallKey(
      { get: async () => ok(undefined), set: async () => err(SecretStoreFailed({ operation: 'set' })) },
      () => KEY,
    );
    const refused = await unwritable();
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(refused)).not.toContain(KEY);
  });

  it("serves the key as the agent's `taalcut-hub` credential and passes every other provider on", async () => {
    const { broker, client } = agentCredentials(async () => ok(KEY));
    expect(await client.get({ provider: HUB_INSTALL_KEY_PROVIDER })).toEqual({
      kind: 'api_key',
      secret: KEY,
      source: 'keychain',
    });
    expect(await client.get({ provider: 'anthropic' })).toMatchObject({ secret: 'sk-ant' });
    expect(broker.get).toHaveBeenCalledTimes(1);
    await client.invalidate({ provider: HUB_INSTALL_KEY_PROVIDER });
    await client.invalidate({ provider: 'anthropic' });
    expect(broker.invalidate).toHaveBeenCalledWith('anthropic');
    expect(broker.invalidate).toHaveBeenCalledTimes(1);
    // Not a model provider: the picker's list doesn't name it.
    expect(await client.configured()).toEqual(['anthropic']);
  });

  it('is not reachable from a window', () => {
    expect(Object.keys(appContract)).not.toContain('credentials');
  });
});

describe('hub install key, agent', () => {
  it('reads the key from main on each hub write', async () => {
    const installKey = vi.fn(async () => ok(KEY));
    const { client } = agentCredentials(installKey);
    expect(await readHubInstallKey(client)).toEqual(ok(KEY));
    expect(await readHubInstallKey(client)).toEqual(ok(KEY));
    expect(installKey).toHaveBeenCalledTimes(2);
    expect(hubInstallKeySchema.safeParse(KEY).success).toBe(true);
  });

  it("passes main's error on, and names no value when main's answer isn't a key", async () => {
    const failed = SecretStoreFailed({ operation: 'get' }, { detail: 'encryption unavailable' });
    const { client } = agentCredentials(async () => err(failed));
    const refused = await readHubInstallKey(client);
    expect(refused.ok ? null : refused.error.code).toBe(failed.code);

    for (const answer of [null, { kind: 'api_key' as const, secret: 'not a key!', source: 'x' }]) {
      const odd = await readHubInstallKey({ get: async () => answer });
      expect(odd.ok ? null : odd.error.code).toBe('core.unknown');
      expect(JSON.stringify(odd)).not.toContain('not a key');
    }
  });
});

describe('hub install key, agent root', () => {
  it("is registered over main's services, and absent without them (hub writes then core.not_implemented)", async () => {
    const { host } = fakeHost(testRoots);
    const { local, remote } = nodeChannel();
    const broker = {
      get: async () => ok(undefined),
      invalidate: () => undefined,
      statuses: async () => ok([]),
    };
    serveRpc(
      mainServicesRouter('agent', { broker: withHubInstallKey(broker, async () => ok(KEY)), host }),
      local,
      {
        context: { caller: 'agent' },
      },
    );
    const root = testAgent(testConfig('agent'), { main: remote });
    expect(await root.container.resolve(HubInstallKeyToken)()).toEqual(ok(KEY));
    await root.container.dispose();

    const alone = testAgent(testConfig('agent'));
    expect(alone.container.has(HubInstallKeyToken)).toBe(false);
    await alone.container.dispose();
  });
});
