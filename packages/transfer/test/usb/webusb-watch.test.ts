// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Recorded WebUSB descriptors: adb, still image, charging only, and composite. */
import { describe, expect, it, vi } from 'vitest';
import { classify } from '../../src/usb/usb-watch';
import { createWebUsbWatcher } from '../../src/usb-watch/webusb-watch';
import { createDeviceHub } from '../../src/usb/hub';

const fakeUsb = vi.hoisted(() => {
  const present: unknown[] = [];
  const listeners = new Map<string, Set<(event: object) => void>>();
  return {
    present,
    listeners,
    emit(type: 'connect' | 'disconnect', device: unknown): void {
      for (const listener of listeners.get(type) ?? []) listener({ device });
    },
    api: {
      getDevices: (): Promise<readonly unknown[]> => Promise.resolve(present),
      addEventListener(type: string, listener: (event: object) => void): void {
        const set = listeners.get(type) ?? new Set<(event: object) => void>();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener(type: string, listener: (event: object) => void): void {
        listeners.get(type)?.delete(listener);
      },
    },
  };
});

vi.mock('usb', () => ({ usb: fakeUsb.api }));

function descriptor(input: {
  readonly vendorId: number;
  readonly productId: number;
  readonly serialNumber?: string;
  readonly productName?: string;
  readonly handle?: string;
  readonly bus?: number;
  readonly address?: number;
  readonly interfaces?: readonly { readonly cls: number; readonly sub: number; readonly proto: number }[];
}): unknown {
  return {
    vendorId: input.vendorId,
    productId: input.productId,
    ...(input.serialNumber !== undefined ? { serialNumber: input.serialNumber } : {}),
    ...(input.productName !== undefined ? { productName: input.productName } : {}),
    ...(input.handle !== undefined ? { handle: input.handle } : {}),
    ...(input.bus !== undefined ? { bus: input.bus } : {}),
    ...(input.address !== undefined ? { address: input.address } : {}),
    configuration: {
      interfaces: (input.interfaces ?? []).map((iface) => ({
        alternate: {
          interfaceClass: iface.cls,
          interfaceSubclass: iface.sub,
          interfaceProtocol: iface.proto,
        },
      })),
    },
  };
}

const adb = { cls: 0xff, sub: 0x42, proto: 0x01 };
const still = { cls: 0x06, sub: 0x01, proto: 0x01 };

describe('recorded WebUSB descriptors', () => {
  it('disconnects the original serial-keyed hub record when native getters become unavailable', async () => {
    fakeUsb.present.splice(0, fakeUsb.present.length);
    fakeUsb.listeners.clear();
    let removed = false;
    const phone = {
      vendorId: 0x04e8,
      productId: 0x6860,
      bus: 1,
      address: 9,
      get serialNumber(): string {
        if (removed) throw new Error('native device gone');
        return 'SAMSUNG-SERIAL';
      },
      get productName(): string {
        if (removed) throw new Error('native device gone');
        return 'Samsung';
      },
      get configuration(): unknown {
        if (removed) throw new Error('native device gone');
        return { interfaces: [] };
      },
    };
    fakeUsb.present.push(phone);
    const hub = createDeviceHub({ bridges: [], watcher: createWebUsbWatcher(), clock: { now: Date.now } });
    hub.retain();
    try {
      await vi.waitFor(() => expect(hub.views()[0]?.connected).toBe(true));
      const key = hub.views()[0]!.key;
      removed = true;
      fakeUsb.emit('disconnect', phone);
      await vi.waitFor(() => expect(hub.view(key)?.connected).toBe(false));
      expect(hub.views()).toHaveLength(1);
    } finally {
      hub.release();
    }
  });

  it('classifies adb, still image, charging only, and a composite phone', async () => {
    fakeUsb.present.splice(0, fakeUsb.present.length);
    fakeUsb.listeners.clear();
    fakeUsb.present.push(
      descriptor({
        vendorId: 0x18d1,
        productId: 0x4ee7,
        serialNumber: 'PIXEL',
        productName: 'Pixel',
        handle: 'port-3',
        interfaces: [adb],
      }),
      descriptor({
        vendorId: 0x04e8,
        productId: 0x6860,
        serialNumber: 'SAMSUNG',
        productName: 'Samsung',
        bus: 2,
        address: 5,
        interfaces: [still],
      }),
      descriptor({
        vendorId: 0x18d1,
        productId: 0x4ee1,
        serialNumber: '',
        productName: 'Pixel',
        bus: 1,
        address: 4,
      }),
      descriptor({
        vendorId: 0x2717,
        productId: 0xff40,
        serialNumber: 'REDMI',
        productName: 'Redmi',
        handle: 'port-9',
        interfaces: [still, adb],
      }),
      { productName: 'not a device' },
    );
    const stop = new AbortController();
    const iter = createWebUsbWatcher().watch(stop.signal)[Symbol.asyncIterator]();
    const seen = [];
    for (let index = 0; index < 4; index += 1) {
      const step = await iter.next();
      if (step.done) break;
      seen.push(step.value);
    }
    expect(seen).toHaveLength(4);
    const pixel = seen[0];
    const samsung = seen[1];
    const charging = seen[2];
    const redmi = seen[3];
    if (!pixel || !samsung || !charging || !redmi) throw new Error('missing descriptor');
    expect(seen.map((event) => event.device.serial)).toEqual(['PIXEL', 'SAMSUNG', null, 'REDMI']);
    expect(seen.every((event) => event.type === 'added')).toBe(true);
    expect(classify(pixel.device)).toEqual(['adb', 'mtp', 'image-capture']);
    expect(pixel.device.locationId).toBe('port-3');
    expect(classify(samsung.device)).toEqual(['mtp', 'image-capture']);
    expect(samsung.device.locationId).toBe('2-5');
    expect(classify(charging.device)).toEqual([]);
    expect(charging.device.product).toBe('Pixel');
    expect(classify(redmi.device)).toEqual(['adb', 'mtp', 'image-capture']);
    fakeUsb.emit(
      'connect',
      descriptor({
        vendorId: 0x22b8,
        productId: 0x2e81,
        serialNumber: 'MOTO',
        productName: 'Moto',
        interfaces: [still],
      }),
    );
    const connected = await iter.next();
    expect(connected.done).toBe(false);
    if (!connected.done) {
      expect(connected.value.type).toBe('added');
      expect(classify(connected.value.device)).toEqual(['mtp', 'image-capture']);
    }
    fakeUsb.emit('disconnect', descriptor({ vendorId: 0x22b8, productId: 0x2e81, serialNumber: 'MOTO' }));
    const gone = await iter.next();
    expect(gone.done).toBe(false);
    if (!gone.done) expect(gone.value.type).toBe('removed');
    // A resetting Android phone whose native string getters throw on disconnect still reports removal.
    const resetting = {
      vendorId: 0x04e8,
      productId: 0x6860,
      bus: 1,
      address: 9,
      get serialNumber(): string {
        throw new Error('getString error: unknown (error 0xe00002d9)');
      },
      get productName(): string {
        throw new Error('getString error: unknown (error 0xe00002d9)');
      },
      get configuration(): unknown {
        throw new Error('getString error: unknown (error 0xe00002d9)');
      },
    };
    fakeUsb.emit('disconnect', resetting);
    const resetGone = await iter.next();
    expect(resetGone.done).toBe(false);
    if (!resetGone.done) {
      expect(resetGone.value.type).toBe('removed');
      expect(resetGone.value.device.locationId).toBe('1-9');
      expect(resetGone.value.device.serial).toBeNull();
    }
    expect(fakeUsb.listeners.get('connect')?.size).toBe(1);
    stop.abort();
    const end = await iter.next();
    expect(end.done).toBe(true);
    expect(fakeUsb.listeners.get('connect')?.size).toBe(0);
    expect(fakeUsb.listeners.get('disconnect')?.size).toBe(0);
  });
});
