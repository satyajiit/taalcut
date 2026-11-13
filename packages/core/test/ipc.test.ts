// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IPC contract tests (P1-C3): request and response, streaming, cancellation
 * and schema rejection, over a real MessagePort pair.
 */
import { describe, expect, it } from 'vitest';
import {
  callRpc,
  connectRpc,
  fromRpcError,
  serveRpc,
  themeContract,
  toRpcError,
  type TaalcutError,
} from '@taalcut/core';
import { createFakeTheme, probeContract, probeRouter, themeRouter, type ProbeLog } from './helpers/fixtures';
import { channel, tick } from './helpers/ports';

/** Between Taalcut's processes errors keep their developer detail; to a page they don't (see the last test). */
function connectTheme() {
  const theme = createFakeTheme('dark');
  const { port1, port2 } = channel();
  serveRpc(themeRouter(theme), port1, { context: {}, exposeDetail: true });
  return { theme, ...connectRpc(themeContract, port2, { peer: 'main' }) };
}

function connectProbe(exposeDetail = true) {
  const log: ProbeLog = { aborted: 0, streamsClosed: 0 };
  const { port1, port2 } = channel();
  const server = serveRpc(probeRouter(log), port1, { context: {}, exposeDetail });
  const connection = connectRpc(probeContract, port2, { peer: 'agent' });
  return { log, server, connection, client: connection.client };
}

async function rejection(promise: Promise<unknown>): Promise<TaalcutError> {
  const result = await callRpc(promise);
  if (result.ok) throw new Error('Expected the call to fail');
  return result.error;
}

describe('IPC: request and response', () => {
  it('gets and sets the theme through the typed contract', async () => {
    const { client } = connectTheme();
    expect(await client.get()).toEqual({ preference: 'system', resolved: 'dark' });
    expect(await client.set({ preference: 'light' })).toEqual({ preference: 'light', resolved: 'light' });
    expect(await callRpc(client.get())).toEqual({
      ok: true,
      value: { preference: 'light', resolved: 'light' },
    });
  });

  it('carries a TaalcutError across unchanged: code, key, params, fix, retryable', async () => {
    const { client } = connectProbe();
    const error = await rejection(client.fail({ kind: 'result' }));
    expect(error).toEqual({
      code: 'test.ipc_disk_full',
      messageKey: 'errors.test.ipc_disk_full',
      retryable: false,
      params: { path: '/Volumes/X' },
      fix: { command: 'settings.openStorage', labelKey: 'fix.freeSpace' },
      detail: 'ENOSPC',
    });
  });

  it('turns a thrown bug or a bad output into core.unknown, not a crash', async () => {
    const { client } = connectProbe();
    const thrown = await rejection(client.fail({ kind: 'throw' }));
    expect(thrown.code).toBe('core.unknown');
    expect(thrown.detail).toBe('TypeError');
    const badOutput = await rejection(client.fail({ kind: 'output' }));
    expect(badOutput.code).toBe('core.unknown');
    expect(badOutput.detail).toMatch(/Output validation failed/);
  });
});

describe('IPC: developer detail', () => {
  it("doesn't send an error's detail unless the server keeps it (pages never get it)", async () => {
    const { client } = connectProbe(false);
    const error = await rejection(client.fail({ kind: 'result' }));
    expect(error).toEqual({
      code: 'test.ipc_disk_full',
      messageKey: 'errors.test.ipc_disk_full',
      retryable: false,
      params: { path: '/Volumes/X' },
      fix: { command: 'settings.openStorage', labelKey: 'fix.freeSpace' },
    });
    const thrown = await rejection(client.fail({ kind: 'throw' }));
    expect(thrown).toMatchObject({ code: 'core.unknown' });
    expect(thrown.detail).toBeUndefined();
  });
});

describe('IPC: schema rejection', () => {
  it('rejects a bad payload with a typed core.validation error and keeps serving', async () => {
    const { client } = connectTheme();
    const error = await rejection(client.set({ preference: 'purple' as never }));
    expect(error.code).toBe('core.validation');
    expect(error.params).toEqual({ field: 'preference' });
    expect(error.detail).toMatch(/^preference: /);
    const missing = await rejection(client.set(undefined as never));
    expect(missing.code).toBe('core.validation');
    expect(await client.get()).toEqual({ preference: 'system', resolved: 'dark' });
  });
});

