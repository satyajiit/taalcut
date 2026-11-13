// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  APP_ROUTES,
  MAIN_SERVICE_CONTRACTS,
  PLUGIN_COMMANDS,
  appContract,
  pluginCommandPayloads,
  pluginIdSchema,
  pluginInvokeSchema,
  pluginsContract,
  pluginsSetupContract,
} from '@taalcut/core';

describe('plugin trust boundaries', () => {
  it('keeps invocation and lifecycle service methods off the renderer port', () => {
    expect(appContract.plugins).toBe(pluginsContract);
    expect(APP_ROUTES.plugins).toBe('main');
    expect(APP_ROUTES.pluginsSetup).toBe('main');
    expect(Object.keys(pluginsContract).sort()).toEqual(['describe', 'list', 'readSkill', 'tools']);
    expect(Object.keys(pluginsSetupContract).sort()).toEqual(['importCredential', 'testConnection']);
    expect(MAIN_SERVICE_CONTRACTS.agent.plugins).toHaveProperty('invoke');
    expect(MAIN_SERVICE_CONTRACTS.agent.plugins).not.toHaveProperty('importCredential');
    expect(MAIN_SERVICE_CONTRACTS.jobs).not.toHaveProperty('plugins');
  });

  it('rejects namespace escapes and separates read calls from external commands', () => {
    for (const id of ['../postiz', 'postiz.key', '', 'Postiz', 'postiz/api'])
      expect(pluginIdSchema.safeParse(id).success).toBe(false);
    const input = { pluginId: 'postiz', toolName: 'listPosts', input: {}, mode: 'read' };
    expect(pluginInvokeSchema.safeParse(input).success).toBe(true);
    expect(pluginCommandPayloads[PLUGIN_COMMANDS.call].safeParse(input).success).toBe(false);
    expect(
      pluginCommandPayloads[PLUGIN_COMMANDS.call].safeParse({ ...input, mode: 'external' }).success,
    ).toBe(true);
  });
});
