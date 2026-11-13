// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * WebUSB hot-plug for the device hub. Lists every device the addon can see
 * and does not claim an interface: classify() only needs the descriptors.
 * The native addon loads on the first watch, so Wi-Fi tests never touch it.
 * An addon that won't load ends the watch with `transfer.bridge_failed`
 * (detail `usb.addon_unavailable`), which the devices stream reports.
 */
import type { UsbDeviceInfo, UsbWatcher } from '../usb/bridge';
import { loadUsbAddon, readUsbProp, rememberUsbDevice, usbLocationOf, watchUsbBus } from './usb-addon';

export function createWebUsbWatcher(): UsbWatcher {
  return { watch: (signal) => watch(signal) };
}

async function* watch(
  signal: AbortSignal,
): AsyncIterable<{ readonly type: 'added' | 'removed'; readonly device: UsbDeviceInfo }> {
  const loaded = await loadUsbAddon();
  if (signal.aborted) return;
  if (!loaded.ok) throw loaded.error;
  const known = new Map<string, UsbDeviceInfo>();
  yield* watchUsbBus(loaded.value, signal, (raw, type) => {
    const device = asInfo(raw);
    return device ? { type, device: rememberUsbDevice(known, device, type) } : null;
  });
}

function asInfo(value: unknown): UsbDeviceInfo | null {
  if (!isRecord(value)) return null;
  const vendorId = readUsbProp(value, 'vendorId');
  const productId = readUsbProp(value, 'productId');
  if (typeof vendorId !== 'number' || typeof productId !== 'number') return null;
  const serialNumber = readUsbProp(value, 'serialNumber');
  const productName = readUsbProp(value, 'productName');
  return {
    locationId: usbLocationOf(value),
    vendorId,
    productId,
    serial: typeof serialNumber === 'string' && serialNumber.length > 0 ? serialNumber : null,
    product: typeof productName === 'string' && productName.length > 0 ? productName : null,
    interfaces: interfacesOf(readUsbProp(value, 'configuration')),
  };
}

function interfacesOf(configuration: unknown): { cls: number; sub: number; proto: number }[] {
  if (!isRecord(configuration) || !Array.isArray(configuration.interfaces)) return [];
  const found: { cls: number; sub: number; proto: number }[] = [];
  for (const iface of configuration.interfaces) {
    if (!isRecord(iface) || !isRecord(iface.alternate)) continue;
    const alt = iface.alternate;
    if (
      typeof alt.interfaceClass !== 'number' ||
      typeof alt.interfaceSubclass !== 'number' ||
      typeof alt.interfaceProtocol !== 'number'
    ) {
      continue;
    }
    found.push({ cls: alt.interfaceClass, sub: alt.interfaceSubclass, proto: alt.interfaceProtocol });
  }
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
