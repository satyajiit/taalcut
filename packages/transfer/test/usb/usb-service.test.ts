// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The device service around the hub: a run outlives the Cable screen, streams
 * wake on abort and each sees every change, finished runs reach the bus with a
 * real-moving clock, thumbnails come back after the screen reopens, and one
 * device takes one run at a time.
 */
import { access, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEventBus,
  ok,
  type AssetId,
  type Clock,
  type DeviceRun,
  type DevicesState,
} from '@taalcut/core';
import type { TransferMedia } from '../../src/deps';
import type { DeviceBridge, DeviceItem, DeviceService } from '../../src/usb/bridge';
import { thumbDir } from '../../src/usb/thumbs';
import { createDeviceService } from '../../src/usb/usb-service';
import { createFakePhone, type FakePhone, type PhoneOptions } from './fake-phone';
import { createCopySink, untilTerminal } from './import-harness';

const dirs: string[] = [];
const selection = { filter: { onlyNew: true, timeZone: 'UTC' }, include: [], exclude: [] };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
/** No probe here: a JPEG body with no listed size or duration needs none. */
const media: TransferMedia = { probe: async () => ({ ok: false }) };

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface Rig {
  readonly service: DeviceService;
  readonly phone: FakePhone;
  readonly root: string;
  readonly stateDir: string;
  readonly runEvents: DeviceRun[];
  readonly watchSignals: AbortSignal[];
  thumbCalls(): number;
  imports(): number;
}

async function rig(count: number, options: PhoneOptions = {}, clock?: Clock): Promise<Rig> {
  const root = await mkdtemp(join(tmpdir(), 'usb-service-'));
  dirs.push(root);
  const staging = join(root, 'staging');
  const originals = join(root, 'originals');
  await mkdir(staging);
  await mkdir(originals);
  const copy = createCopySink(staging, originals, new Set<AssetId>());
  const phone = createFakePhone(files(count), options);
  const watchSignals: AbortSignal[] = [];
  let thumbCalls = 0;
  const bridge: DeviceBridge = {
    ...phone.bridge,
    watch(signal) {
      watchSignals.push(signal);
      return phone.bridge.watch(signal);
    },
    async open(ref, signal) {
      const opened = await phone.bridge.open(ref, signal);
      if (!opened.ok) return opened;
      return ok({
        ...opened.value,
        async thumbnail() {
          thumbCalls += 1;
          return ok(new Uint8Array(JPEG));
        },
      });
    },
  };
  const time = clock ?? { now: () => 1_700_000_000_000 };
  const events = createEventBus({ clock: time });
  const runEvents: DeviceRun[] = [];
  events.on('transfer.deviceRun', (event) => runEvents.push(event.payload));
  const stateDir = join(root, 'state');
  const service = createDeviceService({
    bridges: [bridge],
    watcher: phone.watcher,
    importSink: copy.sink,
    media,
    events,
    clock: time,
    stateDir,
    forgetAdbKey: async () => false,
  });
  return {
    service,
    phone,
    root,
    stateDir,
    runEvents,
    watchSignals,
    thumbCalls: () => thumbCalls,
    imports: () => copy.imports(),
  };
}

/** A Cable screen: the stream stays open until `close`, which returns the iterator like the router does. */
async function openScreen(
  service: DeviceService,
): Promise<{ readonly iter: AsyncIterator<DevicesState>; close(): Promise<void>; abort(): void }> {
  const stop = new AbortController();
  const iter = service.devices(stop.signal)[Symbol.asyncIterator]();
  const first = await iter.next();
  expect(first.done).toBe(false);
  return {
    iter,
    abort: () => stop.abort(),
    async close() {
      stop.abort();
      await iter.return?.(undefined);
    },
  };
}

async function untilKey(iter: AsyncIterator<DevicesState>): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const step = await iter.next();
    if (step.done) break;
    const found = step.value.devices.find((device) => device.connected && device.access === 'ready');
    if (found) return found.key;
  }
  throw new Error('phone did not connect');
}

