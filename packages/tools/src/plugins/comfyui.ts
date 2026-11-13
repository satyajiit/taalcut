// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, type AsyncResult, type PluginTool } from '@taalcut/core';
import {
  PluginAuthenticationFailed,
  PluginConnectionFailed,
  PluginInvalidInput,
  PluginInvalidTool,
  PluginRemoteFailed,
} from './errors';
import { comfyuiConfigSchema, comfyuiManifest, comfyuiSkills } from './comfyui-manifest';
import type { PluginDefinition } from './provider';
import { pluginAttempt } from './safe-result';

export interface ComfyUiPluginOptions {
  readonly fetch?: typeof fetch;
}

const COMFYUI_TOOLS: readonly PluginTool[] = [
  {
    name: 'api.getSystemStats',
    description: 'Read GPU device, VRAM and queue statistics from the connected ComfyUI server.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    access: ['system-read'],
    sideEffect: 'read',
    source: 'api',
  },
  {
    name: 'api.queuePrompt',
    description: 'Submit a parameterised ComfyUI workflow graph (/prompt) for local image or B-roll generation.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'object', description: 'ComfyUI node graph dictionary keyed by node ID.' },
        clientId: { type: 'string', description: 'Optional client identifier.' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    access: ['media-generate'],
    sideEffect: 'external',
    source: 'api',
  },
  {
    name: 'api.getHistory',
    description: 'Inspect the execution status and output filenames of a queued ComfyUI prompt (/history/<promptId>).',
    inputSchema: {
      type: 'object',
      properties: {
        promptId: { type: 'string', description: 'Prompt ID returned by api.queuePrompt.' },
      },
      required: ['promptId'],
      additionalProperties: false,
    },
    access: ['system-read'],
    sideEffect: 'read',
    source: 'api',
  },
];

async function callComfyJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): AsyncResult<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, redirect: 'error' });
  } catch (cause) {
    return err(
      PluginConnectionFailed(
        { pluginId: 'comfyui' },
        { detail: cause instanceof Error ? cause.message : String(cause) },
      ),
    );
  }
  if (response.status === 401 || response.status === 403) {
    return err(
      PluginAuthenticationFailed({ pluginId: 'comfyui' }, { detail: `HTTP ${response.status} from ${url}` }),
    );
  }
  if (!response.ok) {
    return err(
      PluginRemoteFailed({ pluginId: 'comfyui' }, { detail: `HTTP ${response.status} from ${url}` }),
    );
  }
  try {
    return ok(await response.json());
  } catch (cause) {
    return err(
      PluginRemoteFailed(
        { pluginId: 'comfyui' },
        { detail: cause instanceof Error ? cause.message : String(cause) },
      ),
    );
  }
}

export function createComfyUiPluginDefinition(options: ComfyUiPluginOptions = {}): PluginDefinition {
  const fetchImpl = options.fetch ?? fetch;
  return {
    manifest: comfyuiManifest,
    skills: comfyuiSkills,
    configSchema: comfyuiConfigSchema,
    create(context) {
      let token: string | undefined;
      const headers = (): Record<string, string> =>
        token ? { Authorization: `Bearer ${token}` } : {};

      return {
        async connect(signal) {
          return pluginAttempt('comfyui', signal, async () => {
            const secret = await context.secrets.get('api-key');
            if (!secret.ok) return secret;
            token = secret.value;
            const baseUrl = context.config['server-url']!;
            const stats = await callComfyJson(fetchImpl, `${baseUrl}/system_stats`, {
              method: 'GET',
              headers: headers(),
              signal,
            });
            if (!stats.ok) return stats;
            return ok([...COMFYUI_TOOLS]);
          });
        },

        async invoke(name, input, signal) {
          return pluginAttempt('comfyui', signal, async () => {
            const baseUrl = context.config['server-url']!;
            if (name === 'api.getSystemStats') {
              return callComfyJson(fetchImpl, `${baseUrl}/system_stats`, {
                method: 'GET',
                headers: headers(),
                signal,
              });
            }
            if (name === 'api.queuePrompt') {
              const body = input as { prompt?: unknown; clientId?: unknown } | null;
              if (
                !body ||
                typeof body.prompt !== 'object' ||
                body.prompt === null ||
                Array.isArray(body.prompt) ||
                Object.keys(body.prompt).length === 0
              ) {
                return err(
                  PluginInvalidInput({ pluginId: 'comfyui' }, { detail: 'prompt must be a non-empty object' }),
                );
              }
              return callComfyJson(fetchImpl, `${baseUrl}/prompt`, {
                method: 'POST',
                headers: { ...headers(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  prompt: body.prompt,
                  client_id: typeof body.clientId === 'string' ? body.clientId : 'taalcut-plugin',
                }),
                signal,
              });
            }
            if (name === 'api.getHistory') {
              const body = input as { promptId?: unknown } | null;
              const promptId = typeof body?.promptId === 'string' ? body.promptId.trim() : '';
              if (!promptId || /[/\\]|\.\./.test(promptId)) {
                return err(
                  PluginInvalidInput({ pluginId: 'comfyui' }, { detail: 'promptId must be a valid identifier' }),
                );
              }
              return callComfyJson(fetchImpl, `${baseUrl}/history/${encodeURIComponent(promptId)}`, {
                method: 'GET',
                headers: headers(),
                signal,
              });
            }
            return err(PluginInvalidTool({ pluginId: 'comfyui' }));
          });
        },

        async dispose() {
          token = undefined;
        },
      };
    },
  };
}

export const comfyuiPluginDefinition = createComfyUiPluginDefinition();
