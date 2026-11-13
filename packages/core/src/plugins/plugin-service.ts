// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { PluginInvoke, PluginSkillContent, PluginTool, PluginView } from './plugin-types';

/** Main owns this service. Neither the agent nor a window receives a credential. */
export interface PluginService {
  list(): AsyncResult<PluginView[]>;
  describe(pluginId: string): AsyncResult<PluginView>;
  tools(pluginId: string, signal?: AbortSignal): AsyncResult<PluginTool[]>;
  readSkill(pluginId: string, skillId: string): AsyncResult<PluginSkillContent>;
  configure(input: { pluginId: string; config: Record<string, string> }): AsyncResult<PluginView>;
  setEnabled(input: { pluginId: string; enabled: boolean }): AsyncResult<PluginView>;
  setAccess(input: { pluginId: string; access: string[] }): AsyncResult<PluginView>;
  disconnect(pluginId: string): AsyncResult<PluginView>;
  requestSetup(pluginId: string): AsyncResult<PluginView>;
  testConnection(pluginId: string, signal?: AbortSignal): AsyncResult<PluginView>;
  invoke(input: PluginInvoke, signal?: AbortSignal): AsyncResult<unknown>;
  /** Main-only; the caller supplies clipboard text directly to the vault. Never exposed over IPC. */
  importCredential(pluginId: string, credentialId: string, value: string): AsyncResult<PluginView>;
  /** Stop live transports when privacy changes; saved activation and credentials remain intact. */
  suspendNetwork(): Promise<void>;
  dispose(): Promise<void>;
}
export const PluginServiceToken = createToken<PluginService>('core.pluginService');

export type PluginAgentService = Omit<PluginService, 'importCredential' | 'suspendNetwork' | 'dispose'>;
export const PluginAgentServiceToken = createToken<PluginAgentService>('core.pluginAgentService');

/** Structural vault port, implemented by main's existing safeStorage vault. */
export interface PluginSecrets {
  get(key: string): AsyncResult<string | undefined>;
  set(key: string, value: string): AsyncResult<void>;
  delete(key: string): AsyncResult<void>;
}
