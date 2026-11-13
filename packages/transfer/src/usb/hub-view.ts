// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** DeviceView assembly. Kept apart from the hub so neither file crosses 400 lines. */
import type { DeviceView, TaalcutError } from '@taalcut/core';
import type { BridgeDeviceRef, BridgeKind, BridgeSession, DeviceAccess, UsbDeviceInfo } from './bridge';
import { DeviceBusy, DeviceGone, DeviceLocked, DeviceUnsupported } from './errors';
import { clipText } from './text';
import { classify, hasAdb, hasStillImage, isAndroidVendor, isAppleDevice } from './usb-watch';

export type BusyHolder = 'adb-server' | 'camera-agent' | 'unknown';

export interface ViewSource {
  readonly key: string;
  readonly usb: UsbDeviceInfo | null;
  readonly refs: ReadonlyMap<BridgeKind, BridgeDeviceRef>;
  readonly session: BridgeSession | null;
  readonly connected: boolean;
  readonly timedOut: boolean;
  readonly holder: BusyHolder | null;
  readonly override: DeviceAccess | null;
}

export function toDeviceView(rec: ViewSource): DeviceView {
  const state = accessOf(rec);
  const label = clipText(preferred(rec)?.label ?? rec.usb?.product ?? '', 80) || 'Phone';
  return {
    key: rec.key,
    label,
    platform: platformOf(rec),
    bridge: rec.session?.ref.bridge ?? null,
    access: state.state,
    ...(state.state === 'busy' ? { busyHolder: state.holder } : {}),
    ...(icloud(rec) ? { iCloudPhotos: true } : {}),
    connected: rec.connected,
  };
}

export function busyHolder(error: TaalcutError): BusyHolder | null {
  if (error.code !== 'transfer.device_busy') return null;
  if (error.detail === 'adb-server' || error.detail === 'camera-agent' || error.detail === 'unknown')
    return error.detail;
  return 'unknown';
}

export function orderFromRefs(refs: ReadonlyMap<BridgeKind, BridgeDeviceRef>): readonly BridgeKind[] {
  const ref = [...refs.values()][0];
  if (ref?.platform === 'ios') return ['image-capture'];
  if (refs.has('adb')) return ['adb', 'mtp', 'image-capture'];
  if (ref?.platform === 'android') return ['mtp', 'image-capture'];
  return ref ? [ref.bridge] : [];
}

function accessOf(rec: ViewSource): DeviceAccess | { state: 'opening' } {
  if (rec.session) return rec.session.access();
  if (rec.override) return rec.override;
  if (rec.usb && isAndroidVendor(rec.usb) && !hasAdb(rec.usb) && !hasStillImage(rec.usb)) {
    return { state: 'needs-file-transfer' };
  }
  if (rec.usb && isAppleDevice(rec.usb) && !rec.refs.has('image-capture')) return { state: 'locked' };
  if (rec.timedOut && rec.refs.size === 0) return { state: 'busy', holder: rec.holder ?? 'unknown' };
  // A bridge lists the phone and nothing has asked it for access yet: it can be opened. An iPhone's
  // lock and Trust prompt only come from that open (SPEC: the hub never asks on its own).
  if (rec.refs.size > 0) return { state: 'ready' };
  return rec.usb && isAppleDevice(rec.usb) ? { state: 'locked' } : { state: 'opening' };
}

function platformOf(rec: ViewSource): DeviceView['platform'] {
  const ref = preferred(rec);
  if (ref && ref.platform !== 'other') return ref.platform;
  if (rec.usb && isAppleDevice(rec.usb)) return 'ios';
  if (rec.usb && (isAndroidVendor(rec.usb) || hasAdb(rec.usb) || hasStillImage(rec.usb))) return 'android';
  return ref?.platform ?? 'other';
}

function preferred(rec: ViewSource): BridgeDeviceRef | null {
  const order = rec.usb ? classify(rec.usb) : orderFromRefs(rec.refs);
  for (const kind of order) {
    const ref = rec.refs.get(kind);
    if (ref) return ref;
  }
  for (const ref of rec.refs.values()) return ref;
  return null;
}

function icloud(rec: ViewSource): boolean {
  if (rec.session?.ref.iCloudPhotos) return true;
  for (const ref of rec.refs.values()) if (ref.iCloudPhotos) return true;
  return false;
}

export function accessError(view: DeviceView | null): TaalcutError {
  if (!view || !view.connected) return DeviceGone();
  if (
    view.access === 'locked' ||
    view.access === 'not-trusted' ||
    view.access === 'needs-file-transfer' ||
    view.access === 'needs-debugging-allow'
  ) {
    return DeviceLocked(undefined, { detail: view.access });
  }
  if (view.access === 'busy') return DeviceBusy(undefined, { detail: view.busyHolder ?? 'unknown' });
  if (view.access === 'unsupported') return DeviceUnsupported();
  return DeviceGone();
}
