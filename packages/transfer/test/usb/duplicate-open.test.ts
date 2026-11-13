// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Self-contention guards: no duplicate opens, no overlap with slow closes, no leaked fallback watches. */
import { createManualClock, err, ok, unwrap } from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createMtpBridge } from '../../src/bridges/mtp/bridge';
import { OP_CLOSE_SESSION, OP_GET_STORAGE_IDS, OP_OPEN_SESSION, RES_OK, TYPE_DATA, TYPE_RESPONSE } from '../../src/bridges/mtp/codes';
import { decodeContainer, encodeContainer, encodeIdArray } from '../../src/bridges/mtp/container';
import type { MtpPipe } from '../../src/bridges/mtp/session';
import type { BridgeDeviceRef, DeviceBridge, UsbDeviceInfo } from '../../src/usb/bridge';
import { deviceKey } from '../../src/usb/device-key';
import { DeviceBusy } from '../../src/usb/errors';
import { createDeviceHub } from '../../src/usb/hub';
import { connect, queue, releaseHubs, setup, trackHub, until, usb, watchOf } from './hub-fakes';
import { createUsbBus } from './mtp/mtp-phone';

afterEach(releaseHubs);

const mtpIface = [{ cls: 6, sub: 1, proto: 1 }];

describe('duplicate and overlapping USB phone opens', () => {
  it('waits for an in-flight session close before reopening the same phone', async () => {
    const events = queue<{ type: 'added' | 'removed'; device: UsbDeviceInfo }>();
    const mtpEvents = queue<{ readonly type: 'added' | 'removed'; readonly ref: BridgeDeviceRef }>();
    const ref: BridgeDeviceRef = {
      bridge: 'mtp',
      handle: 'mtp-1',
      identity: 'L2OPUHVGSMXBMNM2',
      label: 'SAMSUNG_Android',
      platform: 'android',
    };
    let interfaceClaimed = false;
    let finishClose: () => void = () => {};
    const bridge: DeviceBridge = {
      kind: 'mtp',
      claims: () => true,
      watch: (signal) => mtpEvents.iterate(signal),
      async open() {
        if (interfaceClaimed) return err(DeviceBusy(undefined, { detail: 'unknown' }));
        interfaceClaimed = true;
        return ok({
          ref,
          rangedReads: true,
          access: () => ({ state: 'ready' }),
          onAccessChange: () => () => {},
          async *list() {
            yield [];
          },
          thumbnail: async () => ok(null),
          pull: async () => err(DeviceBusy(undefined, { detail: 'unknown' })),
          async close() {
            await new Promise<void>((resolve) => {
              finishClose = () => {
                interfaceClaimed = false;
                resolve();
              };
            });
          },
        });
      },
    };
    const hub = setup([bridge], watchOf(events));
    const phone = usb({
      serial: 'L2OPUHVGSMXBMNM2',
      vendorId: 0x04e8,
      product: 'SAMSUNG_Android',
      interfaces: mtpIface,
    });
    const key = deviceKey('L2OPUHVGSMXBMNM2');
    events.push({ type: 'added', device: phone });
    mtpEvents.push({ type: 'added', ref });
    await until(() => hub.view(key)?.connected === true && hub.view(key)?.access === 'ready');

    expect((await hub.open(key, new AbortController().signal)).ok).toBe(true);
    expect(interfaceClaimed).toBe(true);

    // Watcher drops to zero and restarts immediately while the previous session is still releasing USB.
    hub.release();
    hub.retain();
    events.push({ type: 'added', device: phone });
    mtpEvents.push({ type: 'added', ref });
    await until(() => hub.view(key)?.connected === true);

    const reopened = hub.open(key, new AbortController().signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(interfaceClaimed).toBe(true);
    finishClose();

    const result = await reopened;
    expect(result.ok).toBe(true);
    expect(hub.view(key)?.access).toBe('ready');
    finishClose();
  });

  it('shares one bridge open across concurrent callers even if the first caller aborts', async () => {
    const events = queue<{ type: 'added' | 'removed'; device: UsbDeviceInfo }>();
    const mtpEvents = queue<{ readonly type: 'added' | 'removed'; readonly ref: BridgeDeviceRef }>();
    const ref: BridgeDeviceRef = {
      bridge: 'mtp',
      handle: 'mtp-shared',
      identity: 'SHARED-SERIAL',
      label: 'Galaxy',
      platform: 'android',
    };
    let opens = 0;
    let releaseOpen: () => void = () => {};
    const bridge: DeviceBridge = {
      kind: 'mtp',
      claims: () => true,
      watch: (signal) => mtpEvents.iterate(signal),
      async open(_ref, signal) {
        opens += 1;
        await new Promise<void>((resolve) => {
          releaseOpen = resolve;
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        if (signal.aborted) return err(DeviceBusy(undefined, { detail: 'aborted' }));
        return ok({
          ref,
          rangedReads: true,
          access: () => ({ state: 'ready' }),
          onAccessChange: () => () => {},
          async *list() {
            yield [];
          },
          thumbnail: async () => ok(null),
          pull: async () => err(DeviceBusy(undefined, { detail: 'unknown' })),
          close: async () => {},
        });
      },
    };
    const hub = setup([bridge], watchOf(events));
    const phone = usb({ serial: 'SHARED-SERIAL', vendorId: 0x04e8, product: 'Galaxy', interfaces: mtpIface });
    const key = deviceKey('SHARED-SERIAL');
    events.push({ type: 'added', device: phone });
    mtpEvents.push({ type: 'added', ref });
    await until(() => hub.view(key)?.access === 'ready');

    const first = new AbortController();
    const second = new AbortController();
    const openA = hub.open(key, first.signal);
    const openB = hub.open(key, second.signal);
    await until(() => opens === 1);

    first.abort();
    expect((await openA).ok).toBe(false);
    releaseOpen();
    expect((await openB).ok).toBe(true);
    expect(opens).toBe(1);
  });

  it('stops Android image-capture fallback on failure and clears stale busy holder on retry', async () => {
    const events = queue<{ type: 'added' | 'removed'; device: UsbDeviceInfo }>();
    const mtpEvents = queue<{ readonly type: 'added' | 'removed'; readonly ref: BridgeDeviceRef }>();
    const icEvents = queue<{ readonly type: 'added' | 'removed'; readonly ref: BridgeDeviceRef }>();
    const mtpRef: BridgeDeviceRef = {
      bridge: 'mtp',
      handle: 'mtp-retry',
      identity: 'SAMSUNG-IC',
      label: 'Galaxy',
      platform: 'android',
    };
    const icRef: BridgeDeviceRef = {
      bridge: 'image-capture',
      handle: 'ic-retry',
      identity: 'SAMSUNG-IC',
      label: 'Galaxy',
      platform: 'other',
    };
    let mtpBusy = true;
    let icWatching = false;
    const mtp: DeviceBridge = {
      kind: 'mtp',
      claims: () => true,
      watch: (signal) => mtpEvents.iterate(signal),
      async open() {
        if (mtpBusy || icWatching) return err(DeviceBusy(undefined, { detail: 'camera-agent' }));
        return ok({
          ref: mtpRef,
          rangedReads: true,
          access: () => ({ state: 'ready' }),
          onAccessChange: () => () => {},
          async *list() {
            yield [];
          },
          thumbnail: async () => ok(null),
          pull: async () => err(DeviceBusy(undefined, { detail: 'unknown' })),
          close: async () => {},
        });
      },
    };
    const imageCapture: DeviceBridge = {
      kind: 'image-capture',
      claims: () => true,
      watch(signal) {
        icWatching = true;
        signal.addEventListener('abort', () => {
          icWatching = false;
        });
        icEvents.push({ type: 'added', ref: icRef });
        return icEvents.iterate(signal);
      },
      open: async () => err(DeviceBusy(undefined, { detail: 'camera-agent' })),
    };
    const hub = createDeviceHub({
      bridges: [mtp, imageCapture],
      watcher: watchOf(events),
      clock: createManualClock(1_700_000_000_000),
    });
    trackHub(hub);
    hub.retain();

    const phone = usb({ serial: 'SAMSUNG-IC', vendorId: 0x04e8, product: 'Galaxy', interfaces: mtpIface });
    const key = deviceKey('SAMSUNG-IC');
    await connect(hub, events, phone, [{ bridge: mtp, ref: mtpRef, push: () => mtpEvents.push({ type: 'added', ref: mtpRef }), opens: () => 0, session: () => null }]);

    const first = unwrap(await hub.open(key, new AbortController().signal));
    expect(first.access).toBe('busy');
    expect(first.busyHolder).toBe('camera-agent');
    await until(() => icWatching === false);

    mtpBusy = false;
    const second = unwrap(await hub.open(key, new AbortController().signal));
    expect(second.access).toBe('ready');
    expect(hub.view(key)?.access).toBe('ready');
    expect(hub.view(key)?.busyHolder).toBeUndefined();
  });

  it('cancels in-flight MTP reads on close and serializes back-to-back bridge opens', async () => {
    const bus = createUsbBus();
    const device: UsbDeviceInfo = {
      locationId: 'samsung-loc',
      vendorId: 0x04e8,
      productId: 0x6860,
      serial: 'SAMSUNG-PIPE',
      product: 'SAMSUNG_Android',
      interfaces: mtpIface,
    };
    let claimed = false;
    let cancelledReads = 0;
    const makePipe = (): MtpPipe => {
      let lastCode = 0;
      let lastTx = 0;
      let sentData = false;
      let abortHanging: (() => void) | null = null;
      return {
        async claim() {
          if (claimed) return 'busy';
          claimed = true;
          return 'claimed';
        },
        async transferOut(bytes) {
          const decoded = decodeContainer(bytes);
          lastCode = decoded?.code ?? 0;
          lastTx = decoded?.transactionId ?? 0;
          sentData = false;
          return 'ok';
        },
        async transferIn(_length, signal) {
          if (lastCode === OP_OPEN_SESSION || lastCode === OP_CLOSE_SESSION) {
            return { status: 'ok', data: encodeContainer(TYPE_RESPONSE, RES_OK, lastTx, new Uint8Array()) };
          }
          if (lastCode === OP_GET_STORAGE_IDS) {
            if (!sentData) {
              sentData = true;
              return {
                status: 'ok',
                data: encodeContainer(TYPE_DATA, lastCode, lastTx, encodeIdArray([1])),
              };
            }
            return { status: 'ok', data: encodeContainer(TYPE_RESPONSE, RES_OK, lastTx, new Uint8Array()) };
          }
          return await new Promise((resolve) => {
            const finish = () => resolve({ status: 'stall', data: new Uint8Array() });
            abortHanging = finish;
            signal.addEventListener('abort', finish, { once: true });
          });
        },
        async cancelRequest() {
          if (abortHanging) {
            cancelledReads += 1;
            const wake = abortHanging;
            abortHanging = null;
            wake();
          }
        },
        async release() {
          claimed = false;
        },
      };
    };
    const bridge = createMtpBridge({ plugs: bus, openPipe: async () => makePipe() });
    const stop = new AbortController();
    const iter = bridge.watch(stop.signal)[Symbol.asyncIterator]();
    bus.plug(device);
    const added = await iter.next();
    if (added.done) throw new Error('expected added event');

    const first = unwrap(await bridge.open(added.value.ref, stop.signal));
    const hangingThumb = first.thumbnail('99', new AbortController().signal);
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Reopening the same phone on the bridge closes the previous session first and cancels its bulk read.
    const second = unwrap(await bridge.open(added.value.ref, stop.signal));
    expect(cancelledReads).toBe(1);
    await hangingThumb;
    expect(claimed).toBe(true);
    await second.close();
    expect(claimed).toBe(false);
    stop.abort();
    await iter.return?.();
  });
});
