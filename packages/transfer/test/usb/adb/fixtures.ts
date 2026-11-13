// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Shared phone contents, refs, the test key and session helpers for the adb bridge tests. */
import { createHash, generateKeyPairSync } from 'node:crypto';
import { expect } from 'vitest';
import { createAdbBridge, type AdbBridgeOptions, type AdbKeySource } from '../../../src/bridges/adb/bridge';
import { type AdbPlug } from '../../../src/bridges/adb/transport';
import {
  type BridgeDeviceRef,
  type BridgeSession,
  type DeviceBridge,
  type DeviceItem,
  type UsbDeviceInfo,
} from '../../../src/usb/bridge';
import { type FakeAdb, type FakeFile, type FakeRow } from './fake-transport';

export const IMAGE = Uint8Array.from([1, 2, 3, 4, 5]);
export const VIDEO = Uint8Array.from([9, 8, 7, 6, 5, 4, 3]);
export const IMAGE_MTIME = 1_500_000_000;
export const VIDEO_MTIME = 1_600_000_000;

export const FILES: readonly FakeFile[] = [
  { path: '/sdcard/DCIM/Camera/weird:name.png', bytes: IMAGE, mtime: IMAGE_MTIME },
  { path: '/sdcard/Movies/My Clip.mp4', bytes: VIDEO, mtime: VIDEO_MTIME },
  { path: '/sdcard/DCIM/Camera/notes.txt', bytes: Uint8Array.from([1]), mtime: 1_400_000_000 },
];

export const ROWS: readonly FakeRow[] = [
  {
    id: '42',
    name: 'weird:name.png',
    size: 999,
    dateAdded: 1_700_000_000,
    dateTaken: 1_650_000_000_123,
    bucket: 'Holiday',
    mime: 'image/jpeg',
    width: 100,
    height: 200,
    duration: null,
  },
  {
    id: '7',
    name: 'My Clip.mp4',
    size: VIDEO.byteLength,
    dateAdded: VIDEO_MTIME,
    bucket: 'Trips',
    mime: 'video/mp4',
    width: 320,
    height: 240,
    duration: 1500,
  },
];

export const USB_INFO: UsbDeviceInfo = {
  locationId: 'bus-1',
  vendorId: 0x18d1,
  productId: 0x4ee7,
  serial: null,
  product: 'Pixel',
  interfaces: [{ cls: 0xff, sub: 0x42, proto: 0x01 }],
};

export const REF: BridgeDeviceRef = {
  bridge: 'adb',
  handle: 'bus-1',
  identity: 'pixel',
  label: 'Pixel',
  platform: 'android',
};

/** One RSA-2048 PKCS#8 key for the whole run, the shape main hands the lan process. */
export const PKCS8 = testKey();

export const keys: AdbKeySource = {
  pkcs8: () => Promise.resolve(PKCS8.slice()),
};

function testKey(): Uint8Array {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = privateKey.export({ format: 'der', type: 'pkcs8' });
  if (typeof der === 'string') throw new Error('adb-key');
  return new Uint8Array(der);
}

export function adbBridge(options: Omit<AdbBridgeOptions, 'keys' | 'devices'>): DeviceBridge {
  return createAdbBridge({ keys, devices: noDevices, ...options });
}

export async function* noDevices(signal: AbortSignal): AsyncGenerator<AdbPlug> {
  await new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
  yield* fromList([]);
}

export async function* fromList(plugs: readonly AdbPlug[]): AsyncGenerator<AdbPlug> {
  for (const plug of plugs) yield await Promise.resolve(plug);
}

export function rowFor(id: string, name: string, size: number): FakeRow {
  return {
    id,
    name,
    size,
    dateAdded: 1_700_000_000,
    bucket: null,
    mime: 'image/jpeg',
    width: null,
    height: null,
    duration: null,
  };
}

export function iface(cls: number, sub: number, proto: number): UsbDeviceInfo {
  return { ...USB_INFO, interfaces: [{ cls, sub, proto }] };
}

export function unused(): Promise<never> {
  return Promise.reject(new Error('unused'));
}

export function abort(): AbortSignal {
  return new AbortController().signal;
}

export function hashOf(session: BridgeSession): NonNullable<BridgeSession['sourceHash']> {
  const hash = session.sourceHash;
  if (!hash) throw new Error('adb-hash');
  return hash;
}

export function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function withSession(
  fake: FakeAdb,
  run: (session: BridgeSession) => Promise<void>,
): Promise<void> {
  const bridge = adbBridge({ connect: () => Promise.resolve(fake.transport) });
  const opened = await bridge.open(REF, abort());
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    await run(opened.value);
  } finally {
    await opened.value.close();
  }
}

export async function listAll(session: BridgeSession): Promise<DeviceItem[]> {
  const items: DeviceItem[] = [];
  for await (const page of session.list(abort())) items.push(...page);
  return items;
}
