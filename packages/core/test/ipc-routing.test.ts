// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Routing tests: renderer → main → utility process, as in the desktop app.
 * Renderer↔main uses a DOM-style port (addEventListener); main↔utility uses
 * MessagePortMain-style ports (EventEmitter, queued until start()).
 */
import { describe, expect, it } from 'vitest';
import {
  adaptPort,
  callRpc,
  connectRpc,
  forwardTo,
  fromRpcError,
  implementContract,
  serveRpc,
  themeContract,
  type RpcConnection,
} from '@taalcut/core';
import { createFakeTheme, probeContract, probeRouter, themeRouter, type ProbeLog } from './helpers/fixtures';
import { channel, mainChannel, tick } from './helpers/ports';

const appContract = { theme: themeContract, probe: probeContract };

function startUtility() {
  const log: ProbeLog = { aborted: 0, streamsClosed: 0 };
  const { port1, port2 } = mainChannel();
  const server = serveRpc(probeRouter(log), port1, { context: {}, exposeDetail: true });
  const connection = connectRpc(probeContract, port2, { peer: 'agent' });
  return { log, server, connection };
}

function startApp() {
  let utility = startUtility();
  const theme = createFakeTheme('light');
  const os = implementContract(appContract);
  const mainRouter = os.router({
    theme: themeRouter(theme),
    probe: forwardTo(probeContract, () => utility.connection.client),
  });
  const { port1, port2 } = channel();
  serveRpc(mainRouter, port1, { context: { caller: 'renderer' } });
  const renderer: RpcConnection<typeof appContract> = connectRpc(appContract, port2, { peer: 'main' });
  return {
    renderer: renderer.client,
    get utility() {
      return utility;
    },
    restartUtility() {
      utility = startUtility();
    },
  };
}

describe('IPC routing through main', () => {
  it('serves main-owned namespaces locally and forwards the rest', async () => {
    const app = startApp();
    expect(await app.renderer.theme.get()).toEqual({ preference: 'system', resolved: 'light' });
    const error = fromRpcError(
      await app.renderer.probe.fail({ kind: 'result' }).catch((cause: unknown) => cause),
    );
    expect(error).toMatchObject({ code: 'test.ipc_disk_full', params: { path: '/Volumes/X' } });
    // The utility process sent it to main; main doesn't pass it on to the page.
    expect(error.detail).toBeUndefined();
  });

  it('rejects a bad payload in main before it reaches the utility process', async () => {
    const app = startApp();
    const result = await callRpc(app.renderer.probe.fail({ kind: 'nope' as never }));
    expect(!result.ok && result.error).toMatchObject({ code: 'core.validation', params: { field: 'kind' } });
  });

  it('streams across two hops and cancels the producer in the utility process', async () => {
    const app = startApp();
    const controller = new AbortController();
    const seen: number[] = [];
    const reading = (async () => {
      for await (const n of await app.renderer.probe.count({ to: 1000 }, { signal: controller.signal })) {
        seen.push(n);
        if (n === 3) controller.abort();
      }
    })();
    expect(fromRpcError(await reading.catch((cause: unknown) => cause)).code).toBe('core.cancelled');
    await tick(30);
    expect(seen.slice(0, 3)).toEqual([1, 2, 3]);
    expect(app.utility.log.streamsClosed).toBe(1);
  });

  it('propagates an AbortSignal from the renderer to the handler in the utility process', async () => {
    const app = startApp();
    const controller = new AbortController();
    const pending = callRpc(app.renderer.probe.hang(undefined, { signal: controller.signal }));
    await tick(10);
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    await tick(20);
    expect(app.utility.log.aborted).toBe(1);
  });

  it('fails in-flight calls with core.process_restarted when the utility dies, then uses the new one', async () => {
    const app = startApp();
    const pending = callRpc(app.renderer.probe.hang());
    await tick(10);
    app.utility.server.close();
    expect(await pending).toMatchObject({
      ok: false,
      error: { code: 'core.process_restarted', retryable: true, params: { process: 'agent' } },
    });
    app.restartUtility();
    const error = fromRpcError(
      await app.renderer.probe.fail({ kind: 'result' }).catch((cause: unknown) => cause),
    );
    expect(error.code).toBe('test.ipc_disk_full');
  });
});

describe('adaptPort', () => {
  it('starts a MessagePortMain-style port only when someone listens, and reports closing once', async () => {
    const { port1, port2 } = mainChannel();
    const a = adaptPort(port1);
    const b = adaptPort(port2);
    const received: unknown[] = [];
    b.port.on('message', (event) => received.push(event?.data));
    a.port.postMessage({ hello: 1 });
    await tick(10);
    expect(received).toEqual([{ hello: 1 }]);

    let closes = 0;
    const off = b.onClose(() => (closes += 1));
    const offOther = b.onClose(() => (closes += 100));
    offOther();
    a.close();
    a.close();
    await tick(10);
    expect([a.closed, a.closedLocally, b.closed, b.closedLocally]).toEqual([true, true, true, false]);
    expect(closes).toBe(1);
    off();

    let lateClose = 0;
    b.onClose(() => (lateClose += 1));
    b.port.on('close', () => (lateClose += 1));
    b.port.on('message', () => (lateClose += 1000));
    b.port.postMessage('ignored after close');
    expect(lateClose).toBe(2);
  });
});
