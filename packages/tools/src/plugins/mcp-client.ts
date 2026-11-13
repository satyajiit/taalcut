// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { fromJsonSchema } from '@modelcontextprotocol/server';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { PluginInvalidInput, PluginRemoteFailed } from './errors';
import { pluginAttempt } from './safe-result';
import { boundedPluginResponse } from './bounded-response';

export interface PluginMcpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: Record<string, unknown>;
}
export interface PluginMcpSession {
  readonly tools: readonly PluginMcpTool[];
  call(name: string, input: Record<string, unknown>, signal: AbortSignal): AsyncResult<unknown>;
  close(): Promise<void>;
}
export type PluginMcpConnector = (options: {
  url: string;
  token: string;
  fetch: typeof fetch;
  signal: AbortSignal;
}) => AsyncResult<PluginMcpSession>;

async function listTools(client: Client, signal: AbortSignal): AsyncResult<PluginMcpTool[]> {
  const tools: PluginMcpTool[] = [];
  const cursors = new Set<string>();
  const names = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 16; page += 1) {
    const listed = await client.request(
      { method: 'tools/list', params: cursor ? { cursor } : {} },
      { signal },
    );
    for (const tool of listed.tools) {
      if (names.has(tool.name)) return err(PluginRemoteFailed({ pluginId: 'postiz' }));
      names.add(tool.name);
      tools.push({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema });
    }
    if (tools.length > 500) return err(PluginRemoteFailed({ pluginId: 'postiz' }));
    if (!listed.nextCursor) return ok(tools);
    if (cursors.has(listed.nextCursor)) return err(PluginRemoteFailed({ pluginId: 'postiz' }));
    cursor = listed.nextCursor;
    cursors.add(cursor);
  }
  return err(PluginRemoteFailed({ pluginId: 'postiz' }));
}

export const connectPluginMcp: PluginMcpConnector = (options) =>
  pluginAttempt('postiz', options.signal, async () => {
    const client = new Client({ name: 'taalcut-postiz', version: '1.0.0' }, { listMaxPages: 16 });
    const pinned = new URL(options.url);
    const transport = new StreamableHTTPClientTransport(pinned, {
      requestInit: { headers: { Authorization: `Bearer ${options.token}` }, redirect: 'error' },
      fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin !== pinned.origin || url.pathname !== pinned.pathname) {
          return Promise.reject(new Error('Plugin endpoint changed.'));
        }
        const response = await options.fetch(input, { ...init, redirect: 'error' });
        return boundedPluginResponse(
          response,
          init?.signal ?? (input instanceof Request ? input.signal : undefined),
        );
      },
    });
    const abort = () => {
      void client.close().catch(() => undefined);
    };
    options.signal.addEventListener('abort', abort, { once: true });
    try {
      await client.connect(transport, { signal: options.signal });
      const listed = await listTools(client, options.signal);
      if (!listed.ok) {
        await client.close();
        return listed;
      }
      const tools = listed.value;
      const validators = new Map(tools.map((tool) => [tool.name, fromJsonSchema(tool.inputSchema)]));
      return ok({
        tools,
        call: (name, input, signal) =>
          pluginAttempt('postiz', signal, async () => {
            const validator = validators.get(name);
            if (!validator) return err(PluginInvalidInput({ pluginId: 'postiz' }));
            const validated = await validator['~standard'].validate(input);
            if (validated.issues) return err(PluginInvalidInput({ pluginId: 'postiz' }));
            const result = await client.callTool({ name, arguments: input }, { signal });
            if (result.isError) return err(PluginRemoteFailed({ pluginId: 'postiz' }));
            if (JSON.stringify(result).length > 4_000_000)
              return err(PluginRemoteFailed({ pluginId: 'postiz' }));
            return ok(result);
          }),
        close: () => client.close(),
      });
    } catch {
      await client.close().catch(() => undefined);
      return err(PluginRemoteFailed({ pluginId: 'postiz' }));
    } finally {
      options.signal.removeEventListener('abort', abort);
    }
  });
