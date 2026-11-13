// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * USB import from a connected phone (P3-B4 iPhone, P3-B5 Android): devices, their items, a filtered selection
 * and the import run. Spread into appContract.transfer (owner lan), served by @taalcut/transfer's device bridges.
 * Keys are base32 hashes, never a serial or a file name; thumbnails are served at deviceThumbUrl.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { publicErrorSchema } from '../basics/error-schema';
import { idSchema } from '../basics/ids';
import { deviceRunItemsProcedure } from '../imports/device-receipts';
import { eventIterator, ipc } from '../ipc/contract';
import { TRANSFER_PLATFORMS } from './transfer-platforms';

const count = z.int().nonnegative();
const epochMs = z.int().nonnegative();

/** base32(sha256(...)).slice(0, 16). */
export const DEVICE_KEY_PATTERN = /^[A-Z2-7]{16}$/;
export const deviceKeySchema = z.string().regex(DEVICE_KEY_PATTERN);
/** An item's key on its device, the same shape. */
export const deviceItemKeySchema = z.string().regex(DEVICE_KEY_PATTERN);

export const DEVICE_BRIDGE_KINDS = ['image-capture', 'adb', 'mtp'] as const;
export type DeviceBridgeKind = (typeof DEVICE_BRIDGE_KINDS)[number];

export const DEVICE_ACCESS_STATES = [
  'opening',
  'ready',
  'locked',
  'not-trusted',
  'needs-file-transfer',
  'needs-debugging-allow',
  'busy',
  'unsupported',
] as const;
export type DeviceAccessState = (typeof DEVICE_ACCESS_STATES)[number];
export const DEVICE_BUSY_HOLDERS = ['adb-server', 'camera-agent', 'unknown'] as const;

export const deviceViewSchema = z.object({
  key: deviceKeySchema,
  /** "Satya's iPhone": plain text. */
  label: z.string().max(80),
  platform: z.enum(TRANSFER_PLATFORMS),
  /** The bridge serving it; null before one has opened it. */
  bridge: z.enum(DEVICE_BRIDGE_KINDS).nullable(),
  access: z.enum(DEVICE_ACCESS_STATES),
  busyHolder: z.enum(DEVICE_BUSY_HOLDERS).optional(),
  /** iCloud Photos is on: some items may not be on the phone. */
  iCloudPhotos: z.boolean().optional(),
  /** 0 to 100 while the device builds its catalogue. */
  catalogPercent: z.number().min(0).max(100).optional(),
  items: count.optional(),
  connected: z.boolean(),
  /** A run that stopped part-way and can carry on. */
  unfinishedRunId: idSchema<'DeviceImportRun'>().optional(),
});
export type DeviceView = z.output<typeof deviceViewSchema>;

export const DEVICE_ITEM_KINDS = ['video', 'image'] as const;
export const DEVICE_ITEM_FLAGS = ['live', 'slowMo', 'timeLapse', 'prores', 'burst'] as const;
export const DEVICE_ITEM_IMPORTED = ['no', 'yes', 'in-icloud'] as const;

export const deviceItemViewSchema = z.object({
  key: deviceItemKeySchema,
  /** The phone's file name, sanitised: plain text. */
  name: z.string().max(255),
  kind: z.enum(DEVICE_ITEM_KINDS),
  sizeBytes: count,
  createdAt: epochMs.nullable(),
  durationMs: count.nullable(),
  width: count.nullable(),
  height: count.nullable(),
  /** Android folder or bucket; null on iPhone. */
  album: z.string().max(120).nullable(),
  flags: z.array(z.enum(DEVICE_ITEM_FLAGS)).max(DEVICE_ITEM_FLAGS.length),
  imported: z.enum(DEVICE_ITEM_IMPORTED),
  /** A thumbnail is served at deviceThumbUrl(deviceKey, key). */
  thumb: z.boolean(),
});
export type DeviceItemView = z.output<typeof deviceItemViewSchema>;

export const DEVICE_FILTER_KINDS = ['video', 'image', 'live', 'slowMo', 'prores'] as const;

export const deviceFilterSchema = z.object({
  /** Local dates, inclusive, in `timeZone`. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  kinds: z.array(z.enum(DEVICE_FILTER_KINDS)).max(DEVICE_FILTER_KINDS.length).optional(),
  albums: z.array(z.string().max(120)).max(50).optional(),
  /** Not yet imported from this phone (with assets the library still has). */
  onlyNew: z.boolean().default(true),
  /** IANA zone from the window's Intl. */
  timeZone: z.string().min(1).max(64),
});
export type DeviceFilter = z.output<typeof deviceFilterSchema>;

