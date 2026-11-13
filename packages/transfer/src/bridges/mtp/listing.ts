// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Walk DCIM, Pictures and Movies. `folder` is the path from the media root ("DCIM/Camera") and
 * the album is the folder the file sits in ("Camera"), both sanitised like the adb bridge's.
 * The walk stops one item past the listing limit, so the hub's drain answers too_many_items.
 */
import { chunk, err, ok, type AsyncResult } from '@taalcut/core';
import { TRANSFER_LIMITS } from '../../limits';
import { sanitiseFileName } from '../../names';
import type { DeviceItem } from '../../usb/bridge';
import { DeviceLocked } from '../../usb/errors';
import { newestFirst } from '../../usb/item-order';
import { FORMAT_ASSOCIATION, isIgnoredFolder, isMediaRoot, mediaOf } from './codes';
import type { MtpSession } from './session';

const PAGE = 500;

interface Walk {
  readonly session: MtpSession;
  readonly storage: number;
  readonly seen: Set<number>;
  readonly items: DeviceItem[];
  readonly signal: AbortSignal;
}

export async function collectMedia(session: MtpSession, signal: AbortSignal): AsyncResult<DeviceItem[]> {
  const storages = await session.storageIds(signal);
  if (!storages.ok) return storages;
  // Android exposes no MTP storage until the phone is unlocked and file access is allowed.
  if (storages.value.length === 0) return err(DeviceLocked(undefined, { detail: 'no-storage' }));
  const items: DeviceItem[] = [];
  const seen = new Set<number>();
  for (const storage of storages.value) {
    const roots = await session.handles(storage, 0, signal);
    if (!roots.ok) return roots;
    for (const handle of roots.value) {
      const walked = await walk({ session, storage, seen, items, signal }, handle, null);
      if (!walked.ok) return walked;
    }
  }
  return ok(items);
}

export function pagesOf(items: readonly DeviceItem[]): DeviceItem[][] {
  return chunk([...items].sort(newestFirst), PAGE);
}

/** `path` is null above the media roots, else the folders from the root down to `handle`'s parent. */
async function walk(state: Walk, handle: number, path: readonly string[] | null): AsyncResult<void> {
  if (state.seen.has(handle) || state.items.length > TRANSFER_LIMITS.usbMaxItems) return ok(undefined);
  const info = await state.session.info(handle, state.signal);
  if (!info.ok) return info;
  if (path === null && info.value.parent !== 0 && info.value.parent !== 0xffff_ffff) {
    return ok(undefined);
  }
  state.seen.add(handle);
  if (info.value.format === FORMAT_ASSOCIATION) {
    if (path === null && !isMediaRoot(info.value.name)) return ok(undefined);
    if (path !== null && isIgnoredFolder(info.value.name)) return ok(undefined);
    const here = [...(path ?? []), sanitiseFileName(info.value.name)];
    const children = await state.session.handles(state.storage, handle, state.signal);
    if (!children.ok) return children;
    for (const child of children.value) {
      const nested = await walk(state, child, here);
      if (!nested.ok) return nested;
    }
    return ok(undefined);
  }
  if (path === null) return ok(undefined);
  const media = mediaOf(info.value.format);
  if (!media) return ok(undefined);
  state.items.push({
    id: String(handle),
    name: sanitiseFileName(info.value.name),
    kind: media.kind,
    sizeBytes: info.value.size,
    createdAt: info.value.createdAt,
    modifiedAt: info.value.modifiedAt,
    width: media.kind === 'image' && info.value.width > 0 ? info.value.width : null,
    height: media.kind === 'image' && info.value.height > 0 ? info.value.height : null,
    durationMs: null,
    type: media.type,
    folder: path.join('/'),
    album: path[path.length - 1] ?? null,
    flags: {},
    sidecars: [],
    availability: 'local',
  });
  return ok(undefined);
}
