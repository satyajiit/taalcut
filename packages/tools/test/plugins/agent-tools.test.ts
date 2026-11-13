// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ok, PLUGIN_COMMANDS, toolModuleProblems, unwrap } from '@taalcut/core';
import { createToolRegistry, pluginsToolModule } from '@taalcut/tools';
import { describe, expect, it } from 'vitest';
import { agentPluginService, plugin, toolContext } from './fixtures';

function setup() {
  const service = agentPluginService();
  const module = pluginsToolModule(service);
  const registration = createToolRegistry([module]);
  expect(registration.ok ? [] : registration.error.detail).toEqual([]);
  const registry = unwrap(registration);
  return { service, module, registry, tool: (name: string) => registry.resolve(`plugins.${name}`)!.spec };
}

describe('plugin agent tools', () => {
  it('validates the whole module and keeps local discovery available without credentials or activation', async () => {
    const { service, module, registry, tool } = setup();
    expect(toolModuleProblems(module)).toEqual([]);
    expect(registry.catalogue()).toHaveLength(7);
    expect(unwrap(await tool('list').run({}, toolContext()))).toEqual([plugin]);
    expect(unwrap(await tool('describe').run({ pluginId: 'fixture' }, toolContext()))).toEqual(plugin);
    expect(service.setEnabled).not.toHaveBeenCalled();
    expect(service.invoke).not.toHaveBeenCalled();
    expect(tool('list').permission?.network).toBeUndefined();
    expect(tool('readSkill').permission?.network).toBeUndefined();
  });

  it('loads a declared skill and discovers remote tools with cancellation', async () => {
    const { service, tool } = setup();
    const context = toolContext();
    expect(
      unwrap(await tool('readSkill').run({ pluginId: 'fixture', skillId: 'publish' }, context)),
    ).toMatchObject({ content: 'Read before publishing.' });
    expect(service.readSkill).toHaveBeenCalledWith('fixture', 'publish');
    expect(await tool('listTools').run({ pluginId: 'fixture' }, context)).toEqual(ok([]));
    expect(service.tools).toHaveBeenCalledWith('fixture', context.signal);
    expect(tool('listTools').permission?.network).toBe('internet');
  });

  it('forces read mode regardless of extra model input and carries the abort signal', async () => {
    const { service, tool } = setup();
    const context = toolContext();
    await tool('callRead').run(
      { pluginId: 'fixture', toolName: 'posts', input: {}, mode: 'external' },
      context,
    );
    expect(service.invoke).toHaveBeenCalledWith(
      { pluginId: 'fixture', toolName: 'posts', input: {}, mode: 'read' },
      context.signal,
    );
    expect(context.dispatch).not.toHaveBeenCalled();
  });

  it('sends external work through the approved command path with stable keys and no automatic retry', async () => {
    const { service, registry, tool } = setup();
    const spec = tool('callExternal');
    const input = { pluginId: 'fixture', toolName: 'publish', input: { text: 'Ready', account: 'a' } };
    const key = spec.idempotencyKey!(input);
    expect(key).toBe(spec.idempotencyKey!({ ...input, input: { account: 'a', text: 'Ready' } }));
    expect(key).not.toContain('Ready');
    const context = { ...toolContext(), idempotencyKey: key };
    await spec.run(input, context);
    expect(context.dispatch).toHaveBeenCalledWith({ ...input, mode: 'external', idempotencyKey: key });
    expect(service.invoke).not.toHaveBeenCalled();
    expect(spec.command).toBe(PLUGIN_COMMANDS.call);
    expect(registry.describe(spec.name)).toMatchObject({
      requiresApproval: true,
      sideEffect: 'external',
      retry: { maxAttempts: 1 },
      permission: { network: 'internet', uploads: { what: 'user-media', consent: 'first-use' } },
    });
  });

  it('records setup through its command and never grants access', async () => {
    const { service, tool } = setup();
    const context = toolContext();
    const spec = tool('requestSetup');
    await spec.run({ pluginId: 'fixture' }, context);
    expect(spec.command).toBe(PLUGIN_COMMANDS.requestSetup);
    expect(spec.idempotencyKey!({ pluginId: 'fixture' })).toBe('plugin-setup:fixture');
    expect(context.dispatch).toHaveBeenCalledWith({ pluginId: 'fixture' });
    expect(service.setEnabled).not.toHaveBeenCalled();
    expect(service.setAccess).not.toHaveBeenCalled();
    expect(spec.description).toContain('never ask them to paste secrets into chat');
  });
});
