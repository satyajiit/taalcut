// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-R6 (beta security review, MCP server): attacks on the real server with raw requests. A protocol session can't
 * be used or ended with another session's bearer; a bearer is read only from the Authorization header; a Host
 * that only looks like loopback is refused; 2026 routing headers must agree with the body; a client can't write
 * lines into the log; and a body sent slowly can't hold a socket (without a bearer: closed at the 401; with one:
 * closed at the request timeout).
 */
import { connect, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MCP_LIMITS } from '@taalcut/tools';
import { legacyClient } from './helpers/clients';
import { createWorld, type World } from './helpers/world';

let world: World;
let token: string;

beforeAll(async () => {
  world = await createWorld();
  ({ token } = await world.addSession('edit'));
});

afterAll(async () => {
  await world.close();
});

const list = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

function post(bearer: string | null, body: unknown, extra: Record<string, string> = {}): Promise<Response> {
  return fetch(world.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...extra,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Writes raw bytes and collects what comes back until the server closes the socket (or `waitMs` passes). */
function raw(
  text: string,
  waitMs: number,
  port = world.port,
): Promise<{ readonly reply: string; readonly closed: boolean; readonly socket: Socket }> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    const chunks: Buffer[] = [];
    let closed = false;
    const timer = setTimeout(
      () => resolve({ reply: Buffer.concat(chunks).toString('utf8'), closed, socket }),
      waitMs,
    );
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('error', () => undefined);
    socket.on('close', () => {
      closed = true;
      clearTimeout(timer);
      resolve({ reply: Buffer.concat(chunks).toString('utf8'), closed, socket });
    });
    socket.write(text);
  });
}

describe('protocol sessions belong to one bearer', () => {
  it("can't be used or ended with another session's bearer", async () => {
    const { token: other } = await world.addSession('read');
    const client = await legacyClient(world.url, token);
    const protocolSession = client.sessionId() ?? '';
    try {
      expect(protocolSession).not.toBe('');
      const borrowed = await post(other, list, { 'mcp-session-id': protocolSession });
      expect(borrowed.status).toBe(404);
      const ended = await fetch(world.url, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${other}`, 'mcp-session-id': protocolSession },
      });
      expect(ended.status).toBe(404);
      // Still the owner's: neither request touched it.
      expect((await post(token, list, { 'mcp-session-id': protocolSession })).status).toBe(200);
    } finally {
      await client.close().catch(() => undefined);
    }
  });
});

describe('where the bearer may come from', () => {
  it('is only the Authorization header, as a Bearer', async () => {
    const query = await fetch(`${world.url}?access_token=${token}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(list),
    });
    // The path is /mcp; a token in the query is not a bearer.
    expect(query.status).toBe(401);
    const basic = await post(null, list, {
      authorization: `Basic ${Buffer.from(`x:${token}`).toString('base64')}`,
    });
    expect(basic.status).toBe(401);
    expect((await post(null, list, { cookie: `token=${token}` })).status).toBe(401);
    expect((await post(null, list, { 'x-api-key': token })).status).toBe(401);
    // A bearer with more after it is not a bearer.
    expect((await post(null, list, { authorization: `Bearer ${token} ${token}` })).status).toBe(401);
  });
});

describe('Hosts that only look like loopback', () => {
  it.each([
    'PORT',
    '127.0.0.1:PORT.evil.example',
    '127.0.0.1.:PORT',
    'evil.example@127.0.0.1:PORT',
    '127.0.0.1:PORT@evil.example',
    '[::1]:PORT',
    '127.0.0.2:PORT',
  ])('Host %s → 403 or 400', async (host) => {
    const reply = await raw(
      `POST /mcp HTTP/1.1\r\nHost: ${host.replace('PORT', String(world.port))}\r\n` +
        'Content-Type: application/json\r\nAccept: application/json, text/event-stream\r\n' +
        `Authorization: Bearer ${token}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}`,
      2_000,
    );
    expect(reply.reply).toMatch(/^HTTP\/1\.1 (403|400) /);
  });
});

describe('2026-07-28 headers that disagree with the body', () => {
  it('are refused before anything runs', async () => {
    const before = world.state.slots.get(2);
    const call = {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'timeline_swapClip',
        arguments: { projectId: world.projectId, slot: 2, clipId: 'clip-z' },
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': { name: 'attacker', version: '1' },
        },
      },
    };
    const modern = { 'mcp-protocol-version': '2026-07-28' };
    for (const headers of [
      { ...modern, 'mcp-method': 'tools/list' },
      { ...modern, 'mcp-method': 'tools/call', 'mcp-name': 'taalcut_history' },
      modern,
    ]) {
      const reply = await post(token, call, headers);
      expect(reply.status).toBe(400);
    }
    expect(world.state.slots.get(2)).toBe(before);
  });
});

