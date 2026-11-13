// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  createContainer,
  PluginAgentServiceToken,
  unwrap,
  type MainServicesClient,
  type PluginView,
} from '@taalcut/core';
import { LOCAL_ONLY_REFUSAL, localOnlyRefusal } from '@taalcut/agent';
import { createToolRegistry, postizManifest } from '@taalcut/tools';
import { describe, expect, it, vi } from 'vitest';
import { AgentMainServicesToken } from '../src/shared/tokens';
import {
  agentPluginCommands,
  agentPluginTools,
  pluginServiceOverRpc,
  registerAgentPlugins,
} from '../src/utility/roots/agent-plugins';

const view: PluginView = {
  manifest: postizManifest,
  enabled: false,
  status: 'disconnected',
  configuredCredentials: [],
  config: {},
  grantedAccess: [],
  setupRequested: false,
  lastCheckedAt: null,
};

function fakeClient() {
  return {
    list: vi.fn(async () => [view]),
    describe: vi.fn(async () => view),
    tools: vi.fn(async () => []),
    readSkill: vi.fn(async () => ({
      id: 'publish',
      name: 'Publish',
      description: 'Publish.',
      content: 'Read channels first.',
    })),
    configure: vi.fn(async () => view),
    setEnabled: vi.fn(async () => view),
    setAccess: vi.fn(async () => view),
    disconnect: vi.fn(async () => view),
    requestSetup: vi.fn(async () => view),
    testConnection: vi.fn(async () => view),
    invoke: vi.fn(async () => ({ done: true })),
  } satisfies MainServicesClient<'agent'>['plugins'];
}

describe('agent plugin composition', () => {
  it('binds tools and commands to one injected service, without creating a service in isolated tests', async () => {
    const container = createContainer();
    registerAgentPlugins(container);
    expect(container.has(PluginAgentServiceToken)).toBe(false);
    expect(agentPluginTools(container)).toEqual([]);
    expect(agentPluginCommands(container)).toEqual([]);

    const client = fakeClient();
    container.value(
      AgentMainServicesToken,
      () => ({ plugins: client }) as unknown as MainServicesClient<'agent'>,
    );
    registerAgentPlugins(container);
    expect(unwrap(await container.resolve(PluginAgentServiceToken).list())).toEqual([view]);
    expect(agentPluginCommands(container)).toHaveLength(6);
    const registry = unwrap(createToolRegistry(agentPluginTools(container)));
    expect(registry.catalogue()).toHaveLength(7);
    for (const name of ['listTools', 'callRead', 'callExternal']) {
      expect(localOnlyRefusal(registry.describe(`plugins.${name}`)!.permission, undefined)).toBe(
        LOCAL_ONLY_REFUSAL,
      );
    }
    for (const name of ['list', 'describe', 'readSkill', 'requestSetup']) {
      expect(localOnlyRefusal(registry.describe(`plugins.${name}`)!.permission, undefined)).toBeUndefined();
    }
    await container.dispose();
  });

  it('forwards only non-secret service calls and carries cancellation to network operations', async () => {
    const client = fakeClient();
    const service = pluginServiceOverRpc(() => client);
    const signal = new AbortController().signal;
    unwrap(await service.describe('postiz'));
    unwrap(await service.readSkill('postiz', 'publish'));
    unwrap(
      await service.configure({ pluginId: 'postiz', config: { 'api-url': 'https://example.com/public/v1' } }),
    );
    unwrap(await service.setEnabled({ pluginId: 'postiz', enabled: true }));
    unwrap(await service.setAccess({ pluginId: 'postiz', access: ['posts-read'] }));
    unwrap(await service.disconnect('postiz'));
    unwrap(await service.requestSetup('postiz'));
    unwrap(await service.tools('postiz', signal));
    unwrap(await service.testConnection('postiz', signal));
    const input = { pluginId: 'postiz', toolName: 'api.listPosts', input: {}, mode: 'read' } as const;
    unwrap(await service.invoke(input, signal));
    expect(client.describe).toHaveBeenCalledWith({ pluginId: 'postiz' });
    expect(client.readSkill).toHaveBeenCalledWith({ pluginId: 'postiz', skillId: 'publish' });
    expect(client.configure).toHaveBeenCalledWith({
      pluginId: 'postiz',
      config: { 'api-url': 'https://example.com/public/v1' },
    });
    expect(client.setEnabled).toHaveBeenCalledWith({ pluginId: 'postiz', enabled: true });
    expect(client.setAccess).toHaveBeenCalledWith({ pluginId: 'postiz', access: ['posts-read'] });
    expect(client.disconnect).toHaveBeenCalledWith({ pluginId: 'postiz' });
    expect(client.requestSetup).toHaveBeenCalledWith({ pluginId: 'postiz' });
    expect(client.tools).toHaveBeenCalledWith({ pluginId: 'postiz' }, { signal });
    expect(client.testConnection).toHaveBeenCalledWith({ pluginId: 'postiz' }, { signal });
    expect(client.invoke).toHaveBeenCalledWith(input, { signal });
    expect(service).not.toHaveProperty('importCredential');
  });

  it('turns disconnected RPC failures into errors and looks up the current client on every call', async () => {
    let client = fakeClient();
    client.list.mockRejectedValueOnce(new Error('Disconnected'));
    const service = pluginServiceOverRpc(() => client);
    expect((await service.list()).ok).toBe(false);
    client = fakeClient();
    expect(unwrap(await service.list())).toEqual([view]);
    expect(client.list).toHaveBeenCalledOnce();
    await service.tools('postiz');
    await service.testConnection('postiz');
    await service.invoke({ pluginId: 'postiz', toolName: 'api.listPosts', input: {}, mode: 'read' });
    expect(client.tools).toHaveBeenCalledWith({ pluginId: 'postiz' }, {});
    expect(client.testConnection).toHaveBeenCalledWith({ pluginId: 'postiz' }, {});
    expect(client.invoke).toHaveBeenCalledWith(expect.any(Object), {});
  });
});
