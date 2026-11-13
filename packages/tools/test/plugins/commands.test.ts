// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  err,
  PLUGIN_COMMANDS,
  unwrap,
  ValidationError,
} from '@taalcut/core';
import { createPluginCommands } from '@taalcut/tools';
import { describe, expect, it } from 'vitest';
import { agentPluginService } from './fixtures';

function setup() {
  const service = agentPluginService();
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: createManualClock() });
  bus.register(...createPluginCommands(service).all);
  return { service, bus };
}

describe('plugin commands', () => {
  it('refuses AI and MCP attempts to configure, enable, grant access or disconnect', async () => {
    const { service, bus } = setup();
    for (const source of ['agent', 'mcp'] as const) {
      for (const [name, payload] of [
        [PLUGIN_COMMANDS.configure, { pluginId: 'fixture', config: { server: 'https://example.com' } }],
        [PLUGIN_COMMANDS.setEnabled, { pluginId: 'fixture', enabled: true }],
        [PLUGIN_COMMANDS.setAccess, { pluginId: 'fixture', access: ['publishing'] }],
        [PLUGIN_COMMANDS.disconnect, { pluginId: 'fixture' }],
      ] as const) {
        const result = await bus.dispatch(name, payload, { source, actor: 'test' });
        expect(!result.ok && result.error.code).toBe('core.command_source_refused');
      }
    }
    expect(service.configure).not.toHaveBeenCalled();
    expect(service.setEnabled).not.toHaveBeenCalled();
    expect(service.setAccess).not.toHaveBeenCalled();
    expect(service.disconnect).not.toHaveBeenCalled();
  });

  it('applies person changes through the same service used by the AI', async () => {
    const { service, bus } = setup();
    const source = { source: 'ui', actor: 'user' } as const;
    unwrap(await bus.dispatch(PLUGIN_COMMANDS.configure, { pluginId: 'fixture', config: {} }, source));
    unwrap(await bus.dispatch(PLUGIN_COMMANDS.setEnabled, { pluginId: 'fixture', enabled: true }, source));
    unwrap(await bus.dispatch(PLUGIN_COMMANDS.setAccess, { pluginId: 'fixture', access: ['read'] }, source));
    unwrap(await bus.dispatch(PLUGIN_COMMANDS.disconnect, { pluginId: 'fixture' }, source));
    expect(service.configure).toHaveBeenCalledWith({ pluginId: 'fixture', config: {} });
    expect(service.setEnabled).toHaveBeenCalledWith({ pluginId: 'fixture', enabled: true });
    expect(service.setAccess).toHaveBeenCalledWith({ pluginId: 'fixture', access: ['read'] });
    expect(service.disconnect).toHaveBeenCalledWith('fixture');
  });

  it('allows setup requests from an agent and returns a dedicated route without granting access', async () => {
    const { service, bus } = setup();
    const receipt = unwrap(
      await bus.dispatch(
        PLUGIN_COMMANDS.requestSetup,
        { pluginId: 'fixture' },
        { source: 'agent', actor: 'test' },
      ),
    );
    expect(receipt.result).toMatchObject({
      detailsRoute: '/settings/plugins/fixture',
      plugin: { setupRequested: true, enabled: false, grantedAccess: [] },
    });
    expect(service.setEnabled).not.toHaveBeenCalled();
  });

  it('records external operations with a stable command key and refuses read-mode payloads', async () => {
    const { service, bus } = setup();
    const input = { pluginId: 'fixture', toolName: 'publish', input: {}, mode: 'external' };
    const result = unwrap(
      await bus.dispatch(PLUGIN_COMMANDS.call, input, { source: 'agent', actor: 'test' }),
    );
    expect(service.invoke).toHaveBeenCalledWith({ ...input, idempotencyKey: `plugin-command:${result.id}` });
    const refused = await bus.dispatch(
      PLUGIN_COMMANDS.call,
      { ...input, mode: 'read' },
      { source: 'agent', actor: 'test' },
    );
    expect(refused.ok).toBe(false);
    expect(service.invoke).toHaveBeenCalledTimes(1);
  });

  it('preserves service failures as values and retains explicit invocation keys', async () => {
    const { service, bus } = setup();
    const failure = err(ValidationError({ field: 'pluginId' }));
    service.requestSetup.mockResolvedValue(failure);
    expect(
      await bus.dispatch(
        PLUGIN_COMMANDS.requestSetup,
        { pluginId: 'fixture' },
        { source: 'agent', actor: 'test' },
      ),
    ).toEqual(failure);
    unwrap(
      await bus.dispatch(
        PLUGIN_COMMANDS.call,
        {
          pluginId: 'fixture',
          toolName: 'publish',
          input: {},
          mode: 'external',
          idempotencyKey: 'approved-call',
        },
        { source: 'agent', actor: 'test' },
      ),
    );
    expect(service.invoke).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'approved-call' }));
  });
});
