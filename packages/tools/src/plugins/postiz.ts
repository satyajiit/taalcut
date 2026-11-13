// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, type PluginTool } from '@taalcut/core';
import { PluginAuthenticationFailed, PluginInvalidTool } from './errors';
import {
  connectPluginMcp,
  type PluginMcpConnector,
  type PluginMcpSession,
  type PluginMcpTool,
} from './mcp-client';
import { postizConfigSchema, postizMcpUrl } from './postiz-config';
import { callPostizApi, type OpenPluginUpload } from './postiz-http';
import { postizManifest, postizSkills } from './postiz-manifest';
import { operationTool, postizOperations } from './postiz-operations';
import type { PluginDefinition } from './provider';

export interface PostizPluginOptions {
  readonly fetch?: typeof fetch;
  readonly openUpload?: OpenPluginUpload;
  readonly connectMcp?: PluginMcpConnector;
}

const mcpAccess: Record<string, { access: string[]; sideEffect: 'read' | 'external' }> = {
  integrationList: { access: ['channels-read'], sideEffect: 'read' },
  groupList: { access: ['channels-read'], sideEffect: 'read' },
  integrationSchema: { access: ['channels-read'], sideEffect: 'read' },
  triggerTool: { access: ['channels-write'], sideEffect: 'external' },
  schedulePostTool: { access: ['posts-write'], sideEffect: 'external' },
  integrationSchedulePostTool: { access: ['posts-write'], sideEffect: 'external' },
  uploadFromUrlTool: { access: ['media-write'], sideEffect: 'external' },
  postsListTool: { access: ['posts-read'], sideEffect: 'read' },
  postSettingsTool: { access: ['posts-write'], sideEffect: 'external' },
  generateImageTool: { access: ['media-generate'], sideEffect: 'external' },
  generateVideoOptions: { access: ['media-generate'], sideEffect: 'read' },
  videoFunctionTool: { access: ['media-generate'], sideEffect: 'external' },
  generateVideoTool: { access: ['media-generate'], sideEffect: 'external' },
  clippingTool: { access: ['media-generate', 'posts-write'], sideEffect: 'external' },
  clippingStatusTool: { access: ['media-read'], sideEffect: 'read' },
};

function mcpTool(tool: PluginMcpTool): PluginTool {
  const permissions = Object.hasOwn(mcpAccess, tool.name)
    ? mcpAccess[tool.name]!
    : { access: ['mcp-extended'], sideEffect: 'external' as const };
  return {
    name: `mcp.${tool.name}`,
    description: tool.description?.slice(0, 4000) || tool.name,
    inputSchema: tool.inputSchema,
    ...permissions,
    source: 'mcp',
  };
}

export function createPostizPluginDefinition(options: PostizPluginOptions = {}): PluginDefinition {
  return {
    manifest: postizManifest,
    skills: postizSkills,
    configSchema: postizConfigSchema,
    create(context) {
      const operations = postizOperations();
      let mcp: PluginMcpSession | undefined;
      let apiKey: string | undefined;
      return {
        async connect(signal) {
          const credential = await context.secrets.get('api-key');
          if (!credential.ok) return credential;
          if (!credential.value) return err(PluginAuthenticationFailed({ pluginId: 'postiz' }));
          apiKey = credential.value;
          const health = operations.find((operation) => operation.name === 'isConnected')!;
          const result = await callPostizApi(
            health,
            {},
            {
              baseUrl: context.config['api-url']!,
              apiKey,
              fetch: options.fetch ?? fetch,
            },
            signal,
          );
          if (!result.ok) return result;
          if (
            !result.value ||
            typeof result.value !== 'object' ||
            !('connected' in result.value) ||
            result.value.connected !== true
          ) {
            return err(PluginAuthenticationFailed({ pluginId: 'postiz' }));
          }
          const remote = await (options.connectMcp ?? connectPluginMcp)({
            url: postizMcpUrl(context.config),
            token: apiKey,
            fetch: options.fetch ?? fetch,
            signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          });
          // Older self-hosted instances may not route MCP. Their public API remains fully usable.
          if (remote.ok) mcp = remote.value;
          return ok([...operations.map(operationTool), ...(mcp?.tools.map(mcpTool) ?? [])]);
        },
        async invoke(name, input, signal) {
          if (!apiKey) return err(PluginAuthenticationFailed({ pluginId: 'postiz' }));
          if (name.startsWith('mcp.') && mcp) return mcp.call(name.slice(4), input, signal);
          const operation = operations.find((item) => `api.${item.name}` === name);
          if (!operation) return err(PluginInvalidTool({ pluginId: 'postiz' }));
          return callPostizApi(
            operation,
            input,
            {
              baseUrl: context.config['api-url']!,
              apiKey,
              fetch: options.fetch ?? fetch,
              ...(options.openUpload ? { openUpload: options.openUpload } : {}),
            },
            signal,
          );
        },
        async dispose() {
          apiKey = undefined;
          await mcp?.close();
          mcp = undefined;
        },
      };
    },
  };
}

export const postizPluginDefinition = createPostizPluginDefinition();
