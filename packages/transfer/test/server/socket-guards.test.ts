// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The listener's two socket guards (security review SB-17), with raw sockets on loopback. */
import type { AddressInfo } from 'node:net';
import { connect, type Socket } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { closeListener, createListener } from '../../src/http/bind';
import { TRANSFER_LIMITS } from '../../src/limits';

let server: Server | null = null;
const sockets: Socket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
  closeListener(server);
  server = null;
});

/** A handler that reads every body to the end and then answers, as tus does. */
async function listen(windowMs: number, minBytes: number): Promise<number> {
  server = await createListener(
    '127.0.0.1',
    0,
    (req, res) => {
      req.resume();
      req.on('end', () => res.end('ok'));
    },
    { windowMs, minBytes },
  );
  return (server.address() as AddressInfo).port;
}

function open(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => resolve(socket));
    socket.once('error', reject);
    sockets.push(socket);
  });
}

const closed = (socket: Socket) => new Promise<void>((resolve) => socket.once('close', () => resolve()));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function startUpload(socket: Socket, port: number): void {
  socket.write(
    `PATCH /files/x HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Length: 1000000\r\n` +
      'Content-Type: application/offset+octet-stream\r\n\r\n',
  );
}

describe('the LAN listener socket guards (SB-17)', () => {
  it('cuts a body that trickles in slower than the floor', async () => {
    const port = await listen(100, 1024);
    const socket = await open(port);
    startUpload(socket, port);
    const started = Date.now();
    const trickle = setInterval(() => socket.writable && socket.write('x'), 20);
    await closed(socket);
    clearInterval(trickle);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('keeps a body that arrives above the floor, to the end', async () => {
    const port = await listen(100, 1024);
    const socket = await open(port);
    let answer = '';
    socket.on('data', (chunk: Buffer) => (answer += chunk.toString()));
    startUpload(socket, port);
    for (let sent = 0; sent < 1_000_000; sent += 50_000) {
      socket.write(Buffer.alloc(50_000));
      await sleep(10);
    }
    await expect.poll(() => answer, { timeout: 2_000 }).toContain('200 OK');
    expect(socket.destroyed).toBe(false);
  });

  it('lets one address hold at most maxSocketsPerAddress sockets', async () => {
    const port = await listen(30_000, 1);
    const held = await Promise.all(
      Array.from({ length: TRANSFER_LIMITS.maxSocketsPerAddress }, () => open(port)),
    );
    const extra = await open(port);
    await closed(extra);
    expect(held.every((socket) => !socket.destroyed)).toBe(true);
    // A socket that closes frees its place.
    held[0]?.destroy();
    await sleep(50);
    const again = await open(port);
    await sleep(50);
    expect(again.destroyed).toBe(false);
  });
});
