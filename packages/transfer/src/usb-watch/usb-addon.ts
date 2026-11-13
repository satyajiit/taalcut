// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `usb` 3.2.1 addon's WebUSB object (`usb`: every device allowed), loaded
 * on first use, never at import, so Wi-Fi-only processes and tests never load
 * it. One loader and one location rule for the watcher and every bridge: an
 * addon that won't load is `transfer.bridge_failed` with detail
 * `usb.addon_unavailable`, never a silently empty bus.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { BridgeFailed } from '../usb/errors';
import { createEventQueue } from '../usb/event-queue';
import type { UsbDeviceInfo } from '../usb/bridge';

/** What Taalcut uses of the addon's WebUSB object. Local names: the package has no DOM WebUSB types. */
export interface UsbAddon {
  getDevices(): Promise<readonly unknown[]>;
  addEventListener(type: 'connect' | 'disconnect', listener: (event: object) => void): void;
  removeEventListener(type: 'connect' | 'disconnect', listener: (event: object) => void): void;
}

export async function loadUsbAddon(): AsyncResult<UsbAddon> {
  let loaded: unknown;
  try {
    loaded = await import('usb');
  } catch {
    // The addon is missing or won't load here (a damaged install): say so, never the loader's message.
    return err(addonUnavailable());
  }
  const candidate = isRecord(loaded)
    ? (loaded.usb ?? (isRecord(loaded.default) ? loaded.default.usb : undefined))
    : undefined;
  return isUsbAddon(candidate) ? ok(safeUsbAddon(candidate)) : err(addonUnavailable());
}

/** Reads a getter on a raw WebUSB device; returns undefined when the native addon throws on a gone device. */
export function readUsbProp(raw: object, key: string): unknown {
  if (!isRecord(raw)) return undefined;
  try {
    return raw[key];
  } catch {
    return undefined;
  }
}

/** A disconnect must keep the identity read at connect, before native getters became unavailable. */
export function rememberUsbDevice(
  known: Map<string, UsbDeviceInfo>,
  device: UsbDeviceInfo,
  type: 'added' | 'removed',
): UsbDeviceInfo {
  if (type === 'added') {
    known.set(device.locationId, device);
    return device;
  }
  const previous = known.get(device.locationId);
  known.delete(device.locationId);
  return previous ?? device;
}

/**
 * Where a device sits on the bus: the addon's handle, else bus and address, else vendor and
 * product. Refs from the watcher and every bridge use this one rule, so a phone without a serial
 * still joins into one card.
 */
export function usbLocationOf(raw: object): string {
  const handle = readUsbProp(raw, 'handle');
  if (typeof handle === 'string' && handle.length > 0) return handle;
  const rawBus = readUsbProp(raw, 'bus');
  const rawAddress = readUsbProp(raw, 'address');
  const bus = typeof rawBus === 'string' || typeof rawBus === 'number' ? String(rawBus) : '';
  const address = typeof rawAddress === 'number' ? String(rawAddress) : '';
  if (bus.length > 0 && address.length > 0) return `${bus}-${address}`;
  const rawVendor = readUsbProp(raw, 'vendorId');
  const rawProduct = readUsbProp(raw, 'productId');
  const vendor = typeof rawVendor === 'number' ? rawVendor.toString(16) : '0';
  const product = typeof rawProduct === 'number' ? rawProduct.toString(16) : '0';
  return `usb-${vendor}-${product}`;
}

/**
 * Devices on the bus now, then as they come and go, until `signal` aborts. Each raw addon device
 * goes through `read` (null skips it). The addon's listeners are removed when the watch ends.
 */
export async function* watchUsbBus<T>(
  addon: UsbAddon,
  signal: AbortSignal,
  read: (raw: unknown, type: 'added' | 'removed') => T | null,
): AsyncGenerator<T> {
  const changes = createEventQueue<T>();
  const safeRead = (raw: unknown, type: 'added' | 'removed'): T | null => {
    try {
      return read(raw, type);
    } catch {
      return null;
    }
  };
  const listen =
    (type: 'added' | 'removed') =>
    (event: object): void => {
      const value = safeRead(isRecord(event) ? event.device : undefined, type);
      if (value !== null) changes.push(value);
    };
  const onConnect = listen('added');
  const onDisconnect = listen('removed');
  addon.addEventListener('connect', onConnect);
  addon.addEventListener('disconnect', onDisconnect);
  try {
    for (const raw of await addon.getDevices()) {
      const value = safeRead(raw, 'added');
      if (value !== null) yield value;
    }
    yield* changes.drain(signal);
  } finally {
    addon.removeEventListener('connect', onConnect);
    addon.removeEventListener('disconnect', onDisconnect);
  }
}

/**
 * Node 24's EventTarget rethrows listener exceptions on `nextTick`, and `@node-usb/usb` NAPI
 * getters (`configuration`, `serialNumber`, `productName`) throw when a phone disconnects or
 * switches USB mode mid-event. Swallow listener throws so a resetting phone never crashes `lan`.
 */
function safeUsbAddon(addon: UsbAddon): UsbAddon {
  const wrappers = new WeakMap<(event: object) => void, (event: object) => void>();
  return {
    getDevices: () => addon.getDevices(),
    addEventListener(type, listener) {
      let wrapped = wrappers.get(listener);
      if (!wrapped) {
        wrapped = (event: object): void => {
          try {
            listener(event);
          } catch {
            // A device that vanished or reset mid-callback has nothing left to inspect.
          }
        };
        wrappers.set(listener, wrapped);
      }
      addon.addEventListener(type, wrapped);
    },
    removeEventListener(type, listener) {
      const wrapped = wrappers.get(listener);
      addon.removeEventListener(type, wrapped ?? listener);
    },
  };
}

function addonUnavailable() {
  return BridgeFailed(undefined, { detail: 'usb.addon_unavailable' });
}

function isUsbAddon(value: unknown): value is UsbAddon {
  return (
    isRecord(value) &&
    typeof value.getDevices === 'function' &&
    typeof value.addEventListener === 'function' &&
    typeof value.removeEventListener === 'function'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
