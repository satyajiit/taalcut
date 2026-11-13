// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B10: the network recorder wraps every way this process reaches the network, records each attempt with
 * its host, port and stack, lets loopback through and refuses the rest (models SPEC P3.6). Refused hosts are
 * from the documentation ranges and never resolve, so nothing here touches the network.
 */
import dgram from 'node:dgram';
import dns from 'node:dns';
import http, { request as namedRequest } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import tls from 'node:tls';
import { afterEach, describe, expect, it } from 'vitest';
import { NetworkBlockedError, recordNetwork, type NetworkRecorder } from '@taalcut/models/test-support';

const FAR = '192.0.2.10';
let recorder: NetworkRecorder | undefined;

afterEach(() => {
  recorder?.restore();
  recorder = undefined;
});

const errorOf = (emitter: NodeJS.EventEmitter) =>
  new Promise<unknown>((resolve) => emitter.once('error', resolve));

async function localServer() {
  const server = http.createServer((_req, res) => res.end('ok'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { port, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

describe('recordNetwork', () => {
  it('refuses a TCP connect off this Mac, with its host, port and the stack that made it', async () => {
    recorder = recordNetwork();
    const socket = net.connect({ host: FAR, port: 9 });
    const error = await errorOf(socket);
    expect(error).toBeInstanceOf(NetworkBlockedError);
    expect(recorder.blocked()).toEqual([
      expect.objectContaining({ api: 'net.connect', host: FAR, port: 9, allowed: false }),
    ]);
    expect(recorder.blocked()[0]?.stack).toContain('network-recorder.test.ts');
  });

  it('lets loopback through, recorded as allowed', async () => {
    const server = await localServer();
    recorder = recordNetwork();
    const answer = await new Promise<string>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${server.port}/`, (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => (body += chunk.toString()));
          res.on('end', () => resolve(body));
        })
        .on('error', reject);
    });
    expect(answer).toBe('ok');
    expect(recorder.blocked()).toEqual([]);
    expect(recorder.attempts).toEqual([
      expect.objectContaining({ api: 'http.request', host: '127.0.0.1', port: server.port, allowed: true }),
    ]);
    expect((await fetch(`http://localhost:${server.port}/`)).status).toBe(200);
    await server.close();
  });

  it('records an HTTP, HTTPS or TLS request once, under its own API, and fails it as a network error', async () => {
    recorder = recordNetwork();
    const plain = http.request(`http://${FAR}:8080/x`);
    const secure = https.request({ hostname: 'example.invalid', path: '/' });
    const direct = tls.connect({ host: FAR, port: 443 });
    // An ESM named import of the built-in sees the wrapper too.
    const named = namedRequest({ host: FAR, port: 81 });
    const errors = [plain, secure, direct, named].map(errorOf);
    for (const request of [plain, secure, named]) request.end();
    for (const error of await Promise.all(errors)) expect(error).toBeInstanceOf(NetworkBlockedError);
    expect(recorder.blocked().map((a) => [a.api, a.host, a.port])).toEqual([
      ['http.request', FAR, 8080],
      ['https.request', 'example.invalid', 443],
      ['tls.connect', FAR, 443],
      ['http.request', FAR, 81],
    ]);
  });

  it('refuses DNS lookups of other hosts, by callback and by promise; localhost resolves', async () => {
    recorder = recordNetwork();
    const viaCallback = await new Promise<unknown>((resolve) =>
      dns.lookup('example.com', (error) => resolve(error)),
    );
    expect(viaCallback).toBeInstanceOf(NetworkBlockedError);
    await expect(dns.promises.lookup('example.org')).rejects.toBeInstanceOf(NetworkBlockedError);
    expect((await dns.promises.lookup('localhost')).address).toMatch(/^(127\.0\.0\.1|::1)$/);
    expect(recorder.blocked().map((a) => [a.api, a.host])).toEqual([
      ['dns.lookup', 'example.com'],
      ['dns.lookup', 'example.org'],
    ]);
  });

  it('refuses datagrams off this Mac and sends them on loopback', async () => {
    recorder = recordNetwork();
    const socket = dgram.createSocket('udp4');
    const refused = await new Promise<unknown>((resolve) =>
      socket.send('x', 9, FAR, (error) => resolve(error)),
    );
    expect(refused).toBeInstanceOf(NetworkBlockedError);
    const sent = await new Promise<unknown>((resolve) => socket.send('x', 0, 1, 9, '127.0.0.1', resolve));
    expect(sent).toBeNull();
    socket.close();
    // A send on an unbound socket binds first and sends again: the allowed one may show twice.
    const unique = new Set(recorder.attempts.map((a) => `${a.api} ${a.host}:${a.port} ${a.allowed}`));
    expect([...unique]).toEqual([`dgram.send ${FAR}:9 false`, 'dgram.send 127.0.0.1:9 true']);
  });

  it('refuses fetch and WebSocket off this Mac', async () => {
    recorder = recordNetwork();
    await expect(fetch('https://example.com/data')).rejects.toBeInstanceOf(NetworkBlockedError);
    expect(() => new WebSocket('wss://example.com/socket')).toThrow(NetworkBlockedError);
    expect(recorder.blocked().map((a) => [a.api, a.host, a.port])).toEqual([
      ['fetch', 'example.com', 443],
      ['WebSocket', 'example.com', 443],
    ]);
  });

  it('allows exactly the hosts it is given, reports each attempt as it happens, and leaves pipes alone', async () => {
    const seen: string[] = [];
    // Loopback isn't on this list. 0.0.0.0 is: a connect there stays on this Mac (and is refused at once).
    recorder = recordNetwork({ allow: ['0.0.0.0'], onAttempt: (a) => seen.push(`${a.host} ${a.allowed}`) });
    await expect(fetch('http://127.0.0.1:9/')).rejects.toBeInstanceOf(NetworkBlockedError);
    const other = net.connect({ host: '0.0.0.0', port: 9 });
    expect(await errorOf(other)).not.toBeInstanceOf(NetworkBlockedError);
    const pipe = net.connect({ path: '/tmp/taalcut-no-such.sock' });
    expect(await errorOf(pipe)).not.toBeInstanceOf(NetworkBlockedError);
    expect(seen).toEqual(['127.0.0.1 false', '0.0.0.0 true']);
  });

  it('puts every wrapped function back', () => {
    const before = [
      net.Socket.prototype.connect,
      tls.connect,
      http.request,
      http.get,
      https.request,
      https.get,
      dns.lookup,
      dns.promises.lookup,
      dgram.Socket.prototype.send,
      dgram.Socket.prototype.connect,
      globalThis.fetch,
      globalThis.WebSocket,
    ];
    recordNetwork().restore();
    expect([
      net.Socket.prototype.connect,
      tls.connect,
      http.request,
      http.get,
      https.request,
      https.get,
      dns.lookup,
      dns.promises.lookup,
      dgram.Socket.prototype.send,
      dgram.Socket.prototype.connect,
      globalThis.fetch,
      globalThis.WebSocket,
    ]).toEqual(before);
  });
});
