// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The mac helper's `devices` JSON → transfer types. Every payload is untrusted
 * and parsed with zod here; anything malformed is `undefined` (the caller
 * turns that into a failure) and a malformed catalogue entry is dropped.
 * The helper's `uti` is already coarse (`image`, `movie`, `audio`, `data`).
 * `duration` is seconds, as ImageCaptureCore reports it. `iCloudPhotosEnabled`
 * is the device flag; items have no cloud bit unless the helper sets
 * `availability` to `cloud-only`.
 */
import { z } from 'zod';
import type { DeviceAccess, DeviceItem, DeviceItemFlags, UsbDeviceInfo } from '../../usb/bridge';
import { sanitiseFileName } from '../../names';

const APPLE_VENDOR = 0x05ac;
const MIME: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  heic: 'image/heic',
  heif: 'image/heif',
  png: 'image/png',
  gif: 'image/gif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
};

export interface MappedRef {
  bridge: 'image-capture';
  handle: string;
  identity: string;
  label: string;
  platform: 'ios' | 'other';
  iCloudPhotos?: boolean;
}

const handle = z.string().min(1);
const accessState = z.enum(['ready', 'locked', 'not-trusted', 'busy']);
const holder = z.string().optional();

/** `ready` line of the helper (protocol v2). `services` and `serviceVersions` are optional on the wire. */
export const helperReadySchema = z.object({
  type: z.literal('ready'),
  protocol: z.number(),
  services: z.array(z.string()).optional(),
  serviceVersions: z.record(z.string(), z.number()).optional(),
});

const deviceAddedSchema = z.object({
  handle,
  label: z.string().optional(),
  productKind: z.string().optional(),
  identity: z.string().optional(),
  iCloudPhotosEnabled: z.boolean().optional(),
});
const handleOnlySchema = z.object({ handle });
const accessEventSchema = z.object({ handle, state: accessState, holder });
const openSchema = z.object({
  access: accessState,
  holder,
  iCloudPhotosEnabled: z.boolean().optional(),
  count: z.number().int().nonnegative().optional(),
  ptp: z.boolean().optional(),
});
const ptpReplySchema = z.object({
  data: z.string(),
  response: z.string(),
});
const progressSchema = z.object({ handle, id: z.string().min(1), bytes: z.number().nonnegative() });
const pageSchema = z.object({ items: z.array(z.unknown()), nextCursor: z.int().nonnegative().optional() });
const itemSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  uti: z.string(),
  size: z.number().int().nonnegative(),
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.number().optional(),
  created: z.number().optional(),
  modified: z.number().optional(),
  folder: z.string().optional(),
  relatedUUID: z.string().optional(),
  burstUUID: z.string().optional(),
  highFramerate: z.boolean().optional(),
  timeLapse: z.boolean().optional(),
  sidecars: z.array(z.string()).optional(),
  availability: z.string().optional(),
});
const downloadSchema = z.object({
  file: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  ancillary: z.array(z.string()).optional(),
});
const thumbnailSchema = z.object({ path: z.string().min(1).nullable() });
const cloudSchema = z.object({ iCloudPhotosEnabled: z.boolean() });

/** Apple, an iPhone/iPad product string, or the still-image interface (6, 1, 1). */
export function claimsImageCapture(device: UsbDeviceInfo): boolean {
  if (device.vendorId === APPLE_VENDOR) return true;
  if (device.product !== null && /iPhone|iPad/i.test(device.product)) return true;
  return device.interfaces.some((iface) => iface.cls === 6 && iface.sub === 1 && iface.proto === 1);
}

/** `device.added`. Platform comes from ICC's product kind, not the helper's platform string. */
export function mapDeviceRef(value: unknown): MappedRef | undefined {
  const parsed = deviceAddedSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const added = parsed.data;
  const kind = added.productKind ?? '';
  const ref: MappedRef = {
    bridge: 'image-capture',
    handle: added.handle,
    identity: added.identity ?? '',
    label: added.label ?? '',
    platform: kind === 'iPhone' || kind === 'iPad' ? 'ios' : 'other',
  };
  if (added.iCloudPhotosEnabled !== undefined) ref.iCloudPhotos = added.iCloudPhotosEnabled;
  return ref;
}

/** `device.access` event: `{ handle, state, holder? }`. */
export function mapAccessEvent(value: unknown): DeviceAccess | undefined {
  const parsed = accessEventSchema.safeParse(value);
  return parsed.success ? toAccess(parsed.data.state, parsed.data.holder) : undefined;
}

/** `devices.open` result: `{ access, iCloudPhotosEnabled, … }`. Undefined when malformed. */
export function mapOpen(
  value: unknown,
):
  | {
      readonly access: DeviceAccess;
      readonly cloud?: boolean;
      readonly count?: number;
      readonly ptp?: boolean;
    }
  | undefined {
  const parsed = openSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const access = toAccess(parsed.data.access, parsed.data.holder);
  const cloud = parsed.data.iCloudPhotosEnabled;
  const count = parsed.data.count;
  const ptp = parsed.data.ptp;
  return {
    access,
    ...(cloud !== undefined ? { cloud } : {}),
    ...(count !== undefined ? { count } : {}),
    ...(ptp !== undefined ? { ptp } : {}),
  };
}

