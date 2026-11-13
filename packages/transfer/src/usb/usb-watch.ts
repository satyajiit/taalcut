// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which bridges may serve a device the watcher saw. Pure: it never opens USB.
 * adb is (0xff, 0x42, 0x01). Still image (PTP/MTP) is (0x06, 0x01, 0x01).
 */
import type { BridgeKind, UsbDeviceInfo } from './bridge';

const APPLE_VENDOR = 0x05ac;
const ANDROID_VENDORS = new Set<number>([0x18d1, 0x04e8, 0x2717, 0x22b8]);

interface Iface {
  readonly cls: number;
  readonly sub: number;
  readonly proto: number;
}

export function hasAdb(device: UsbDeviceInfo): boolean {
  return device.interfaces.some((iface) => isAdb(iface));
}

export function hasStillImage(device: UsbDeviceInfo): boolean {
  return device.interfaces.some((iface) => isStillImage(iface));
}

export function isAppleDevice(device: UsbDeviceInfo): boolean {
  if (device.vendorId === APPLE_VENDOR) return true;
  return /iPhone|iPad/i.test(device.product ?? '');
}

export function isAndroidVendor(device: UsbDeviceInfo): boolean {
  return ANDROID_VENDORS.has(device.vendorId);
}

/** Candidate bridges, most preferred first. Empty when nothing on the bus can serve it. */
export function classify(device: UsbDeviceInfo): readonly BridgeKind[] {
  if (isAppleDevice(device)) return ['image-capture'];
  if (hasAdb(device)) return ['adb', 'mtp', 'image-capture'];
  if (hasStillImage(device)) return ['mtp', 'image-capture'];
  return [];
}

function isAdb(iface: Iface): boolean {
  return iface.cls === 0xff && iface.sub === 0x42 && iface.proto === 0x01;
}

function isStillImage(iface: Iface): boolean {
  return iface.cls === 0x06 && iface.sub === 0x01 && iface.proto === 0x01;
}
