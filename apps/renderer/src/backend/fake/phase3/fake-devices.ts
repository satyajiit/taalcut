// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A phone on a cable (P3-B4, P3-B5) as the lan process serves it, in the devices lane's shapes
 * (core's deviceProcedures): `transfer.devices` streams what is plugged in and its access state; opening it walks
 * the scripted prompts (an iPhone: Unlock, then Trust; an Android phone: File transfer), then the summary for a
 * filter and an import run that ticks to done. The scenario option picks what is plugged in (none, an iPhone, an
 * Android phone, an iPhone with iCloud Photos).
 */
import {
  newId,
  NotFoundError,
  toRpcError,
  type DeviceAccessState,
  type DeviceFilter,
  type DeviceImportRunId,
  type DeviceRun,
  type DevicesState,
  type DeviceView,
} from '@taalcut/core';
import { prng } from '../library/seed';
import { watched, type Watched } from '../watch';

export const USB_SCENARIOS = ['none', 'iphone', 'android', 'iphone-icloud'] as const;
export type UsbScenario = (typeof USB_SCENARIOS)[number];

export interface FakeDevicesOptions {
  /** What is plugged in when the page opens. Default: nothing. */
  readonly scenario?: UsbScenario;
  /** Milliseconds between the prompts and between import ticks; 0 is at once. */
  readonly tickMs?: number;
}

interface Item {
  readonly createdAt: number;
  readonly kind: 'video' | 'image';
  readonly live: boolean;
  readonly sizeBytes: number;
}

const DAY = 86_400_000;

interface RunEntry {
  run: DeviceRun;
  readonly watch: Watched<DeviceRun>;
  step: () => void;
}
const IPHONE_KEY = 'ABCDEFGHJKMNPQRS';
const ANDROID_KEY = 'ZYXWVUTSRQPNMKJH';

function items(now: number): Item[] {
  const random = prng(77);
  return Array.from({ length: 240 }, (_, i) => {
    const kind = random() < 0.55 ? 'video' : 'image';
    return {
      createdAt: now - Math.floor((i / 240) * 120 * DAY + random() * DAY),
      kind,
      live: kind === 'image' && random() < 0.4,
      sizeBytes: kind === 'video' ? Math.round(30e6 + random() * 120e6) : Math.round(2e6 + random() * 3e6),
    };
  });
}

const isoDay = (at: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(at),
  );

function matches(item: Item, filter: DeviceFilter): boolean {
  const day = isoDay(item.createdAt, filter.timeZone);
  if (filter.from && day < filter.from) return false;
  if (filter.to && day > filter.to) return false;
  const kinds = filter.kinds ?? ['video', 'image'];
  if (item.kind === 'video') return kinds.includes('video');
  return item.live ? kinds.includes('live') || kinds.includes('image') : kinds.includes('image');
}

/* eslint-disable lingui/no-unlocalized-strings -- the phone's own name, as it reports it: data */
const deviceFor = (platform: 'ios' | 'android', icloud: boolean): DeviceView => ({
  key: platform === 'ios' ? IPHONE_KEY : ANDROID_KEY,
  label: platform === 'ios' ? 'Satya’s iPhone' : 'Pixel 9',
  platform,
  bridge: null,
  access: platform === 'ios' ? 'locked' : 'needs-file-transfer',
  connected: true,
  ...(icloud ? { iCloudPhotos: true } : {}),
});
/* eslint-enable lingui/no-unlocalized-strings */

export interface FakeDevices {
  readonly watch: Watched<DevicesState>;
  open(deviceKey: string): DeviceView;
  summary(
    deviceKey: string,
    filter: DeviceFilter,
  ): {
    items: number;
    bytes: number;
    newItems: number;
    months: { month: string; items: number; bytes: number }[];
    albums: { name: string; items: number }[];
  };
  importFrom(deviceKey: string, filter: DeviceFilter): { runId: DeviceImportRunId };
  run(runId: DeviceImportRunId): Watched<DeviceRun>;
  setRunState(runId: DeviceImportRunId, state: 'running' | 'paused' | 'cancelled'): DeviceRun;
}

export function createFakeDevices(now: () => number, options: FakeDevicesOptions = {}): FakeDevices {
  const scenario = options.scenario ?? 'none';
  const tick = options.tickMs ?? 700;
  const library = items(now());
  let device: DeviceView | null =
    scenario === 'none'
      ? null
      : deviceFor(scenario === 'android' ? 'android' : 'ios', scenario === 'iphone-icloud');
  const runs = new Map<string, RunEntry>();
  const watch = watched<DevicesState>(() => ({
    devices: device ? [{ ...device }] : [],
    runs: [...runs.values()].map((each) => each.run),
  }));
  const later = (fn: () => void) => (tick > 0 ? setTimeout(fn, tick) : fn());
  const access = (next: DeviceAccessState) => {
    if (!device) return;
    device = { ...device, access: next, bridge: device.platform === 'ios' ? 'image-capture' : 'mtp' };
    if (next === 'ready') device = { ...device, items: library.length };
    watch.notify();
  };
  const known = (deviceKey: string) => {
    if (!device || device.key !== deviceKey)
      throw toRpcError(NotFoundError({ entity: 'device', id: deviceKey }));
    return device;
  };

  return {
    watch,
    open(deviceKey) {
      const current = known(deviceKey);
      // The prompts on the phone, as the person answers them: unlock, then Trust (iPhone) or File transfer.
      if (current.platform === 'ios' && current.access === 'locked') {
        later(() => {
          access('not-trusted');
          later(() => access('ready'));
        });
      } else if (current.access !== 'ready') {
        later(() => access('ready'));
      }
      return { ...current };
    },
    summary(deviceKey, filter) {
      known(deviceKey);
      const chosen = library.filter((item) => matches(item, filter));
      const months = new Map<string, { items: number; bytes: number }>();
      for (const item of chosen) {
        const month = isoDay(item.createdAt, filter.timeZone).slice(0, 7);
        const entry = months.get(month) ?? { items: 0, bytes: 0 };
        entry.items += 1;
        entry.bytes += item.sizeBytes;
        months.set(month, entry);
      }
      return {
        items: chosen.length,
        bytes: chosen.reduce((sum, item) => sum + item.sizeBytes, 0),
        newItems: chosen.length,
        months: [...months].map(([month, entry]) => ({ month, ...entry })),
        albums: [],
      };
    },
    importFrom(deviceKey, filter) {
      const current = known(deviceKey);
      const chosen = library.filter((item) => matches(item, filter));
      const id = newId<'DeviceImportRun'>();
      const bytes = chosen.reduce((sum, item) => sum + item.sizeBytes, 0);
      const first: DeviceRun = {
        id,
        deviceKey,
        deviceLabel: current.label,
        sourceId: null,
        state: 'running',
        totals: {
          items: chosen.length,
          bytes,
          done: 0,
          bytesDone: 0,
          imported: 0,
          duplicates: 0,
          inICloud: 0,
          rejected: 0,
          failed: 0,
          converted: 0,
        },
        bytesPerSecond: 80_000_000,
        etaMs: Math.round((bytes / 80_000_000) * 1000),
        startedAt: now(),
        updatedAt: now(),
      };
      const entry: RunEntry = {
        run: first,
        watch: watched((): DeviceRun => entry.run),
        step: () => undefined,
      };
      runs.set(id, entry);
      entry.step = () => {
        const run = entry.run;
        if (run.state !== 'running') return;
        const done = Math.min(
          run.totals.items,
          run.totals.done + Math.max(1, Math.ceil(run.totals.items / 8)),
        );
        const bytesDone = Math.round((done / Math.max(1, run.totals.items)) * run.totals.bytes);
        const finished = done >= run.totals.items;
        entry.run = {
          ...run,
          sourceId: run.sourceId ?? newId<'Source'>(),
          state: finished ? 'succeeded' : 'running',
          totals: { ...run.totals, done, bytesDone, imported: done },
          etaMs: finished ? 0 : Math.round(((run.totals.bytes - bytesDone) / 80_000_000) * 1000),
          updatedAt: now(),
        };
        entry.watch.notify();
        watch.notify();
        if (!finished) later(entry.step);
      };
      later(entry.step);
      watch.notify();
      return { runId: id };
    },
    run(runId) {
      const entry = runs.get(runId);
      if (!entry) throw toRpcError(NotFoundError({ entity: 'deviceRun', id: runId }));
      return entry.watch;
    },
    setRunState(runId, state) {
      const entry = runs.get(runId);
      if (!entry) throw toRpcError(NotFoundError({ entity: 'deviceRun', id: runId }));
      entry.run = {
        ...entry.run,
        state,
        ...(state === 'paused' ? { pauseReason: 'person' as const } : {}),
        updatedAt: now(),
      };
      entry.watch.notify();
      watch.notify();
      if (state === 'running') later(entry.step);
      return entry.run;
    },
  };
}
