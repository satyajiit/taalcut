// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createListener } from '../../src/http/bind';
import { selfTestPing } from '../../src/http/self-test';
import { TRANSFER_LIMITS } from '../../src/limits';
import { httpCall, startFixture, untilRefused, type Fixture } from '../support/harness';
import { pairPhone, tokenOf } from '../support/upload';

describe('transfer server lifecycle', () => {
  let fx: Fixture | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    await fx?.dispose();
    fx = undefined;
  });

  it('answers ping while the session is open and refuses connections after close', async () => {
    fx = await startFixture();
    const ping = await httpCall({ host: fx.address, port: fx.port, path: '/api/ping' });
    expect(ping.status).toBe(204);
    const closed = await fx.close();
    expect(closed.closed).toBe(true);
    await untilRefused(fx.address, fx.port);
  });

  it('refuses connections after the open stream is cancelled', async () => {
    fx = await startFixture();
    const { address, port } = fx;
    await fx.release();
    await untilRefused(address, port);
  });

  it('stops the first session when a second one opens', async () => {
    fx = await startFixture();
    const firstPort = fx.port;
    const firstId = fx.sessionId;
    const firstToken = tokenOf(fx.pairing.qrText);
    await fx.replace();
    expect(fx.sessionId).not.toBe(firstId);
    const replaced = fx.items.find(
      (item) =>
        item.type === 'session' && item.session.id === firstId && item.session.stopReason === 'replaced',
    );
    expect(replaced).toBeDefined();
    if (fx.port !== firstPort) await untilRefused(fx.address, firstPort);
    else {
      const stale = await pairPhone(fx, { token: firstToken, pin: '000000' });
      expect(stale.status).toBe(401);
    }
    const ping = await httpCall({ host: fx.address, port: fx.port, path: '/api/ping' });
    expect(ping.status).toBe(204);
  });

  it('stops on the idle timer without a phone', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fx = await startFixture();
    const { address, port } = fx;
    await vi.advanceTimersByTimeAsync(TRANSFER_LIMITS.idleMs);
    const stopped = await fx.waitFor((item) => item.type === 'session' && item.session.stopReason === 'idle');
    expect(stopped.type === 'session' && stopped.session.state).toBe('stopped');
    vi.useRealTimers();
    await untilRefused(address, port);
  });

  it('keeps desktop reception open past idle expiry until explicitly stopped', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fx = await startFixture({ keepReceptionOpen: true });
    const session = fx.items.find((item) => item.type === 'session' && item.session.state === 'listening');
    expect(session?.type === 'session' && session.session.idleStopAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(TRANSFER_LIMITS.idleMs * 3);
    expect(fx.items.some((item) => item.type === 'session' && item.session.state === 'stopped')).toBe(false);
    vi.useRealTimers();
    expect((await httpCall({ host: fx.address, port: fx.port, path: '/api/ping' })).status).toBe(204);
    expect((await fx.close()).closed).toBe(true);
    await untilRefused(fx.address, fx.port);
  });

  it('rebinds the same port and secrets when the address changes', async () => {
    const second = '127.0.0.2';
    const realSecond = await canBind(second);
    fx = await startFixture(realSecond ? {} : { bind: standInBind });
    const pin = fx.pairing.pin;
    const idleStopAt = fx.items.find((item) => item.type === 'session' && item.session.state === 'listening');
    const port = fx.port;
    fx.setAddress(second);
    fx.pokeNetwork();
    const rebound = await fx.waitFor(
      (item) => item.type === 'session' && item.session.url === `http://${second}:${port}`,
    );
    expect(rebound.type === 'session' && rebound.pairing?.pin).toBe(pin);
    if (idleStopAt?.type === 'session')
      expect(rebound.type === 'session' && rebound.session.idleStopAt).toBe(idleStopAt.session.idleStopAt);
    await untilRefused('127.0.0.1', port);
    if (realSecond) {
      const ping = await httpCall({ host: second, port, path: '/api/ping' });
      expect(ping.status).toBe(204);
    }
  });

  it('records self-test outcomes from the connector', async () => {
    for (const reachable of ['yes', 'blocked', 'local-network-denied'] as const) {
      const session = await startFixture({ selfTest: async () => reachable });
      try {
        const item = session.items.find(
          (entry) => entry.type === 'session' && entry.session.state === 'listening',
        );
        expect(item?.type === 'session' && item.session.network?.reachable).toBe(reachable);
      } finally {
        await session.dispose();
      }
    }
  });

  it('maps a live ping to yes and a silent socket to blocked', async () => {
    fx = await startFixture();
    await expect(selfTestPing(fx.address, fx.port, 500)).resolves.toBe('yes');
    const silent = createServer(() => undefined);
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', () => resolve()));
    const address = silent.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await expect(selfTestPing('127.0.0.1', port, 40)).resolves.toBe('blocked');
    silent.closeAllConnections();
    silent.close();
  });

  it('stops with no-network when nothing bindable is offered', async () => {
    fx = await startFixture({
      expectListening: false,
      candidates: () => [
        { name: 'en0', address: '0.0.0.0' },
        { name: 'en1', address: '8.8.8.8' },
      ],
    });
    const item = fx.items.find((entry) => entry.type === 'session');
    expect(item?.type === 'session' && item.session.stopReason).toBe('no-network');
  });

  it('stops with originals-offline when the staging volume is unplugged', async () => {
    fx = await startFixture({
      expectListening: false,
      staging: async () => ({
        ok: false,
        error: {
          code: 'library.originals_offline',
          messageKey: 'errors.library.originals_offline',
          retryable: false,
        },
      }),
    });
    const item = fx.items.find((entry) => entry.type === 'session');
    expect(item?.type === 'session' && item.session.stopReason).toBe('originals-offline');
  });
});

/** This Mac often has no 127.0.0.2 alias. The stand-in still exercises the rebind. */
function canBind(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(0, host, () => {
      server.close(() => resolve(true));
    });
  });
}

function standInBind(
  address: string,
  port: number,
  handler: (req: IncomingMessage, res: ServerResponse) => void,
) {
  if (address === '127.0.0.1') return createListener(address, port, handler);
  return new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
    const server = createServer(handler);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
