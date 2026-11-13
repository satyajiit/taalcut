// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The USB port (transfer SPEC, "DeviceBridge"). OS code sits behind these
 * types. Nothing above a bridge imports `usb`, adb, or the mac helper.
 */
import {
  createToken,
  type AsyncResult,
  type DeviceBridgeKind,
  type DeviceFilter,
  type DeviceImportRunId,
  type DeviceRun,
  type DeviceReceipt,
  type DeviceSelection,
  type DeviceView,
  type DevicesState,
} from '@taalcut/core';

export type BridgeKind = DeviceBridgeKind;

/** What a bridge can see of one plugged-in device before any session is open. */
export interface BridgeDeviceRef {
  readonly bridge: BridgeKind;
  /** Opaque to everything but the bridge. Never logged. */
  readonly handle: string;
  /** What makes two bridges' refs the same phone. Never logged. */
  readonly identity: string;
  /** Plain text, for the card. Never logged. */
  readonly label: string;
  readonly platform: 'ios' | 'android' | 'other';
  /** iCloud Photos is on for this phone, when the bridge already knows. */
  readonly iCloudPhotos?: boolean;
}

export type DeviceAccess =
  | { readonly state: 'ready' }
  | { readonly state: 'locked' }
  | { readonly state: 'not-trusted' }
  | { readonly state: 'needs-file-transfer' }
  | { readonly state: 'needs-debugging-allow' }
  | { readonly state: 'busy'; readonly holder: 'adb-server' | 'camera-agent' | 'unknown' }
  | { readonly state: 'unsupported'; readonly reason: string };

export interface DeviceItemFlags {
  readonly livePhotoGroup?: string;
  readonly highFrameRate?: boolean;
  readonly timeLapse?: boolean;
  readonly prores?: boolean;
  readonly burst?: boolean;
}

export interface DeviceItem {
  /** Stable while the phone is plugged in. */
  readonly id: string;
  readonly name: string;
  readonly kind: 'video' | 'image';
  readonly sizeBytes: number;
  readonly createdAt: number | null;
  readonly modifiedAt: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationMs: number | null;
  readonly type: string | null;
  readonly folder: string | null;
  readonly album: string | null;
  readonly flags: DeviceItemFlags;
  /** Listed, never imported. */
  readonly sidecars: readonly string[];
  readonly availability: 'local' | 'cloud-only' | 'unknown';
}

export interface PullOptions {
  readonly dest: string;
  readonly offset: number;
  readonly signal: AbortSignal;
  readonly onBytes?: (received: number) => void;
}

export interface PullResult {
  readonly bytes: number;
  readonly sha256: string;
  readonly ancillary: readonly string[];
}

export interface BridgeSession {
  readonly ref: BridgeDeviceRef;
  access(): DeviceAccess;
  onAccessChange(listener: (access: DeviceAccess) => void): () => void;
  /** Pages of up to 500, newest first where the bridge can sort. */
  list(signal: AbortSignal): AsyncIterable<readonly DeviceItem[]>;
  thumbnail(itemId: string, signal: AbortSignal): AsyncResult<Uint8Array | null>;
  /** True when pull() honours `offset`. */
  readonly rangedReads: boolean;
  pull(itemId: string, options: PullOptions): AsyncResult<PullResult>;
  sourceHash?(itemId: string, signal: AbortSignal): AsyncResult<string | null>;
  close(): Promise<void>;
}

/** Hot-plug facts. The serial stays here and in device-key.ts; it is never logged. */
export interface UsbDeviceInfo {
  readonly locationId: string;
  readonly vendorId: number;
  readonly productId: number;
  readonly serial: string | null;
  readonly product: string | null;
  readonly interfaces: readonly { readonly cls: number; readonly sub: number; readonly proto: number }[];
}

export interface DeviceBridge {
  readonly kind: BridgeKind;
  /** Whether this bridge may serve a USB device the watcher saw. Pure. */
  claims(device: UsbDeviceInfo): boolean;
  /** Refs this bridge sees. Starts its sidecar lazily; ends with the signal. */
  watch(
    signal: AbortSignal,
  ): AsyncIterable<{ readonly type: 'added' | 'removed'; readonly ref: BridgeDeviceRef }>;
  open(ref: BridgeDeviceRef, signal: AbortSignal): AsyncResult<BridgeSession>;
}

export interface UsbWatcher {
  watch(
    signal: AbortSignal,
  ): AsyncIterable<{ readonly type: 'added' | 'removed'; readonly device: UsbDeviceInfo }>;
}

export const DeviceBridgesToken = createToken<readonly DeviceBridge[]>('transfer.deviceBridges');
export const UsbWatcherToken = createToken<UsbWatcher>('transfer.usbWatcher');

/** A page of deviceItems. Matches core's deviceItemsPageSchema. */
export interface DeviceItemsPage {
  readonly items: readonly DeviceViewItem[];
  readonly nextCursor?: string;
  readonly total: number;
}

/**
 * One row of deviceItems. `key` is itemKey(item.id), not the bridge id.
 * Kept structural so this file does not import the zod schema value.
 */
export interface DeviceViewItem {
  readonly key: string;
  readonly name: string;
  readonly kind: 'video' | 'image';
  readonly sizeBytes: number;
  readonly createdAt: number | null;
  readonly durationMs: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly album: string | null;
  readonly flags: readonly ('live' | 'slowMo' | 'timeLapse' | 'prores' | 'burst')[];
  readonly imported: 'no' | 'yes' | 'in-icloud';
  readonly thumb: boolean;
}

export interface DeviceSummary {
  readonly items: number;
  readonly bytes: number;
  readonly newItems: number;
  readonly months: readonly { readonly month: string; readonly items: number; readonly bytes: number }[];
  readonly albums: readonly { readonly name: string; readonly items: number }[];
}

/** What transferRouter's device procedures call. */
export interface DeviceService {
  devices(signal: AbortSignal): AsyncIterable<DevicesState>;
  openDevice(deviceKey: string, signal: AbortSignal): AsyncResult<DeviceView>;
  deviceItems(
    input: {
      readonly deviceKey: string;
      readonly filter: DeviceFilter;
      readonly cursor?: string;
      readonly limit: number;
    },
    signal: AbortSignal,
  ): AsyncResult<DeviceItemsPage>;
  deviceSummary(
    input: { readonly deviceKey: string; readonly filter: DeviceFilter },
    signal: AbortSignal,
  ): AsyncResult<DeviceSummary>;
  importFromDevice(
    input: { readonly deviceKey: string; readonly selection: DeviceSelection },
    signal: AbortSignal,
  ): AsyncResult<{ readonly runId: DeviceImportRunId }>;
  deviceRunItems?(input: {
    runId: DeviceImportRunId;
    cursor?: string;
    limit: number;
  }): AsyncResult<{ items: DeviceReceipt[]; nextCursor?: string }>;
  deviceRun(runId: DeviceImportRunId, signal: AbortSignal): AsyncIterable<DeviceRun>;
  pauseDeviceImport(runId: DeviceImportRunId): AsyncResult<DeviceRun>;
  resumeDeviceImport(runId: DeviceImportRunId): AsyncResult<DeviceRun>;
  cancelDeviceImport(runId: DeviceImportRunId): AsyncResult<DeviceRun>;
  forgetUsbDebugKey(): AsyncResult<{ readonly forgotten: boolean }>;
  /**
   * The lan process is stopping (SIGTERM): import runs stop for good, the progress saves still due are dropped,
   * and a save in flight finishes before this resolves, so nothing reaches a run file after it. The next
   * process offers the runs to carry on.
   */
  close(): Promise<void>;
}
