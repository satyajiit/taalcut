// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Shared stand-ins for a USB import: folders, copy sink, clock, timers, and a retained devices watch. */
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createEventBus,
  createManualClock,
  newId,
  ok,
  type AssetId,
  type DeviceRun,
  type ImportSink,
} from '@taalcut/core';
import type { TransferMedia } from '../../src/deps';
import type { DeviceItem, DeviceService } from '../../src/usb/bridge';
import type { Schedule } from '../../src/usb/schedule';
import { createDeviceService } from '../../src/usb/usb-service';
import type { FakePhone, ListedFile } from './fake-phone';
import { scratch } from './scratch';

/** A temp root with empty `staging` and `originals` folders and a `state` path (`cleanScratch` removes it). */
export async function importFolders(): Promise<{
  readonly root: string;
  readonly staging: string;
  readonly originals: string;
  readonly state: string;
}> {
  const root = await scratch('usb-import-');
  const out = {
    root,
    staging: join(root, 'staging'),
    originals: join(root, 'originals'),
    state: join(root, 'state'),
  };
  await mkdir(out.staging);
  await mkdir(out.originals);
  return out;
}

export function createCopySink(
  stagingDir: string,
  originalsDir: string,
  known: Set<AssetId>,
  hooks?: { readonly hangAt?: number; readonly onHang?: (fileName: string) => void },
): { readonly sink: ImportSink; imports(): number; names(): readonly string[] } {
  let imports = 0;
  const names: string[] = [];
  const sink: ImportSink = {
    async staging() {
      return ok({ dir: stagingDir, freeBytes: 1e15, volumeName: null });
    },
    async importStaged(file) {
      imports += 1;
      names.push(file.fileName);
      if (hooks?.hangAt !== undefined && imports === hooks.hangAt) {
        hooks.onHang?.(file.fileName);
        return new Promise(() => undefined);
      }
      await copyFile(file.path, join(originalsDir, file.fileName));
      const assetId = newId<'Asset'>();
      known.add(assetId);
      return ok({ assetId, sourceId: newId<'Source'>(), duplicate: 'none' });
    },
    async knownAssets(ids) {
      const live = new Set<AssetId>();
      for (const id of ids) if (known.has(id)) live.add(id);
      return ok(live);
    },
  };
  return { sink, imports: () => imports, names: () => names };
}

export function createHarness(
  stateDir: string,
  sink: ImportSink,
  media: TransferMedia,
  phone: FakePhone,
  options: { readonly schedule?: Schedule } = {},
): DeviceService {
  const clock = createManualClock(1_700_000_000_000);
  return createDeviceService({
    bridges: [phone.bridge],
    watcher: phone.watcher,
    importSink: sink,
    media,
    events: createEventBus({ clock }),
    clock,
    stateDir,
    forgetAdbKey: async () => false,
    ...(options.schedule ? { schedule: options.schedule } : {}),
  });
}

/** Timers that run only when the test fires them: a stopped process's timers never run at all. */
export function createManualSchedule(): { readonly schedule: Schedule; fire(ms: number): number } {
  const pending: { readonly ms: number; readonly fn: () => void; live: boolean }[] = [];
  return {
    schedule(ms, fn) {
      const timer = { ms, fn, live: true };
      pending.push(timer);
      return {
        cancel: () => {
          timer.live = false;
        },
      };
    },
    fire(ms) {
      const due = pending.filter((timer) => timer.live && timer.ms === ms);
      for (const timer of due) {
        timer.live = false;
        timer.fn();
      }
      return due.length;
    },
  };
}

/** Opens `devices()` so the hub keeps watching, then plugs the phone in. */
export async function connectPhone(
  service: DeviceService,
  phone: FakePhone,
  signal: AbortSignal,
): Promise<string> {
  const iter = service.devices(signal)[Symbol.asyncIterator]();
  await iter.next();
  phone.plug();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    const step = await iter.next();
    if (step.done || !step.value) break;
    const found = step.value.devices.find((device) => device.connected);
    if (found) return found.key;
  }
  throw new Error('phone did not connect');
}

/** The run as it is now: the first view its stream yields. */
export async function firstView(
  service: DeviceService,
  runId: DeviceRun['id'],
  signal: AbortSignal,
): Promise<DeviceRun> {
  for await (const view of service.deviceRun(runId, signal)) return view;
  throw new Error('no run view');
}

export async function untilTerminal(
  service: DeviceService,
  runId: DeviceRun['id'],
  signal: AbortSignal,
): Promise<DeviceRun> {
  for await (const view of service.deviceRun(runId, signal)) {
    if (view.state === 'succeeded' || view.state === 'failed' || view.state === 'cancelled') return view;
  }
  throw new Error('run ended before a terminal state');
}

/** `count` tiny JPEGs, oldest first. */
export function jpegs(count: number): ListedFile[] {
  return Array.from({ length: count }, (_, index) => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, index, 0xff, 0xd9]);
    const item: DeviceItem = {
      id: `item-${index}`,
      name: `IMG_${1000 + index}.JPG`,
      kind: 'image',
      sizeBytes: bytes.length,
      createdAt: 1_700_000_000_000 + index * 1000,
      modifiedAt: null,
      width: null,
      height: null,
      durationMs: null,
      type: 'image/jpeg',
      folder: 'DCIM/100APPLE',
      album: null,
      flags: {},
      sidecars: [],
      availability: 'local',
    };
    return { item, bytes };
  });
}
