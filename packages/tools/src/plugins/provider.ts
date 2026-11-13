// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type {
  AsyncResult,
  PluginManifest,
  PluginSecrets,
  PluginSkillContent,
  PluginTool,
} from '@taalcut/core';
import type { z } from 'zod';

/** The runtime gives each adapter a private namespace, never the application's stores. */
export interface PluginData {
  get(key: string): AsyncResult<unknown>;
  set(key: string, value: unknown): AsyncResult<void>;
  delete(key: string): AsyncResult<void>;
  clear(): AsyncResult<void>;
}

export interface PluginContext {
  readonly config: Readonly<Record<string, string>>;
  readonly secrets: Pick<PluginSecrets, 'get'>;
  readonly data: PluginData;
}

export interface PluginAdapter {
  connect(signal: AbortSignal): AsyncResult<PluginTool[]>;
  invoke(name: string, input: Record<string, unknown>, signal: AbortSignal): AsyncResult<unknown>;
  dispose(): Promise<void>;
}

export interface PluginDefinition {
  readonly manifest: PluginManifest;
  readonly skills: readonly PluginSkillContent[];
  readonly configSchema: z.ZodType<Record<string, string>>;
  readonly create: (context: PluginContext) => PluginAdapter;
}