async function settle(read: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await read()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('did not settle');
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('device service', () => {
  it('keeps importing after the Cable screen closes, then stops watching', async () => {
    const gate = Promise.withResolvers<void>();
    const { service, phone, watchSignals, imports } = await rig(5, {
      onPull: async (_id, index) => {
        if (index === 2) await gate.promise;
        return 'ok';
      },
    });
    const screen = await openScreen(service);
    phone.plug();
    const key = await untilKey(screen.iter);
    const life = new AbortController();
    expect((await service.openDevice(key, life.signal)).ok).toBe(true);
    const started = await service.importFromDevice({ deviceKey: key, selection }, life.signal);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    await settle(() => phone.pulls().length === 2);
    await screen.close();
    // The run holds the hub: its bridge watch is still live with no screen open.
    expect(watchSignals.some((signal) => !signal.aborted)).toBe(true);
    gate.resolve();
    const done = await untilTerminal(service, started.value.runId, life.signal);
    expect(done.state).toBe('succeeded');
    expect(done.totals.imported).toBe(5);
    expect(imports()).toBe(5);
    await settle(() => watchSignals.length > 0 && watchSignals.every((signal) => signal.aborted));
    life.abort();
  });

  it('ends a waiting stream as soon as it aborts, and wakes every open stream', async () => {
    const { service, phone } = await rig(1);
    const one = await openScreen(service);
    const two = await openScreen(service);
    phone.plug();
    expect(await untilKey(one.iter)).toBe(await untilKey(two.iter));
    const waiting = one.iter.next();
    one.abort();
    const ended = await Promise.race([
      waiting,
      new Promise<'stuck'>((resolve) => setTimeout(() => resolve('stuck'), 500)),
    ]);
    expect(ended).not.toBe('stuck');
    if (ended !== 'stuck') expect(ended.done).toBe(true);
    await two.close();
  });

  it('puts every state change of a run on the bus while the clock moves', async () => {
    let now = 1_700_000_000_000;
    const { service, phone, runEvents } = await rig(3, {}, { now: () => (now += 7) });
    const screen = await openScreen(service);
    phone.plug();
    const key = await untilKey(screen.iter);
    const life = new AbortController();
    expect((await service.openDevice(key, life.signal)).ok).toBe(true);
    const started = await service.importFromDevice({ deviceKey: key, selection }, life.signal);
    if (!started.ok) throw new Error('did not start');
    const done = await untilTerminal(service, started.value.runId, life.signal);
    expect(done.state).toBe('succeeded');
    await settle(() => runEvents.some((run) => run.state === 'succeeded'));
    expect(runEvents.filter((run) => run.state === 'succeeded')).toHaveLength(1);
    expect(runEvents[0]?.state).toBe('running');
    await screen.close();
    life.abort();
  });

  it('fetches each thumbnail once, and again after the screen reopens', async () => {
    const { service, phone, stateDir, thumbCalls } = await rig(3);
    const first = await openScreen(service);
    phone.plug();
    const key = await untilKey(first.iter);
    const life = new AbortController();
    expect((await service.openDevice(key, life.signal)).ok).toBe(true);
    const query = { deviceKey: key, filter: { onlyNew: false, timeZone: 'UTC' }, limit: 50 };
    const pages = await Promise.all([
      service.deviceItems(query, life.signal),
      service.deviceItems(query, life.signal),
    ]);
    expect(pages.every((page) => page.ok)).toBe(true);
    await settle(async () => (await service.deviceItems(query, life.signal)).ok && thumbCalls() >= 3);
    await settle(async () => {
      const page = await service.deviceItems(query, life.signal);
      return page.ok && page.value.items.every((item) => item.thumb);
    });
    expect(thumbCalls()).toBe(3);
    await first.close();
    await settle(async () => !(await exists(thumbDir(stateDir, key))));

    // A new watch enumerates the bus again (WebUSB getDevices, the helper's devices.start).
    const second = await openScreen(service);
    phone.plug();
    const again = await untilKey(second.iter);
    expect((await service.openDevice(again, life.signal)).ok).toBe(true);
    // As the screen does, and as the first half does: each page asks for the thumbs it lacks. One call isn't
    // enough to wait on, because the reopened device's session can still be settling when it comes (LNX1-PKG:
    // on Linux, 2 runs in 6 stopped at 3 or 4 calls).
    await settle(async () => {
      const page = await service.deviceItems({ ...query, deviceKey: again }, life.signal);
      return page.ok && page.value.items.every((item) => item.thumb);
    });
    // Once each again: nothing fetched twice.
    expect(thumbCalls()).toBe(6);
    await second.close();
    life.abort();
  });

  it('refuses a second import for a device that is still starting one', async () => {
    const { service, phone } = await rig(2);
    const screen = await openScreen(service);
    phone.plug();
    const key = await untilKey(screen.iter);
    const life = new AbortController();
    expect((await service.openDevice(key, life.signal)).ok).toBe(true);
    const [a, b] = await Promise.all([
      service.importFromDevice({ deviceKey: key, selection }, life.signal),
      service.importFromDevice({ deviceKey: key, selection }, life.signal),
    ]);
    const outcomes = [a, b].map((result) => (result.ok ? 'ok' : result.error.code)).sort();
    expect(outcomes).toEqual(['ok', 'transfer.run_in_progress']);
    const runId = a.ok ? a.value.runId : b.ok ? b.value.runId : null;
    if (runId) expect((await untilTerminal(service, runId, life.signal)).state).toBe('succeeded');
    await screen.close();
    life.abort();
  });
});

function files(count: number): { item: DeviceItem; bytes: Buffer }[] {
  return Array.from({ length: count }, (_, index) => {
    const bytes = Buffer.concat([JPEG, Buffer.from([index])]);
    return {
      bytes,
      item: {
        id: `item-${index}`,
        name: `IMG_${String(index).padStart(4, '0')}.JPG`,
        kind: 'image',
        sizeBytes: bytes.length,
        createdAt: 1_690_000_000_000 + index * 60_000,
        modifiedAt: null,
        width: null,
        height: null,
        durationMs: null,
        type: 'image/jpeg',
        folder: 'DCIM/100APPLE',
        album: null,
        flags: {},
        sidecars: [],
        availability: 'local',
      },
    };
  });
}
