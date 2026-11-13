// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  createMemorySettingsStore,
  ok,
  type AsyncResult,
  type PluginSecrets,
  type PluginTool,
} from '@taalcut/core';
import { z } from 'zod';
import { vi } from 'vitest';
import { createPluginService, type PluginContext, type PluginDefinition } from '../../src/plugins';

export function pluginWorld() {
  const values = new Map<string, string>();
  const secrets: PluginSecrets = {
    get: async (key) => ok(values.get(key)),
    set: async (key, value) => {
      values.set(key, value);
      return ok(undefined);
    },
    delete: async (key) => {
      values.delete(key);
      return ok(undefined);
    },
  };
  const settings = createMemorySettingsStore();
  const contexts = new Map<string, PluginContext>();
  const signals: AbortSignal[] = [];
  const invoked = vi.fn(
    async (_name: string, input: Record<string, unknown>, signal: AbortSignal): AsyncResult<unknown> => {
      signals.push(signal);
      return ok(input);
    },
  );
  const disposed = vi.fn(async (): Promise<void> => undefined);
  const tools: PluginTool[] = [
    {
      name: 'api.list',
      description: 'List records.',
      inputSchema: { type: 'object' },
      access: ['read'],
      sideEffect: 'read',
      source: 'api',
    },
    {
      name: 'api.publish',
      description: 'Publish a record.',
      inputSchema: { type: 'object' },
      access: ['write'],
      sideEffect: 'external',
      source: 'api',
    },
  ];
  const definition = (id: string): PluginDefinition => ({
    manifest: {
      id,
      name: id,
      version: '1.0.0',
      publisher: 'Test',
      summary: 'Testing plugins',
      description: 'An isolated test provider',
      logo: id,
      homepage: 'https://example.com',
      docs: 'https://example.com/docs',
      features: [],
      access: [
        { id: 'read', name: 'Read', description: 'Read records' },
        { id: 'write', name: 'Write', description: 'Write records' },
      ],
      credentials: [{ id: 'key', name: 'Key', description: 'The private key', required: true }],
      configFields: [
        {
          id: 'url',
          name: 'URL',
          description: 'Server URL',
          kind: 'url',
          defaultValue: 'https://example.com',
          required: true,
        },
      ],
      skills: [{ id: 'workflow', name: 'Workflow', description: 'Use the provider' }],
    },
    skills: [
      {
        id: 'workflow',
        name: 'Workflow',
        description: 'Use the provider',
        content: 'Inspect records before publishing.',
      },
    ],
    configSchema: z.object({ url: z.url() }).strict(),
    create: (context) => {
      contexts.set(id, context);
      return { connect: async () => ok(tools), invoke: invoked, dispose: disposed };
    },
  });
  let allowed = true;
  const definitions = [definition('alpha'), definition('beta')];
  const create = () =>
    createPluginService({
      definitions,
      secrets,
      settings,
      networkAllowed: async () => allowed,
      now: () => 1234,
    });
  const service = create();
  const activate = async (pluginId = 'alpha', access = ['read', 'write']) => {
    await service.importCredential(pluginId, 'key', `${pluginId}-test-secret`);
    await service.setAccess({ pluginId, access });
    return service.setEnabled({ pluginId, enabled: true });
  };
  return {
    service,
    create,
    activate,
    values,
    contexts,
    signals,
    invoked,
    disposed,
    settings,
    secrets,
    network: (value: boolean) => {
      allowed = value;
    },
  };
}