export const deviceSelectionSchema = z.object({
  filter: deviceFilterSchema,
  include: z.array(deviceItemKeySchema).max(10_000).default([]),
  exclude: z.array(deviceItemKeySchema).max(10_000).default([]),
});
export type DeviceSelection = z.output<typeof deviceSelectionSchema>;

export const deviceItemsPageSchema = z.object({
  /** Newest first. */
  items: z.array(deviceItemViewSchema).max(500),
  nextCursor: z.string().max(64).optional(),
  /** Items matching the filter. */
  total: count,
});

export const deviceSummarySchema = z.object({
  items: count,
  bytes: count,
  newItems: count,
  months: z
    .array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), items: count, bytes: count }))
    .max(600),
  albums: z.array(z.object({ name: z.string().max(120), items: count })).max(200),
});

export const DEVICE_RUN_STATES = ['running', 'paused', 'succeeded', 'failed', 'cancelled'] as const;
export const DEVICE_RUN_PAUSE_REASONS = [
  'person',
  'device-gone',
  'locked',
  'disk-full',
  'originals-offline',
] as const;

export const deviceRunSchema = z.object({
  id: idSchema<'DeviceImportRun'>(),
  deviceKey: deviceKeySchema,
  deviceLabel: z.string().max(80),
  /** The run's usb_import source, once its first item is in. */
  sourceId: idSchema<'Source'>().nullable(),
  state: z.enum(DEVICE_RUN_STATES),
  pauseReason: z.enum(DEVICE_RUN_PAUSE_REASONS).optional(),
  totals: z.object({
    items: count,
    bytes: count,
    done: count,
    bytesDone: count,
    imported: count,
    duplicates: count,
    inICloud: count,
    rejected: count,
    failed: count,
    /** Imported, but the device sent a converted copy (reencode 'device-converted'). */
    converted: count,
  }),
  bytesPerSecond: count.optional(),
  etaMs: count.optional(),
  startedAt: epochMs,
  updatedAt: epochMs,
  error: publicErrorSchema.optional(),
});
export type DeviceRun = z.output<typeof deviceRunSchema>;

export const devicesStateSchema = z.object({
  devices: z.array(deviceViewSchema).max(16),
  runs: z.array(deviceRunSchema).max(16),
});
export type DevicesState = z.output<typeof devicesStateSchema>;

const deviceKey = deviceKeySchema;
const runId = idSchema<'DeviceImportRun'>();

/** Spread into transferContract (namespace `transfer`, owner `lan`). */
export const deviceProcedures = {
  deviceRunItems: deviceRunItemsProcedure,
  /** The devices and unfinished runs first, then every change; USB is watched only while this is open or a run is. */
  devices: ipc.output(eventIterator(devicesStateSchema)),
  /** The person opened this phone: the bridge opens it (Trust / Allow prompts appear now). */
  openDevice: ipc.input(z.object({ deviceKey })).output(deviceViewSchema),
  deviceItems: ipc
    .input(
      z.object({
        deviceKey,
        filter: deviceFilterSchema,
        cursor: z.string().max(64).optional(),
        limit: z.int().min(1).max(500).default(200),
      }),
    )
    .output(deviceItemsPageSchema),
  deviceSummary: ipc.input(z.object({ deviceKey, filter: deviceFilterSchema })).output(deviceSummarySchema),
  /** transfer.disk_full, transfer.run_in_progress, transfer.device_gone, library.originals_offline. */
  importFromDevice: ipc
    .input(z.object({ deviceKey, selection: deviceSelectionSchema }))
    .output(z.object({ runId })),
  /** The run's state first, then every change (at most 4 a second). */
  deviceRun: ipc.input(z.object({ runId })).output(eventIterator(deviceRunSchema)),
  pauseDeviceImport: ipc.input(z.object({ runId })).output(deviceRunSchema),
  resumeDeviceImport: ipc.input(z.object({ runId })).output(deviceRunSchema),
  cancelDeviceImport: ipc.input(z.object({ runId })).output(deviceRunSchema),
  /** Settings › Privacy: phones ask "Allow USB debugging?" again. */
  forgetUsbDebugKey: ipc.output(z.object({ forgotten: z.boolean() })),
};
