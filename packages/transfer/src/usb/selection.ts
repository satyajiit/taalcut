// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Selection rule plus explicit ids, oldest first, with the free-space check. */
import { err, ok, type AsyncResult, type DeviceSelection } from '@taalcut/core';
import { DiskFull } from '../errors';
import { TRANSFER_LIMITS } from '../limits';
import { itemKey } from './device-key';
import { oldestFirst } from './item-order';
import type { DeviceItem } from './bridge';
import type { Freshness } from './ledger';
import { matches } from './listing';

/**
 * Empty include means everything the filter matches. A non-empty include
 * intersects that set. Exclude always removes. Live Photo halves stay adjacent.
 */
export function resolveSelection(
  items: readonly DeviceItem[],
  selection: DeviceSelection,
  fresh: Freshness,
): DeviceItem[] {
  const include = new Set(selection.include);
  const exclude = new Set(selection.exclude);
  const chosen = items.filter((item) => {
    const key = itemKey(item.id);
    if (exclude.has(key)) return false;
    if (!matches(item, selection.filter, fresh)) return false;
    if (include.size > 0 && !include.has(key)) return false;
    return true;
  });
  return orderForImport(chosen);
}

/** Sum of sizes plus the 2 GiB reserve. Short space is DiskFull and no run is written. */
export async function ensureFree(
  bytes: number,
  freeBytes: number,
): AsyncResult<{ readonly need: number; readonly free: number }> {
  const need = bytes + TRANSFER_LIMITS.reserveBytes;
  if (freeBytes < need) return err(DiskFull());
  return ok({ need, free: freeBytes });
}

export function orderForImport(items: readonly DeviceItem[]): DeviceItem[] {
  const sorted = [...items].sort(oldestFirst);
  const groups = new Map<string, DeviceItem[]>();
  for (const item of sorted) {
    const group = item.flags.livePhotoGroup;
    if (!group) continue;
    const list = groups.get(group) ?? [];
    list.push(item);
    groups.set(group, list);
  }
  const emitted = new Set<string>();
  const out: DeviceItem[] = [];
  for (const item of sorted) {
    if (emitted.has(item.id)) continue;
    const group = item.flags.livePhotoGroup;
    const members = group ? (groups.get(group) ?? [item]) : [item];
    const ordered = [...members].sort(imageThenVideo);
    for (const member of ordered) {
      if (emitted.has(member.id)) continue;
      emitted.add(member.id);
      out.push(member);
    }
  }
  return out;
}

function imageThenVideo(a: DeviceItem, b: DeviceItem): number {
  if (a.kind === b.kind) return a.id < b.id ? -1 : 1;
  return a.kind === 'image' ? -1 : 1;
}
