// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Date, kind, album, Only new, include/exclude, and the free-space refusal. */
import { describe, expect, it } from 'vitest';
import type { DeviceFilter, DeviceSelection } from '@taalcut/core';
import { TRANSFER_LIMITS } from '../../src/limits';
import type { DeviceItem } from '../../src/usb/bridge';
import { itemKey } from '../../src/usb/device-key';
import type { Freshness } from '../../src/usb/ledger';
import { pageItems, summarise } from '../../src/usb/listing';
import { ensureFree, resolveSelection } from '../../src/usb/selection';

const june = Date.UTC(2024, 5, 1, 12);
const january = Date.UTC(2024, 0, 15, 12);
const december = Date.UTC(2024, 11, 2, 12);

function item(id: string, over: Partial<DeviceItem> = {}): DeviceItem {
  return {
    id,
    name: `${id}.jpg`,
    kind: 'image',
    sizeBytes: 10,
    createdAt: june,
    modifiedAt: null,
    width: null,
    height: null,
    durationMs: null,
    type: 'image/jpeg',
    folder: null,
    album: null,
    flags: {},
    sidecars: [],
    availability: 'local',
    ...over,
  };
}

function fresh(imported: ReadonlySet<string>): Freshness {
  return {
    isNew: (entry) => !imported.has(entry.id),
    imported: (entry) => (imported.has(entry.id) ? 'yes' : 'no'),
    liveAsset: () => null,
  };
}

function selection(filter: DeviceFilter, include: string[] = [], exclude: string[] = []): DeviceSelection {
  return { filter, include, exclude };
}

const allNew = fresh(new Set());
const open: DeviceFilter = { onlyNew: true, timeZone: 'UTC' };

describe('USB selection', () => {
  const catalogue = [
    item('new-june', { album: 'Camera' }),
    item('old-june', { album: 'Camera' }),
    item('january', { createdAt: january, kind: 'video', name: 'january.mov', album: 'Trips' }),
    item('december', { createdAt: december, album: 'Camera' }),
    item('undated', { createdAt: null }),
    item('live-still', { flags: { livePhotoGroup: 'pair' }, createdAt: june + 1_000 }),
    item('live-mov', {
      kind: 'video',
      name: 'live.mov',
      flags: { livePhotoGroup: 'pair' },
      createdAt: june - 1_000,
    }),
    item('slow', { kind: 'video', name: 'slow.mov', flags: { highFrameRate: true } }),
    item('prores', { kind: 'video', name: 'prores.mov', flags: { prores: true } }),
  ];

  it('filters dates, kinds, albums, and Only new', () => {
    const dated = resolveSelection(
      catalogue,
      selection({ ...open, from: '2024-03-01', to: '2024-09-01', onlyNew: false }),
      allNew,
    );
    expect(dated.map((entry) => entry.id)).not.toContain('january');
    expect(dated.map((entry) => entry.id)).not.toContain('december');
    expect(dated.map((entry) => entry.id)).not.toContain('undated');
    expect(dated.map((entry) => entry.id)).toContain('new-june');

    const videos = resolveSelection(
      catalogue,
      selection({ ...open, kinds: ['video'], onlyNew: false }),
      allNew,
    );
    expect(videos.every((entry) => entry.kind === 'video')).toBe(true);
    const live = resolveSelection(catalogue, selection({ ...open, kinds: ['live'], onlyNew: false }), allNew);
    expect(live.map((entry) => entry.id).sort()).toEqual(['live-mov', 'live-still']);
    const slow = resolveSelection(
      catalogue,
      selection({ ...open, kinds: ['slowMo'], onlyNew: false }),
      allNew,
    );
    expect(slow.map((entry) => entry.id)).toEqual(['slow']);
    const prores = resolveSelection(
      catalogue,
      selection({ ...open, kinds: ['prores'], onlyNew: false }),
      allNew,
    );
    expect(prores.map((entry) => entry.id)).toEqual(['prores']);

    const camera = resolveSelection(
      catalogue,
      selection({ ...open, albums: ['Camera'], onlyNew: false }),
      allNew,
    );
    expect(camera.every((entry) => entry.album === 'Camera')).toBe(true);
    expect(camera.map((entry) => entry.id)).not.toContain('january');

    const onlyNew = resolveSelection(catalogue, selection(open), fresh(new Set(['old-june'])));
    expect(onlyNew.map((entry) => entry.id)).not.toContain('old-june');
    expect(onlyNew.map((entry) => entry.id)).toContain('new-june');
  });

  it('intersects include, always applies exclude, and keeps a Live Photo together', () => {
    const include = [itemKey('new-june'), itemKey('january')];
    const chosen = resolveSelection(catalogue, selection(open, include, [itemKey('january')]), allNew);
    expect(chosen.map((entry) => entry.id)).toEqual(['new-june']);

    const ordered = resolveSelection(
      catalogue,
      selection({ ...open, kinds: ['live'], onlyNew: false }),
      allNew,
    );
    expect(ordered.map((entry) => entry.id)).toEqual(['live-still', 'live-mov']);
  });

  it('summarises months newest-first pages', () => {
    const filter: DeviceFilter = { onlyNew: false, timeZone: 'UTC', albums: ['Camera'] };
    const summary = summarise(catalogue, filter, allNew);
    expect(summary.months.map((month) => month.month)).toEqual(['2024-06', '2024-12']);
    const juneBucket = summary.months.find((month) => month.month === '2024-06');
    expect(juneBucket?.items).toBe(2);
    const page = pageItems(catalogue, filter, undefined, 10, allNew, () => false);
    expect(page.items[0]?.createdAt).toBe(december);
    expect(page.total).toBe(summary.items);
  });

  it('refuses a selection that leaves under 2 GiB free', async () => {
    const bytes = 100;
    const tight = await ensureFree(bytes, bytes + TRANSFER_LIMITS.reserveBytes - 1);
    expect(tight.ok).toBe(false);
    if (!tight.ok) expect(tight.error.code).toBe('transfer.disk_full');
    const room = await ensureFree(bytes, bytes + TRANSFER_LIMITS.reserveBytes);
    expect(room.ok).toBe(true);
  });
});
