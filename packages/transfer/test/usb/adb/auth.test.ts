// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The debugging Allow prompt, a busy interface, and what happens when authentication fails. */
import { AdbDaemonWebUsbDevice } from '@yume-chan/adb-daemon-webusb';
import { describe, expect, it } from 'vitest';
import { AdbAllowPending, authenticateDaemon, connectAdbTransport } from '../../../src/bridges/adb/transport';
import { createFakeConnection } from './fake-connection';
import { createFakeAdb } from './fake-transport';
import { abort, adbBridge, FILES, hashOf, keys, listAll, REF, ROWS, USB_INFO } from './fixtures';

describe('adb bridge access', () => {
  it('uses the adb server once when the interface is busy', async () => {
    const fake = createFakeAdb({ files: FILES, content: 'fail' });
    let claims = 0;
    const transport = await connectAdbTransport(USB_INFO, abort(), keys, {
      claim: () => {
        claims += 1;
        throw new AdbDaemonWebUsbDevice.DeviceBusyError();
      },
      server: () => Promise.resolve(fake.transport),
    });
    const bridge = adbBridge({ connect: () => Promise.resolve(transport) });
    const opened = await bridge.open(REF, abort());
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    try {
      const items = await listAll(opened.value);
      expect(items).toHaveLength(2);
    } finally {
      await opened.value.close();
    }
    expect(claims).toBe(1);
  });

  it('reports adb-server when the busy fallback also fails', async () => {
    let claims = 0;
    const bridge = adbBridge({
      connect: (device, signal) =>
        connectAdbTransport(device, signal, keys, {
          claim: () => {
            claims += 1;
            throw new AdbDaemonWebUsbDevice.DeviceBusyError();
          },
          server: () => Promise.reject(new Error('econnrefused')),
        }),
    });
    const opened = await bridge.open(REF, abort());
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.error.code).toBe('transfer.device_busy');
    expect(opened.error.detail).toBe('adb-server');
    expect(claims).toBe(1);
  });

  it('keeps a session open while the phone is waiting for Allow, and closing lets go of it', async () => {
    let cancelled = 0;
    const bridge = adbBridge({
      connect: () =>
        Promise.reject(
          new AdbAllowPending(new Promise(() => undefined), () => {
            cancelled += 1;
          }),
        ),
    });
    const opened = await bridge.open(REF, abort());
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.access()).toEqual({ state: 'needs-debugging-allow' });
    expect(opened.value.rangedReads).toBe(false);
    expect(await listAll(opened.value)).toEqual([]);
    expect(await hashOf(opened.value)('42', abort())).toMatchObject({
      ok: false,
      error: { detail: 'needs-debugging-allow' },
    });
    await opened.value.close();
    expect(cancelled).toBe(1);
  });

  it('becomes ready when Allow is tapped', async () => {
    const fake = createFakeAdb({ files: FILES, rows: ROWS, content: 'ok' });
    let allow: (transport: typeof fake.transport) => void = () => undefined;
    const whenReady = new Promise<typeof fake.transport>((resolve) => {
      allow = resolve;
    });
    const bridge = adbBridge({
      connect: () => Promise.reject(new AdbAllowPending(whenReady, () => undefined)),
    });
    const opened = await bridge.open(REF, abort());
    if (!opened.ok) throw new Error('open');
    const states: string[] = [];
    opened.value.onAccessChange((next) => states.push(next.state));
    allow(fake.transport);
    await whenReady;
    await Promise.resolve();
    expect(states).toEqual(['ready']);
    expect(await listAll(opened.value)).toHaveLength(2);
    await opened.value.close();
  });

  it('moves to not-trusted when the authentication fails after the prompt, and logs no serial', async () => {
    const lines: string[] = [];
    const failed = Promise.reject(new Error('Connection closed unexpectedly'));
    const bridge = adbBridge({
      connect: () => Promise.reject(new AdbAllowPending(failed, () => undefined)),
      log: { info: (line) => lines.push(line) },
    });
    const opened = await bridge.open({ ...REF, identity: 'SER123' }, abort());
    if (!opened.ok) throw new Error('open');
    await failed.catch(() => undefined);
    await Promise.resolve();
    expect(opened.value.access()).toEqual({ state: 'not-trusted' });
    expect(lines).toEqual(['usb adb auth failed adb']);
    expect(lines.join('\n')).not.toContain('SER123');
    await opened.value.close();
  });

  it('says unsupported when main cannot give the key after the prompt', async () => {
    const failed = Promise.reject(new Error('adb-key'));
    const bridge = adbBridge({ connect: () => Promise.reject(new AdbAllowPending(failed, () => undefined)) });
    const opened = await bridge.open(REF, abort());
    if (!opened.ok) throw new Error('open');
    await failed.catch(() => undefined);
    await Promise.resolve();
    expect(opened.value.access()).toEqual({ state: 'unsupported', reason: 'adb-key' });
    await opened.value.close();
  });
});

describe('adb daemon authentication', () => {
  it('a connection that closes before the prompt fails and lets go of the device', async () => {
    const fake = createFakeConnection();
    let released = 0;
    const pending = authenticateDaemon(fake.connection, 'SER123', keys, abort(), () => {
      released += 1;
    });
    fake.unplug();
    await expect(pending).rejects.toThrow('Connection closed unexpectedly');
    expect(released).toBe(1);
    expect(fake.sent[0]).toBe(0x4e584e43);
  });

  it('cancelling the open before the prompt lets go of the device', async () => {
    const fake = createFakeConnection();
    const controller = new AbortController();
    let released = 0;
    const pending = authenticateDaemon(fake.connection, 'SER123', keys, controller.signal, () => {
      released += 1;
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(released).toBe(1);
  });

  it('hands the prompt to the session, which owns the release from then on', async () => {
    const fake = createFakeConnection();
    const controller = new AbortController();
    let released = 0;
    const pending = authenticateDaemon(fake.connection, 'SER123', keys, controller.signal, () => {
      released += 1;
    });
    fake.token();
    fake.token();
    const thrown = await pending.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(AdbAllowPending);
    if (!(thrown instanceof AdbAllowPending)) return;
    // The open call is over: its signal no longer reaches the pending authentication.
    controller.abort();
    expect(released).toBe(0);
    fake.unplug();
    await expect(thrown.whenReady).rejects.toThrow('Connection closed unexpectedly');
    expect(released).toBe(1);
    thrown.cancel();
    expect(released).toBe(2);
  });
});
