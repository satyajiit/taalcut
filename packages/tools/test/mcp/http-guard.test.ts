// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V4 transport security against the real server: loopback only, the Host and Origin matrix (DNS rebinding and
 * browser pages), Sec-Fetch-Site, OPTIONS, methods and paths, the bearer (401 without OAuth hints), body and depth
 * limits, the per-session rate (429), the protocol header, and logs without the bearer or the arguments.
 */
import { request } from 'node:http';
import { connect } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MCP_LIMITS } from '@taalcut/tools';
import { modernClient } from './helpers/clients';
import { createWorld, type World } from './helpers/world';

let world: World;
let token: string;

beforeAll(async () => {
  world = await createWorld({ limits: { ...MCP_LIMITS, requestsPerMinute: 40 } });
  ({ token } = await world.addSession('edit'));
});

afterAll(async () => {
  await world.close();
});

interface Reply {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

const listBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

function send(options: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  bearer?: string | null;
}): Promise<Reply> {
  const bearer = options.bearer === undefined ? token : options.bearer;
  const headers: Record<string, string> = {
    host: `127.0.0.1:${world.port}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-11-25',
    ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    ...options.headers,
  };
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: world.port,
        method: options.method ?? 'POST',
        path: options.path ?? '/mcp',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(options.body ?? (options.method && options.method !== 'POST' ? undefined : listBody));
  });
}

describe('where it listens', () => {
  it('accepts loopback IPv4 and refuses ::1 (bound to 127.0.0.1 only)', async () => {
    const refused = await new Promise<string>((resolve) => {
      const socket = connect({ host: '::1', port: world.port });
      socket.once('connect', () => {
        socket.destroy();
        resolve('connected');
      });
      socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'));
    });
    expect(refused).not.toBe('connected');
    expect((await send({})).status).toBe(200);
  });
});

describe('the Host and Origin matrix', () => {
  it.each([
    [`127.0.0.1:PORT`, 200],
    [`localhost:PORT`, 200],
    ['evil.example:PORT', 403],
    ['127.0.0.1:1', 403],
    ['127.0.0.1', 403],
  ])('Host %s → %i', async (host, status) => {
    expect((await send({ headers: { host: host.replace('PORT', String(world.port)) } })).status).toBe(status);
  });

  it.each([
    [undefined, 200],
    ['http://127.0.0.1:PORT', 200],
    ['http://localhost:PORT', 200],
    ['https://evil.example', 403],
    ['null', 403],
    ['http://127.0.0.1:1', 403],
  ])('Origin %s → %i', async (origin, status) => {
    const reply = await send({
      headers: origin ? { origin: origin.replace('PORT', String(world.port)) } : {},
    });
    expect(reply.status).toBe(status);
    if (status === 403) expect(JSON.parse(reply.body)).toMatchObject({ jsonrpc: '2.0', id: null });
    expect(reply.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses a cross-site browser fetch and any preflight', async () => {
    expect((await send({ headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await send({ method: 'OPTIONS' })).status).toBe(403);
  });
});

describe('methods, paths and media types', () => {
  it.each([
    ['GET', '/mcp', 405],
    ['PUT', '/mcp', 405],
    ['POST', '/', 404],
    ['POST', '/mcp/x', 404],
    ['POST', '/.well-known/oauth-protected-resource', 404],
  ])('%s %s → %i', async (method, path, status) => {
    expect((await send({ method, path })).status).toBe(status);
  });

  it('wants JSON in and JSON or SSE out', async () => {
    expect((await send({ headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect((await send({ headers: { accept: 'application/json' } })).status).toBe(406);
  });
});

describe('the bearer', () => {
  it('is 401 without one, with a wrong one, or with a malformed one, never naming OAuth', async () => {
    for (const bearer of [null, `tcm_${'A'.repeat(43)}`, 'not-a-taalcut-token']) {
      const reply = await send({ bearer });
      expect(reply.status).toBe(401);
      expect(reply.headers['www-authenticate']).toBeUndefined();
    }
  });
});

describe('limits', () => {
  it('refuses a body over 1 MiB, by its length or as it arrives, and JSON nested too deep', async () => {
    const big = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: { pad: 'x'.repeat(1_100_000) },
    });
    expect((await send({ body: big })).status).toBe(413);
    // No declared length (chunked): refused once more than 1 MiB has arrived.
    expect((await send({ body: big, headers: { 'transfer-encoding': 'chunked' } })).status).toBe(413);
    const deep = `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":${'['.repeat(40)}${']'.repeat(40)}}`;
    expect((await send({ body: deep })).status).toBe(413);
    expect((await send({ body: '{not json' })).status).toBe(400);
  });

  it('checks the protocol revision', async () => {
    expect((await send({ headers: { 'mcp-protocol-version': '2024-11-05' } })).status).toBe(400);
    expect((await send({ headers: { 'mcp-protocol-version': 'bogus' } })).status).toBe(400);
    expect((await send({ headers: { 'mcp-protocol-version': '2025-06-18' } })).status).toBe(200);
  });

  it('answers 429 with Retry-After past the session rate', async () => {
    const replies: Reply[] = [];
    for (let i = 0; i < 45; i++) replies.push(await send({}));
    const limited = replies.find((reply) => reply.status === 429);
    expect(limited?.headers['retry-after']).toMatch(/^\d+$/);
  });
});

describe('logs', () => {
  it('name the session, method, tool and status, never the bearer or the arguments', async () => {
    const { token: own } = await world.addSession('edit');
    const client = await modernClient(world.url, own);
    await client.callTool('templates_breakdown', { reference: 'SECRET-ARGUMENT-1234' });
    await client.close();
    const text = world.logs.join('\n');
    expect(text).toContain('tools/call templates_breakdown 200');
    expect(text).not.toContain('SECRET-ARGUMENT-1234');
    expect(text).not.toContain(own);
    expect(text).not.toContain(token);
  });
});
