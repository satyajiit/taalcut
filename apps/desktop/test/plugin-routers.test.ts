// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callRpc,
  connectRpc,
  createMemorySettingsStore,
  pluginsSetupContract,
  pluginsContract,
  serveRpc,
  type PluginService,
} from '@taalcut/core';
import { createMemorySecretStore } from '@taalcut/models';
import { createDesktopPlugins } from '../src/main/plugins/plugin-host';
import { pluginsRouter, pluginsSetupRouter } from '../src/main/plugins/plugin-routers';

const channels: MessageChannel[] = [];
const services: PluginService[] = [];
afterEach(async () => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
  await Promise.all(services.splice(0).map((service) => service.dispose()));
});

function setup() {
  const secrets = createMemorySecretStore();
  const service = createDesktopPlugins(secrets, createMemorySettingsStore());
  services.push(service);
  let text = 'test-postiz-key-never-in-a-window';
  const clipboard = {
    readText: vi.fn(() => text),
    clear: vi.fn(() => {
      text = '';
    }),
  };
  const channel = new MessageChannel();
  channels.push(channel);
  serveRpc(pluginsSetupRouter(service, clipboard), channel.port1, { context: {} });
  const client = connectRpc(pluginsSetupContract, channel.port2, { peer: 'main' }).client;
  return {
    secrets,
    service,
    clipboard,
    client,
    replaceClipboard: (value: string) => {
      text = value;
    },
  };
}

describe('main plugin credential boundary', () => {
  it('imports directly into the vault, returns presence only, and clears the original clipboard', async () => {
    const { secrets, service, clipboard, client } = setup();
    const result = await client.importCredential({ pluginId: 'postiz', credentialId: 'api-key' });
    expect(result.configuredCredentials).toContain('api-key');
    expect(JSON.stringify(result)).not.toContain('test-postiz-key-never-in-a-window');
    expect([...secrets.entries.values()]).toContain('test-postiz-key-never-in-a-window');
    expect(clipboard.clear).toHaveBeenCalledOnce();
    const channel = new MessageChannel();
    channels.push(channel);
    serveRpc(pluginsRouter(service), channel.port1, { context: {} });
    const publicClient = connectRpc(pluginsContract, channel.port2, { peer: 'main' }).client;
    expect(JSON.stringify(await publicClient.list())).not.toContain('test-postiz-key-never-in-a-window');
  });

  it('does not touch the clipboard for an unknown plugin', async () => {
    const { client, clipboard } = setup();
    expect(
      (await callRpc(client.importCredential({ pluginId: 'missing', credentialId: 'api-key' }))).ok,
    ).toBe(false);
    expect(clipboard.readText).not.toHaveBeenCalled();
    expect(clipboard.clear).not.toHaveBeenCalled();
  });

  it('keeps clipboard content if the vault rejects the key or the user copied something else', async () => {
    const { client, service, clipboard, replaceClipboard } = setup();
    replaceClipboard('');
    expect((await callRpc(client.importCredential({ pluginId: 'postiz', credentialId: 'api-key' }))).ok).toBe(
      false,
    );
    expect(clipboard.clear).not.toHaveBeenCalled();
    replaceClipboard('another-valid-test-key');
    const original = service.importCredential.bind(service);
    vi.spyOn(service, 'importCredential').mockImplementation(async (...args) => {
      const result = await original(...args);
      replaceClipboard('new clipboard text');
      return result;
    });
    await client.importCredential({ pluginId: 'postiz', credentialId: 'api-key' });
    expect(clipboard.clear).not.toHaveBeenCalled();
  });

  it('registers instagram-edits and imports its access-token credential without exposing the token', async () => {
    const { secrets, service, clipboard, client, replaceClipboard } = setup();
    replaceClipboard('test-edits-bearer-token-secret');
    const result = await client.importCredential({
      pluginId: 'instagram-edits',
      credentialId: 'access-token',
    });
    expect(result.manifest.id).toBe('instagram-edits');
    expect(result.configuredCredentials).toContain('access-token');
    expect(JSON.stringify(result)).not.toContain('test-edits-bearer-token-secret');
    expect([...secrets.entries.values()]).toContain('test-edits-bearer-token-secret');
    expect(clipboard.clear).toHaveBeenCalledOnce();

    const channel = new MessageChannel();
    channels.push(channel);
    serveRpc(pluginsRouter(service), channel.port1, { context: {} });
    const publicClient = connectRpc(pluginsContract, channel.port2, { peer: 'main' }).client;
    const list = await publicClient.list();
    expect(list.map((entry) => entry.manifest.id)).toEqual(
      expect.arrayContaining(['postiz', 'comfyui', 'instagram-edits']),
    );
    expect(JSON.stringify(list)).not.toContain('test-edits-bearer-token-secret');
  });
});