describe('IPC: streaming', () => {
  it('streams the current theme, then each change, and stops the producer when the reader stops', async () => {
    const { client, theme } = connectTheme();
    const seen: string[] = [];
    const stream = await client.changed();
    setTimeout(() => theme.set('light'), 5);
    for await (const state of stream) {
      seen.push(`${state.preference}/${state.resolved}`);
      if (seen.length === 2) break;
    }
    expect(seen).toEqual(['system/dark', 'light/light']);
    await tick(20);
    expect(theme.listenerCount).toBe(0);
  });

  it('delivers a stream error as a TaalcutError after the values sent before it', async () => {
    const { client, log } = connectProbe();
    const seen: number[] = [];
    let failure: TaalcutError | undefined;
    try {
      for await (const n of await client.count({ to: 4 })) seen.push(n);
    } catch (cause) {
      failure = fromRpcError(cause);
    }
    expect(seen).toEqual([1, 2, 3]);
    expect(failure?.code).toBe('test.ipc_disk_full');
    expect(log.streamsClosed).toBe(1);
  });
});

describe('IPC: cancellation', () => {
  it('propagates an AbortSignal to the handler and rejects the call with core.cancelled', async () => {
    const { client, log } = connectProbe();
    const controller = new AbortController();
    const pending = callRpc(client.hang(undefined, { signal: controller.signal }));
    await tick(10);
    controller.abort();
    const result = await pending;
    expect(!result.ok && result.error.code).toBe('core.cancelled');
    await tick(10);
    expect(log.aborted).toBe(1);
  });

  it('cancels a stream mid-way and runs the producer clean-up', async () => {
    const { client, log } = connectProbe();
    const controller = new AbortController();
    const seen: number[] = [];
    const reading = (async () => {
      for await (const n of await client.count({ to: 1000 }, { signal: controller.signal })) {
        seen.push(n);
        if (n === 3) controller.abort();
      }
    })();
    expect(fromRpcError(await reading.catch((cause: unknown) => cause)).code).toBe('core.cancelled');
    await tick(20);
    expect(seen.length).toBeLessThan(10);
    expect(log.streamsClosed).toBe(1);
  });

  it('fails pending and later calls fast when the server side goes away', async () => {
    const { client, server } = connectProbe();
    const pending = callRpc(client.hang());
    await tick(10);
    server.close();
    const result = await pending;
    expect(!result.ok && result.error).toMatchObject({
      code: 'core.process_restarted',
      params: { process: 'agent' },
    });
    const later = await callRpc(client.hang());
    expect(!later.ok && later.error.code).toBe('core.process_restarted');
  });

  it('reports core.cancelled for calls on a connection closed from this side', async () => {
    const { connection } = connectProbe();
    connection.close();
    connection.close();
    expect(connection.closed).toBe(true);
    const result = await callRpc(connection.client.hang());
    expect(!result.ok && result.error.code).toBe('core.cancelled');
  });
});

describe('IPC: error mapping', () => {
  it('maps every rejection to a TaalcutError', async () => {
    const { ORPCError } = await import('@orpc/client');
    expect(fromRpcError(toRpcError({ code: 'x.y', messageKey: 'errors.x.y', retryable: true }))).toEqual({
      code: 'x.y',
      messageKey: 'errors.x.y',
      retryable: true,
    });
    expect(fromRpcError(new ORPCError('BAD_REQUEST', { message: 'Malformed' })).code).toBe('core.validation');
    expect(fromRpcError(new ORPCError('NOT_FOUND')).code).toBe('core.not_found');
    expect(fromRpcError(new ORPCError('TIMEOUT')).detail).toMatch(/^TIMEOUT/);
    expect(fromRpcError(new DOMException('stop', 'AbortError')).code).toBe('core.cancelled');
    expect(fromRpcError('weird').code).toBe('core.unknown');
  });
});