/** `devices.ptp` result: base64 `data` payload and 12+ byte `response` container. */
export function mapPtpReply(
  value: unknown,
): { readonly data: Uint8Array; readonly response: Uint8Array } | undefined {
  const parsed = ptpReplySchema.safeParse(value);
  if (!parsed.success) return undefined;
  return {
    data: new Uint8Array(Buffer.from(parsed.data.data, 'base64')),
    response: new Uint8Array(Buffer.from(parsed.data.response, 'base64')),
  };
}

/** The device-level iCloud flag on an event payload, if it has one. */
export function readCloud(value: unknown): boolean | undefined {
  const parsed = cloudSchema.safeParse(value);
  return parsed.success ? parsed.data.iCloudPhotosEnabled : undefined;
}

export function mapItemPage(
  value: unknown,
): { readonly items: readonly DeviceItem[]; readonly nextCursor?: number } | undefined {
  const parsed = pageSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const items: DeviceItem[] = [];
  for (const entry of parsed.data.items) {
    const item = mapHelperItem(entry);
    if (item) items.push(item);
  }
  const cursor = parsed.data.nextCursor;
  return cursor === undefined ? { items } : { items, nextCursor: cursor };
}

/** One catalogue entry. No size, an unknown kind (audio, data) or a malformed field drops it. */
export function mapHelperItem(value: unknown): DeviceItem | undefined {
  const parsed = itemSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const entry = parsed.data;
  const kind = kindOf(entry.uti);
  if (!kind) return undefined;
  const name = sanitiseFileName(entry.name);
  const flags: DeviceItemFlags = {
    ...(entry.relatedUUID ? { livePhotoGroup: entry.relatedUUID } : {}),
    ...(entry.highFramerate === true ? { highFrameRate: true } : {}),
    ...(entry.timeLapse === true ? { timeLapse: true } : {}),
    ...(entry.burstUUID ? { burst: true } : {}),
  };
  return {
    id: entry.id,
    name,
    kind,
    sizeBytes: entry.size,
    createdAt: entry.created ?? null,
    modifiedAt: entry.modified ?? null,
    width: positive(entry.width),
    height: positive(entry.height),
    durationMs: durationMs(entry.duration),
    type: mimeOf(name),
    folder: entry.folder ?? null,
    album: null,
    flags,
    sidecars: sidecarNames(entry.sidecars ?? []),
    availability: entry.availability === 'cloud-only' ? 'cloud-only' : 'unknown',
  };
}

/** `devices.download` result: the file the helper wrote and the names of what came with it. */
export function readWrittenFile(
  value: unknown,
): { readonly file: string; readonly ancillary: readonly string[] } | undefined {
  const parsed = downloadSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return { file: parsed.data.file, ancillary: parsed.data.ancillary ?? [] };
}

/** `null` when the helper has no thumbnail. `undefined` when the payload is unusable. */
export function readThumbPath(value: unknown): string | null | undefined {
  const parsed = thumbnailSchema.safeParse(value);
  return parsed.success ? parsed.data.path : undefined;
}

export function handleOf(value: unknown): string | undefined {
  const parsed = handleOnlySchema.safeParse(value);
  return parsed.success ? parsed.data.handle : undefined;
}

export function progressBytes(value: unknown): { readonly id: string; readonly bytes: number } | undefined {
  const parsed = progressSchema.safeParse(value);
  return parsed.success ? { id: parsed.data.id, bytes: Math.trunc(parsed.data.bytes) } : undefined;
}

function toAccess(state: z.infer<typeof accessState>, holderName: string | undefined): DeviceAccess {
  if (state === 'busy') return { state: 'busy', holder: busyHolder(holderName) };
  return { state };
}

function kindOf(uti: string): 'image' | 'video' | undefined {
  if (uti === 'image') return 'image';
  if (uti === 'movie') return 'video';
  return undefined;
}

function sidecarNames(names: readonly string[]): string[] {
  const cleaned: string[] = [];
  for (const entry of names) {
    if (entry.length === 0) continue;
    const name = sanitiseFileName(entry);
    if (name.length > 0) cleaned.push(name);
  }
  return cleaned;
}

function mimeOf(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return null;
  return MIME[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** ICC `duration` is a TimeInterval in seconds. */
function durationMs(seconds: number | undefined): number | null {
  if (seconds === undefined || seconds <= 0) return null;
  return Math.round(seconds * 1000);
}

function positive(value: number | undefined): number | null {
  if (value === undefined || value <= 0) return null;
  return Math.trunc(value);
}

function busyHolder(value: string | undefined): 'adb-server' | 'camera-agent' | 'unknown' {
  if (value === 'adb-server' || value === 'camera-agent') return value;
  return 'unknown';
}
