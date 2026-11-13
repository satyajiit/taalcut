// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, ok, type CommandToolContext, type PluginAgentService, type PluginView } from '@taalcut/core';
import { createMemoryArtifactStore } from '@taalcut/tools';
import { vi } from 'vitest';

export const plugin: PluginView = {
  manifest: {
    id: 'fixture',
    name: 'Fixture',
    version: '1.0.0',
    publisher: 'Taalcut',
    summary: 'A test plugin.',
    description: 'Plugin runtime fixture.',
    logo: 'fixture',
    homepage: 'https://example.com',
    docs: 'https://example.com/docs',
    features: [],
    access: [],
    credentials: [{ id: 'api-key', name: 'API key', description: 'Credential.', required: true }],
    configFields: [],
    skills: [{ id: 'publish', name: 'Publishing', description: 'Publishing workflow.' }],
  },
  enabled: false,
  status: 'disconnected',
  configuredCredentials: [],
  config: {},
  grantedAccess: [],
  setupRequested: false,
  lastCheckedAt: null,
};

export function agentPluginService() {
  return {
    list: vi.fn<PluginAgentService['list']>(async () => ok([plugin])),
    describe: vi.fn<PluginAgentService['describe']>(async () => ok(plugin)),
    tools: vi.fn<PluginAgentService['tools']>(async () => ok([])),
    readSkill: vi.fn<PluginAgentService['readSkill']>(async () =>
      ok({
        id: 'publish',
        name: 'Publishing',
        description: 'Publishing workflow.',
        content: 'Read before publishing.',
      }),
    ),
    configure: vi.fn<PluginAgentService['configure']>(async () => ok(plugin)),
    setEnabled: vi.fn<PluginAgentService['setEnabled']>(async () => ok(plugin)),
    setAccess: vi.fn<PluginAgentService['setAccess']>(async () => ok(plugin)),
    disconnect: vi.fn<PluginAgentService['disconnect']>(async () => ok(plugin)),
    requestSetup: vi.fn<PluginAgentService['requestSetup']>(async () =>
      ok({ ...plugin, setupRequested: true }),
    ),
    testConnection: vi.fn<PluginAgentService['testConnection']>(async () => ok(plugin)),
    invoke: vi.fn<PluginAgentService['invoke']>(async () => ok({ done: true })),
  } satisfies PluginAgentService;
}

export function toolContext(): CommandToolContext {
  return {
    signal: new AbortController().signal,
    callId: newId<'ToolRun'>(),
    attempt: 1,
    artifacts: createMemoryArtifactStore(),
    reportUsage: vi.fn(),
    reportProgress: vi.fn(),
    dispatch: vi.fn(async () => ok({ done: true })),
  };
}
