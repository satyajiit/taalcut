// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The two client eras the server must serve: the v2 SDK pinned to 2026-07-28 (Claude Code's v2 runtime) and the
 * v1 SDK's 2025-11-25 handshake with a protocol session (Codex's default lifecycle).
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface ToolResultLike {
  readonly content?: unknown;
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
}

export interface EraClient {
  readonly era: '2026-07-28' | '2025-11-25';
  listTools(): Promise<{ name: string; annotations?: unknown }[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    onProgress?: (progress: { progress: number; message?: string }) => void,
  ): Promise<ToolResultLike>;
  /** The 2025 protocol session id, when the server gave one. */
  sessionId(): string | undefined;
  close(): Promise<void>;
}

/** The v1 SDK's result type also admits a pre-2024 `{ toolResult }` shape; the server never sends it. */
function asResult(value: object): ToolResultLike {
  const record = value as Record<string, unknown>;
  return {
    content: record['content'],
    structuredContent: record['structuredContent'],
    isError: record['isError'] === true,
  };
}

function headers(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } };
}

export async function modernClient(url: string, token: string): Promise<EraClient> {
  const client = new Client(
    { name: 'claude-code-test', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: headers(token) }));
  return {
    era: '2026-07-28',
    listTools: async () => (await client.listTools()).tools,
    callTool: (name, args, onProgress) =>
      client.callTool(
        { name, arguments: args },
        onProgress ? { onprogress: (progress) => onProgress(progress) } : undefined,
      ),
    sessionId: () => undefined,
    close: () => client.close(),
  };
}

export async function legacyClient(url: string, token: string): Promise<EraClient> {
  const transport = new LegacyTransport(new URL(url), { requestInit: headers(token) });
  const client = new LegacyClient({ name: 'codex-test', version: '1.0.0' });
  await client.connect(transport);
  return {
    era: '2025-11-25',
    listTools: async () => (await client.listTools()).tools,
    callTool: async (name, args, onProgress) =>
      asResult(
        await client.callTool(
          { name, arguments: args },
          undefined,
          onProgress ? { onprogress: (progress) => onProgress(progress) } : undefined,
        ),
      ),
    sessionId: () => transport.sessionId,
    close: () => client.close(),
  };
}

export const ERAS = [
  ['2026-07-28', modernClient],
  ['2025-11-25', legacyClient],
] as const;