describe('the log', () => {
  it('keeps one bounded line per request whatever the client names its method or tool', async () => {
    const before = world.logs.length;
    const forged = `tools/list\n[mcp] ${'x'.repeat(26)} tools/call render_export 200 1ms`;
    await post(token, { jsonrpc: '2.0', id: 7, method: forged, params: {} });
    await post(token, {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: `a\r\n[mcp] forged ${'y'.repeat(5_000)}`, arguments: {} },
    });
    await post(token, { jsonrpc: '2.0', id: 9, method: 'm'.repeat(100_000), params: {} });
    const lines = world.logs.slice(before);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line).not.toMatch(/[\r\n]/);
      expect(line.length).toBeLessThan(200);
    }
  });

  it('keeps one line per request for ids, params and names the SDK might echo', async () => {
    const before = world.logs.length;
    const forged = `1\n[mcp] ${'x'.repeat(26)} tools/call render_export 200 1ms`;
    // Responses to requests the server never sent, a batch, malformed params and a foreign JSON-RPC version.
    await post(token, { jsonrpc: '2.0', id: forged, result: {} });
    await post(token, { jsonrpc: '2.0', id: forged, error: { code: 1, message: `boom\r\n${forged}` } });
    await post(token, [{ jsonrpc: '2.0', id: forged, result: {} }]);
    await post(token, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: forged });
    await post(token, { jsonrpc: '1.0', id: 3, method: forged, [forged]: forged });
    await post(token, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: forged, arguments: forged },
    });
    const lines = world.logs.slice(before);
    expect(lines).toHaveLength(6);
    for (const line of lines) {
      expect(line).toMatch(/^\[mcp\] /);
      expect(line).not.toMatch(/[\r\n]/);
      expect(line.length).toBeLessThan(200);
    }
  });
});

describe('a local process without a bearer', () => {
  it("can't hold a socket open by sending its body slowly", async () => {
    // Headers and the first byte of a large body; the rest never comes.
    const reply = await raw(
      `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${world.port}\r\nContent-Type: application/json\r\n` +
        'Accept: application/json, text/event-stream\r\nContent-Length: 900000\r\n\r\n{',
      3_000,
    );
    reply.socket.destroy();
    expect(reply.reply).toMatch(/^HTTP\/1\.1 401 /);
    expect(reply.closed).toBe(true);
  });
});

describe('a DELETE with a body', () => {
  it("can't hold the socket after its answer by sending that body slowly", async () => {
    // A bearer, a protocol session id and a large declared body; only its first byte comes.
    const reply = await raw(
      `DELETE /mcp HTTP/1.1\r\nHost: 127.0.0.1:${world.port}\r\nAuthorization: Bearer ${token}\r\n` +
        'Mcp-Session-Id: not-a-session\r\nContent-Length: 900000\r\n\r\n{',
      3_000,
    );
    reply.socket.destroy();
    expect(reply.reply).toMatch(/^HTTP\/1\.1 404 /);
    expect(reply.closed).toBe(true);
  });
});

describe('refusals on one kept-alive connection', () => {
  it("don't pile listeners up on its socket", async () => {
    const warnings: string[] = [];
    const onWarning = (warning: Error): void => void warnings.push(warning.name);
    process.on('warning', onWarning);
    try {
      const request =
        `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${world.port}\r\nContent-Type: application/json\r\n` +
        'Accept: application/json, text/event-stream\r\nContent-Length: 2\r\n\r\n{}';
      const reply = await raw(request.repeat(12), 2_000);
      reply.socket.destroy();
      expect(reply.reply.match(/HTTP\/1\.1 401 /g)).toHaveLength(12);
      // Node reports a listener pile-up as a process warning, on a later tick.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(warnings).not.toContain('MaxListenersExceededWarning');
    } finally {
      process.off('warning', onWarning);
    }
  });
});

describe('a session sending its body slowly', () => {
  it('loses the socket once the request takes longer than the request timeout', async () => {
    const slow = await createWorld({
      limits: { ...MCP_LIMITS, headersTimeoutMs: 500, requestTimeoutMs: 1_000 },
    });
    try {
      const { token: own } = await slow.addSession('read');
      const reply = await raw(
        `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:${slow.port}\r\nContent-Type: application/json\r\n` +
          `Accept: application/json, text/event-stream\r\nAuthorization: Bearer ${own}\r\n` +
          'Content-Length: 900000\r\n\r\n{',
        4_000,
        slow.port,
      );
      reply.socket.destroy();
      expect(reply.closed).toBe(true);
      expect(reply.reply).toMatch(/^HTTP\/1\.1 408 /);
    } finally {
      await slow.close();
    }
  });
});
