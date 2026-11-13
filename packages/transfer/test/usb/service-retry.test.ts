// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createEventBus, createManualClock, err, ok, unwrap } from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceBridge, DeviceService, UsbDeviceInfo } from '../../src/usb/bridge';
import { DeviceBusy } from '../../src/usb/errors';
import { createDeviceService } from '../../src/usb/usb-service';
import { FORMAT_ASSOCIATION, OP_GET_STORAGE_IDS } from '../../src/bridges/mtp/codes';
import { connectPhone, createCopySink, importFolders } from './import-harness';
import { bytesBody, type MemoryObject } from './mtp/memory-pipe';
import { createMtpPhone } from './mtp/mtp-phone';
import { cleanScratch } from './scratch';

const active: { service: DeviceService; stop: AbortController }[] = [];
afterEach(async () => {
  for (const { service, stop } of active.splice(0)) {
    stop.abort();
    await service.close();
  }
  await cleanScratch();
});
const device: UsbDeviceInfo = {
  locationId: 'android-retry',
  vendorId: 0x04e8,
  productId: 0x6860,
  serial: 'ANDROID-RETRY',
  product: 'Galaxy',
  interfaces: [{ cls: 6, sub: 1, proto: 1 }],
};
const common = {
  storageId: 1,
  created: '20261106T120000',
  modified: '20261106T120000',
  width: 640,
  height: 480,
};
const objects: MemoryObject[] = [
  {
    ...common,
    handle: 1,
    parent: 0,
    format: FORMAT_ASSOCIATION,
    name: 'DCIM',
    body: bytesBody(new Uint8Array()),
  },
  {
    ...common,
    handle: 2,
    parent: 1,
    format: 0x3801,
    name: 'airport.jpg',
    body: bytesBody(new Uint8Array(1024)),
  },
];

describe('public device retry after Android unlock', () => {
  it.each(['mtp', 'image-capture'] as const)(
    're-lists a locked %s session and exposes its catalogue',
    async (kind) => {
      const storage = { noStorage: true };
      const phone = createMtpPhone(device, objects, storage, storage);
      const imageCapture: DeviceBridge = {
        ...phone.bridge,
        kind: 'image-capture',
        async *watch(signal) {
          for await (const event of phone.bridge.watch(signal))
            yield { ...event, ref: { ...event.ref, bridge: 'image-capture' as const } };
        },
        async open(ref, signal) {
          const opened = await phone.bridge.open({ ...ref, bridge: 'mtp' }, signal);
          return opened.ok ? ok({ ...opened.value, ref }) : opened;
        },
      };
      const busyMtp: DeviceBridge = {
        ...phone.bridge,
        open: async () => err(DeviceBusy(undefined, { detail: 'camera-agent' })),
      };
      const folders = await importFolders();
      const copy = createCopySink(folders.staging, folders.originals, new Set());
      const clock = createManualClock(1_700_000_000_000);
      const service = createDeviceService({
        bridges: kind === 'mtp' ? [phone.bridge] : [busyMtp, imageCapture],
        watcher: phone.watcher,
        importSink: copy.sink,
        media: { probe: async () => ({ ok: false }) },
        events: createEventBus({ clock }),
        clock,
        stateDir: folders.state,
        forgetAdbKey: async () => false,
      });
      const stop = new AbortController();
      active.push({ service, stop });
      const key = await connectPhone(service, phone, stop.signal);
      expect(unwrap(await service.openDevice(key, stop.signal))).toMatchObject({
        access: 'locked',
        bridge: kind,
      });
      expect(phone.pipes).toHaveLength(1);
      const reads = phone.pipes[0]!.opcodes.filter((code) => code === OP_GET_STORAGE_IDS).length;
      // The phone unlocks without an event. The public retry must revisit the same live session.
      storage.noStorage = false;
      expect(unwrap(await service.openDevice(key, stop.signal))).toMatchObject({
        access: 'ready',
        bridge: kind,
      });
      expect(phone.pipes).toHaveLength(1);
      expect(phone.pipes[0]!.opcodes.filter((code) => code === OP_GET_STORAGE_IDS).length).toBeGreaterThan(
        reads,
      );
      const page = unwrap(
        await service.deviceItems(
          { deviceKey: key, filter: { onlyNew: false, timeZone: 'UTC' }, limit: 10 },
          stop.signal,
        ),
      );
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.name).toBe('airport.jpg');
    },
  );
});
