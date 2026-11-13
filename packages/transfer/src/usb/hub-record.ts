// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The hub's record of one physical phone, and the identity the watcher joins it by. */
import type { BridgeDeviceRef, BridgeKind, BridgeSession, DeviceAccess, UsbDeviceInfo } from './bridge';
import type { BusyHolder } from './hub-view';

export interface LiveDevice {
  key: string;
  identity: string;
  usb: UsbDeviceInfo | null;
  /** Null until the watcher reports the device. False after it leaves. */
  usbPresent: boolean | null;
  refs: Map<BridgeKind, BridgeDeviceRef>;
  session: BridgeSession | null;
  stopAccess: (() => void) | null;
  connected: boolean;
  seenAt: number;
  timer: { cancel(): void } | null;
  timedOut: boolean;
  holder: BusyHolder | null;
  override: DeviceAccess | null;
}

export function newRecord(key: string, identity: string, now: number): LiveDevice {
  return {
    key,
    identity,
    usb: null,
    usbPresent: null,
    refs: new Map(),
    session: null,
    stopAccess: null,
    connected: false,
    seenAt: now,
    timer: null,
    timedOut: false,
    holder: null,
    override: null,
  };
}

/** The serial, else the location id. Raw: only `deviceKey` hashes it, and nothing logs it. */
export function usbIdentity(device: UsbDeviceInfo): string {
  return device.serial && device.serial.length > 0 ? device.serial : device.locationId;
}
