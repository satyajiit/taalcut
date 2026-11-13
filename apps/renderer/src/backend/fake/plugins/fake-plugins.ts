// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  defineCommand,
  implementContract,
  NotFoundError,
  ok,
  PERSON_SOURCES,
  PLUGIN_COMMANDS,
  pluginCommandPayloads,
  pluginsContract,
  pluginsSetupContract,
  toRpcError,
  ValidationError,
  type AnyCommand,
  type PluginTool,
  type PluginView,
} from '@taalcut/core';
import { handleFakeInstagramEditsCall } from './edits-fixture';
import { FAKE_INSTAGRAM_EDITS_MANIFEST, FAKE_POSTIZ_MANIFEST } from './postiz-fixture';

export interface FakePluginOptions {
  readonly connected?: boolean;
  readonly enabled?: boolean;
  readonly access?: string[];
  readonly setupRequested?: boolean;
  readonly editsConnected?: boolean;
}

const os = implementContract({ plugins: pluginsContract, pluginsSetup: pluginsSetupContract });

/** Preview uses the real contract and command bus, but never reads a clipboard or sends a request. */
export function createFakePlugins(now: () => number, options: FakePluginOptions = {}) {
  const states = new Map<string, PluginView>([
    [
      FAKE_POSTIZ_MANIFEST.id,
      {
        manifest: FAKE_POSTIZ_MANIFEST,
        enabled: options.enabled ?? false,
        status: options.connected ? (options.enabled ? 'active' : 'inactive') : 'disconnected',
        configuredCredentials: options.connected ? ['api-key'] : [],
        config: {},
        grantedAccess: options.access ?? FAKE_POSTIZ_MANIFEST.access.map((field) => field.id),
        setupRequested: options.setupRequested ?? false,
        lastCheckedAt: null,
      },
    ],
    [
      FAKE_INSTAGRAM_EDITS_MANIFEST.id,
      {
        manifest: FAKE_INSTAGRAM_EDITS_MANIFEST,
        enabled: true,
        status: options.editsConnected ? 'active' : 'disconnected',
        configuredCredentials: options.editsConnected ? ['access-token'] : [],
        config: {},
        grantedAccess: FAKE_INSTAGRAM_EDITS_MANIFEST.access.map((field) => field.id),
        setupRequested: false,
        lastCheckedAt: null,
      },
    ],
  ]);
  const get = (pluginId = 'postiz') => {
    const state = states.get(pluginId);
    if (!state) throw toRpcError(NotFoundError({ entity: 'plugin', id: pluginId }));
    return state;
  };
  const update = (pluginId: string, next: Partial<PluginView>) => {
    const current = get(pluginId);
    const updated: PluginView = { ...current, ...next };
    updated.status =
      updated.configuredCredentials.length === 0 ? 'disconnected' : updated.enabled ? 'active' : 'inactive';
    states.set(pluginId, updated);
    return updated;
  };
  const calls: { pluginId: string; toolName: string; input: Record<string, unknown> }[] = [];
  const savedTrackIds = new Set<string>(['941658947548420']);
  const person = { sources: PERSON_SOURCES, sideEffect: 'write', project: () => null } as const;
  const commands: AnyCommand[] = [
    defineCommand({
      ...person,
      name: PLUGIN_COMMANDS.configure,
      payload: pluginCommandPayloads[PLUGIN_COMMANDS.configure],
      async handle({ pluginId, config }) {
        const current = get(pluginId);
        if (JSON.stringify(config) === JSON.stringify(current.config)) return ok({ result: current });
        return ok({
          result: update(pluginId, {
            config,
            enabled: false,
            configuredCredentials: [],
            grantedAccess: [],
            lastCheckedAt: null,
          }),
        });
      },
    }),
    defineCommand({
      ...person,
      name: PLUGIN_COMMANDS.setEnabled,
      payload: pluginCommandPayloads[PLUGIN_COMMANDS.setEnabled],
      async handle({ pluginId, enabled }) {
        get(pluginId);
        return ok({ result: update(pluginId, { enabled, setupRequested: false }) });
      },
    }),
    defineCommand({
      ...person,
      name: PLUGIN_COMMANDS.setAccess,
      payload: pluginCommandPayloads[PLUGIN_COMMANDS.setAccess],
      async handle({ pluginId, access }) {
        get(pluginId);
        return ok({ result: update(pluginId, { grantedAccess: access }) });
      },
    }),
    defineCommand({
      ...person,
      name: PLUGIN_COMMANDS.disconnect,
      payload: pluginCommandPayloads[PLUGIN_COMMANDS.disconnect],
      async handle({ pluginId }) {
        get(pluginId);
        return ok({
          result: update(pluginId, {
            enabled: false,
            configuredCredentials: [],
            grantedAccess: [],
            lastCheckedAt: null,
          }),
        });
      },
    }),
    defineCommand({
      sideEffect: 'write',
      project: () => null,
      name: PLUGIN_COMMANDS.requestSetup,
      payload: pluginCommandPayloads[PLUGIN_COMMANDS.requestSetup],
      async handle({ pluginId }) {
        get(pluginId);
        return ok({ result: update(pluginId, { setupRequested: true }) });
      },
    }),
    defineCommand({
      sideEffect: 'external',
      project: () => null,
      name: PLUGIN_COMMANDS.call,
      payload: pluginCommandPayloads[PLUGIN_COMMANDS.call],
      async handle({ pluginId, toolName, input }) {
        get(pluginId);
        calls.push({ pluginId, toolName, input });
        if (pluginId === 'instagram-edits') {
          return ok({
            result: {
              ...handleFakeInstagramEditsCall(toolName, input, savedTrackIds),
              pluginId,
              toolName,
              input,
            },
          });
        }
        return ok({ result: { ok: true, pluginId, toolName, input } });
      },
    }),
  ];
  const tools = (pluginId: string): PluginTool[] =>
    pluginId === 'instagram-edits'
      ? [
          {
            name: 'api.listMusicTracks',
            description:
              // eslint-disable-next-line lingui/no-unlocalized-strings -- Service metadata is localized by plugin-tool-messages.
              'List or search Instagram music tracks by tab (Trending, For You, Original audio, Royalty-free) and license, including audioAssetId and viral hook timestamps.',
            inputSchema: { type: 'object' },
            access: ['music-read'],
            sideEffect: 'read',
            source: 'api',
          },
          {
            name: 'api.stageReel',
            description:
              // eslint-disable-next-line lingui/no-unlocalized-strings -- Service metadata is localized by plugin-tool-messages.
              'Stage a finished Taalcut render or library asset into a new Instagram Edits project with an optional Instagram audioAssetId and separate editable caption tracks.',
            inputSchema: { type: 'object' },
            access: ['projects-write'],
            sideEffect: 'external',
            source: 'api',
          },
        ]
      : [
          {
            name: 'api.listIntegrations',
            // eslint-disable-next-line lingui/no-unlocalized-strings -- Service metadata is localized by plugin-tool-messages.
            description: 'List connected social accounts, optionally for a customer group.',
            inputSchema: { type: 'object' },
            access: ['channels-read'],
            sideEffect: 'read',
            source: 'api',
          },
          {
            name: 'api.createPost',
            description:
              // eslint-disable-next-line lingui/no-unlocalized-strings -- Service metadata is localized by plugin-tool-messages.
              'Create a draft, scheduled or immediate post. Upload media first and inspect each channel’s settings. This can publish to social accounts.',
            inputSchema: { type: 'object' },
            access: ['posts-write'],
            sideEffect: 'external',
            source: 'api',
          },
        ];
  return {
    get,
    calls,
    commands,
    router: {
      plugins: {
        list: os.plugins.list.handler(() => [states.get('postiz')!, states.get('instagram-edits')!]),
        describe: os.plugins.describe.handler(({ input }) => get(input.pluginId)),
        tools: os.plugins.tools.handler(({ input }) => {
          const plugin = get(input.pluginId);
          if (!plugin.enabled) throw toRpcError(ValidationError({ field: 'enabled' }));
          return tools(input.pluginId).filter((tool) =>
            tool.access.every((access) => plugin.grantedAccess.includes(access)),
          );
        }),
        readSkill: os.plugins.readSkill.handler(({ input }) => {
          const plugin = get(input.pluginId);
          const skill = plugin.manifest.skills.find((entry) => entry.id === input.skillId);
          if (!skill) throw toRpcError(NotFoundError({ entity: 'skill', id: input.skillId }));
          return { ...skill, content: skill.description };
        }),
      },
      pluginsSetup: {
        importCredential: os.pluginsSetup.importCredential.handler(({ input }) => {
          const plugin = get(input.pluginId);
          if (!plugin.manifest.credentials.some((field) => field.id === input.credentialId))
            throw toRpcError(ValidationError({ field: 'credentialId' }));
          return update(input.pluginId, {
            configuredCredentials: [...new Set([...plugin.configuredCredentials, input.credentialId])],
            enabled: true,
            grantedAccess: plugin.manifest.access.map((field) => field.id),
            lastCheckedAt: null,
          });
        }),
        testConnection: os.pluginsSetup.testConnection.handler(({ input }) => {
          const plugin = get(input.pluginId);
          return update(input.pluginId, {
            enabled: true,
            grantedAccess:
              plugin.grantedAccess.length > 0
                ? plugin.grantedAccess
                : plugin.manifest.access.map((field) => field.id),
            lastCheckedAt: now(),
          });
        }),
      },
    },
  };
}
