// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { connectPluginMcp } from '../../src/plugins/mcp-client';

interface Rpc {
  id?: string | number;
  method: string;
  params?: { cursor?: string; name?: string; arguments?: Record<string, unknown> };
}
const closing: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function wire(options: { repeatCursor?: boolean; redirect?: boolean; remoteError?: boolean } = {}) {
  const calls: Rpc[] = [];
  const headers: (string | undefined)[] = [];
  let redirected = false;
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/other') redirected = true;
    if (options.redirect) {
      res.writeHead(307, { location: '/other' });
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const rpc = JSON.parse(Buffer.concat(chunks).toString()) as Rpc;
    calls.push(rpc);
    headers.push(req.headers.authorization);
    if (rpc.id === undefined) {
      res.writeHead(202);
      res.end();
      return;
    }
    let result: unknown;
    if (rpc.method === 'initialize') {
      result = {
        protocolVersion: '2025-11-25',
        serverInfo: { name: 'fixture', version: '1' },
        capabilities: { tools: {} },
      };
    } else if (rpc.method === 'tools/list') {
      result = {
        tools: [
          {
            name: rpc.params?.cursor ? 'second' : 'first',
            inputSchema: {
              type: 'object',
              properties: { count: { type: 'integer', minimum: 1 } },
              required: ['count'],
              additionalProperties: false,
            },
          },
        ],
        ...(!rpc.params?.cursor || options.repeatCursor ? { nextCursor: 'next' } : {}),
      };
    } else {
      result = {
        content: [{ type: 'text', text: 'accepted' }],
        ...(options.remoteError ? { isError: true } : {}),
      };
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  };
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP fixture address.');
  closing.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { url: `http://127.0.0.1:${address.port}/mcp`, calls, headers, wasRedirected: () => redirected };
}

describe('plugin MCP client', () => {
  it('negotiates, aggregates pages, sends bearer auth and validates input before transport', async () => {
    const server = await wire();
    const result = await connectPluginMcp({
      url: server.url,
      token: 'secret',
      fetch,
      signal: AbortSignal.timeout(3_000),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    closing.push(result.value.close);
    expect(result.value.tools.map((tool) => tool.name)).toEqual(['first', 'second']);
    expect(server.calls.filter((call) => call.method === 'tools/list')).toHaveLength(2);
    expect(server.headers.every((header) => header === 'Bearer secret')).toBe(true);
    const signal = AbortSignal.timeout(3_000);
    const invalid = await result.value.call('first', { count: 0 }, signal);
    expect(invalid.ok).toBe(false);
    expect(server.calls.some((call) => call.method === 'tools/call')).toBe(false);
    expect((await result.value.call('first', { count: 2 }, signal)).ok).toBe(true);
    expect(server.calls.at(-1)?.params).toMatchObject({ name: 'first', arguments: { count: 2 } });
  });

  it('stops a server that repeats pagination cursors', async () => {
    const server = await wire({ repeatCursor: true });
    const result = await connectPluginMcp({
      url: server.url,
      token: 'secret',
      fetch,
      signal: AbortSignal.timeout(3_000),
    });
    expect(result.ok).toBe(false);
    expect(server.calls.filter((call) => call.method === 'tools/list').length).toBeLessThanOrEqual(16);
  });

  it('does not follow redirects even to another path on the same origin', async () => {
    const server = await wire({ redirect: true });
    const result = await connectPluginMcp({
      url: server.url,
      token: 'secret',
      fetch,
      signal: AbortSignal.timeout(3_000),
    });
    expect(result.ok).toBe(false);
    expect(server.wasRedirected()).toBe(false);
  });

  it('returns remote tool errors as failures', async () => {
    const server = await wire({ remoteError: true });
    const result = await connectPluginMcp({
      url: server.url,
      token: 'secret',
      fetch,
      signal: AbortSignal.timeout(3_000),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    closing.push(result.value.close);
    const called = await result.value.call('first', { count: 1 }, AbortSignal.timeout(3_000));
    expect(called.ok).toBe(false);
    expect(JSON.stringify(called)).not.toContain('secret');
  });
});
