// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A small MCP client over Streamable HTTP for the e2e (the desktop has no MCP SDK): JSON-RPC posts with the bearer
 * and, after initialize, the protocol session; each answer read whole, as JSON or as the event stream the server
 * answers a tool call on. Enough for initialize, tools/list and tools/call, and for the HTTP status a refused
 * request gets.
 */
import { request } from 'node:http';
import { z } from 'zod';

const PROTOCOL = '2025-11-25';

const messageSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string()]).optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
type Message = z.infer<typeof messageSchema>;

const toolResultSchema = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
});
export type ToolAnswer = z.infer<typeof toolResultSchema>;

const toolListSchema = z.object({ tools: z.array(z.object({ name: z.string() })) });

interface HttpAnswer {
  readonly status: number;
  readonly session: string | undefined;
  readonly messages: readonly Message[];
}

/** The JSON-RPC messages in a body: one JSON object, or the `data:` lines of an event stream. */
function messagesOf(contentType: string, body: string): Message[] {
  const texts = contentType.includes('text/event-stream')
    ? body
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
    : [body.trim()];
  return texts.filter((text) => text.startsWith('{')).map((text) => messageSchema.parse(JSON.parse(text)));
}

export function mcpWire(port: number, bearer: string) {
  let session: string | undefined;
  let nextId = 1;

  const post = (body: unknown): Promise<HttpAnswer> =>
    new Promise((resolve, reject) => {
      const text = JSON.stringify(body);
      const sent = request(
        {
          host: '127.0.0.1',
          port,
          path: '/mcp',
          method: 'POST',
          headers: {
            host: `127.0.0.1:${port}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'content-length': String(Buffer.byteLength(text)),
            authorization: `Bearer ${bearer}`,
            'mcp-protocol-version': PROTOCOL,
            ...(session ? { 'mcp-session-id': session } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            const header = res.headers['mcp-session-id'];
            const raw = Buffer.concat(chunks).toString('utf8');
            resolve({
              status,
              session: typeof header === 'string' ? header : undefined,
              messages: status === 200 ? messagesOf(res.headers['content-type'] ?? '', raw) : [],
            });
          });
        },
      );
      sent.once('error', reject);
      sent.end(text);
    });

  async function rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = nextId++;
    const answer = await post({ jsonrpc: '2.0', id, method, params });
    if (answer.status !== 200) throw new Error(`${method}: HTTP ${answer.status}`);
    const reply = answer.messages.find((message) => message.id === id);
    if (!reply) throw new Error(`${method}: no answer with id ${id}`);
    if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
    return reply.result;
  }

  const initialize = () =>
    post({
      jsonrpc: '2.0',
      id: nextId++,
      method: 'initialize',
      params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'e2e', version: '1.0.0' } },
    });

  return {
    /** Opens the protocol session, as a client does before anything else. */
    async open(): Promise<void> {
      const opened = await initialize();
      if (opened.status !== 200 || !opened.session) throw new Error(`initialize: HTTP ${opened.status}`);
      session = opened.session;
      const ready = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
      if (ready.status >= 300) throw new Error(`notifications/initialized: HTTP ${ready.status}`);
    },
    async tools(): Promise<string[]> {
      return toolListSchema.parse(await rpc('tools/list', {})).tools.map((tool) => tool.name);
    },
    async call(name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
      return toolResultSchema.parse(await rpc('tools/call', { name, arguments: args }));
    },
    /** The HTTP status a new initialize gets with this bearer (200 served, 401 refused). */
    async initializeStatus(): Promise<number> {
      return (await initialize()).status;
    },
    /** The HTTP status a tools/list on the open protocol session gets. */
    async listStatus(): Promise<number> {
      return (await post({ jsonrpc: '2.0', id: nextId++, method: 'tools/list', params: {} })).status;
    },
  };
}

export type McpWire = ReturnType<typeof mcpWire>;
