// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** In-memory catalogue: filters, pages (newest first) and the month histogram. */
import { err, isTaalcutError, ok, type AsyncResult } from '@taalcut/core';
import type { DeviceFilter } from '@taalcut/core';
import { DeviceGone, TooManyItems } from './errors';
import { TRANSFER_LIMITS } from '../limits';
import { itemKey } from './device-key';
import { newestFirst } from './item-order';
import { sanitiseFileName } from '../names';
import type { DeviceItem, DeviceItemsPage, DeviceSummary, DeviceViewItem } from './bridge';
import type { Freshness } from './ledger';

const PAGE_CAP = 500;

export async function drainListing(
  list: AsyncIterable<readonly DeviceItem[]>,
  signal: AbortSignal,
): AsyncResult<DeviceItem[]> {
  const items: DeviceItem[] = [];
  try {
    for await (const page of list) {
      if (signal.aborted) return err(DeviceGone());
      for (const item of page) {
        items.push(item);
        if (items.length > TRANSFER_LIMITS.usbMaxItems) return err(TooManyItems());
      }
    }
  } catch (cause) {
    // A bridge's own error (too many items, a failed helper) is kept; anything else is the phone going away.
    return err(isTaalcutError(cause) ? cause : DeviceGone());
  }
  if (signal.aborted) return err(DeviceGone());
  return ok(items);
}

export function pageItems(
  items: readonly DeviceItem[],
  filter: DeviceFilter,
  cursor: string | undefined,
  limit: number,
  fresh: Freshness,
  thumb: (item: DeviceItem) => boolean,
): DeviceItemsPage {
  const matched = items.filter((item) => matches(item, filter, fresh)).sort(newestFirst);
  const start = parseCursor(cursor);
  const size = Math.min(PAGE_CAP, Math.max(1, limit));
  const slice = matched.slice(start, start + size);
  const next = start + size < matched.length ? String(start + size) : undefined;
  return {
    items: slice.map((item) => toView(item, fresh, thumb(item))),
    ...(next ? { nextCursor: next } : {}),
    total: matched.length,
  };
}

export function summarise(
  items: readonly DeviceItem[],
  filter: DeviceFilter,
  fresh: Freshness,
): DeviceSummary {
  const matched = items.filter((item) => matches(item, filter, fresh));
  const months = new Map<string, { items: number; bytes: number }>();
  const albums = new Map<string, number>();
  let bytes = 0;
  let newItems = 0;
  for (const item of matched) {
    bytes += item.sizeBytes;
    if (fresh.isNew(item)) newItems += 1;
    const month = monthOf(item.createdAt, filter.timeZone);
    if (month) {
      const bucket = months.get(month) ?? { items: 0, bytes: 0 };
      bucket.items += 1;
      bucket.bytes += item.sizeBytes;
      months.set(month, bucket);
    }
    if (item.album && item.album.length > 0) albums.set(item.album, (albums.get(item.album) ?? 0) + 1);
  }
  return {
    items: matched.length,
    bytes,
    newItems,
    months: [...months.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(0, 600)
      .map(([month, bucket]) => ({ month, items: bucket.items, bytes: bucket.bytes })),
    albums: [...albums.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(0, 200)
      .map(([name, count]) => ({ name: name.slice(0, 120), items: count })),
  };
}

export function matches(item: DeviceItem, filter: DeviceFilter, fresh: Freshness): boolean {
  if ((filter.onlyNew ?? true) && !fresh.isNew(item)) return false;
  if (!inDates(item, filter)) return false;
  if (!inKinds(item, filter.kinds)) return false;
  if (!inAlbums(item, filter.albums)) return false;
  return true;
}

function toView(item: DeviceItem, fresh: Freshness, hasThumb: boolean): DeviceViewItem {
  const flags: DeviceViewItem['flags'][number][] = [];
  if (item.flags.livePhotoGroup) flags.push('live');
  if (item.flags.highFrameRate) flags.push('slowMo');
  if (item.flags.timeLapse) flags.push('timeLapse');
  if (item.flags.prores) flags.push('prores');
  if (item.flags.burst) flags.push('burst');
  return {
    key: itemKey(item.id),
    name: sanitiseFileName(item.name).slice(0, 255),
    kind: item.kind,
    sizeBytes: item.sizeBytes,
    createdAt: item.createdAt,
    durationMs: item.durationMs,
    width: item.width,
    height: item.height,
    album: item.album ? item.album.slice(0, 120) : null,
    flags,
    imported: fresh.imported(item),
    thumb: hasThumb,
  };
}

function inDates(item: DeviceItem, filter: DeviceFilter): boolean {
  if (!filter.from && !filter.to) return true;
  if (item.createdAt === null) return false;
  const date = localDate(item.createdAt, filter.timeZone);
  if (filter.from && date < filter.from) return false;
  if (filter.to && date > filter.to) return false;
  return true;
}

function inKinds(item: DeviceItem, kinds: DeviceFilter['kinds']): boolean {
  if (!kinds || kinds.length === 0) return true;
  return kinds.some((kind) => {
    if (kind === 'video' || kind === 'image') return item.kind === kind;
    if (kind === 'live') return Boolean(item.flags.livePhotoGroup);
    if (kind === 'slowMo') return item.flags.highFrameRate === true;
    return item.flags.prores === true;
  });
}

function inAlbums(item: DeviceItem, albums: DeviceFilter['albums']): boolean {
  if (!albums || albums.length === 0) return true;
  return item.album !== null && albums.includes(item.album);
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  if (!/^\d+$/.test(cursor)) return 0;
  const value = Number(cursor);
  return Number.isSafeInteger(value) ? value : 0;
}

export function localDate(epochMs: number, timeZone: string): string {
  const parts = partsOf(epochMs, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function monthOf(epochMs: number | null, timeZone: string): string | null {
  if (epochMs === null) return null;
  const parts = partsOf(epochMs, timeZone);
  return `${parts.year}-${parts.month}`;
}

function partsOf(epochMs: number, timeZone: string): { year: string; month: string; day: string } {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }
  const parts = formatter.formatToParts(new Date(epochMs));
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '00';
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}
