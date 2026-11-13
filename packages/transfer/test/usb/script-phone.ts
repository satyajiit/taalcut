// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A scripted iPhone-shaped bridge for the pull tests: cuts, short reads and wrong source hashes on demand. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type DeviceRun } from '@taalcut/core';
import type { TransferMedia } from '../../src/deps';
import type { BridgeDeviceRef, BridgeSession, DeviceItem, UsbDeviceInfo } from '../../src/usb/bridge';
import { DeviceGone, ShortRead } from '../../src/usb/errors';
import type { FakePhone } from './fake-phone';
import { createCopySink, createHarness, untilTerminal } from './import-harness';

const selection = { filter: { onlyNew: true, timeZone: 'UTC' }, include: [], exclude: [] };
export const media: TransferMedia = {
  async probe() {
    return { ok: false as const };
  },
};

export function jpeg(size: number): Buffer {
  const body = Buffer.alloc(size);
  body[0] = 0xff;
  body[1] = 0xd8;
  body[2] = 0xff;
  return body;
}

export function item(id: string, size: number, createdAt: number): DeviceItem {
  return {
    id,
    name: `${id}.jpg`,
    kind: 'image',
    sizeBytes: size,
    createdAt,
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
  };
}

interface Note {
  readonly itemId: string;
  readonly offset: number;
  readonly n: number;
}

const PHONE: UsbDeviceInfo = {
  locationId: 'loc-iphone',
  vendorId: 0x05ac,
  productId: 0x12a8,
  serial: 'IPHONE-PULL',
  product: 'iPhone',
  interfaces: [{ cls: 6, sub: 1, proto: 1 }],
};

export function createScriptPhone(input: {
  readonly files: readonly { item: DeviceItem; bytes: Buffer }[];
  readonly wrongSource?: boolean;
  readonly cutId?: string;
  /** The bridge itself reports a short read on this item's first `times` pulls. */
  readonly shortPulls?: { readonly id: string; readonly times: number };
}): FakePhone & { readonly notes: Note[] } {
  const byId = new Map(input.files.map((file) => [file.item.id, file]));
  const usb = createQueue<{ readonly type: 'added' | 'removed'; readonly device: UsbDeviceInfo }>();
  const refs = createQueue<{ readonly type: 'added' | 'removed'; readonly ref: BridgeDeviceRef }>();
  const notes: Note[] = [];
  const counts = new Map<string, number>();
  const ref: BridgeDeviceRef = {
    bridge: 'image-capture',
    handle: 'capture-pull',
    identity: 'IPHONE-PULL',
    label: 'iPhone',
    platform: 'ios',
  };
  const phone: FakePhone & { notes: Note[] } = {
    notes,
    bridge: {
      kind: 'image-capture',
      claims: (device) => device.vendorId === 0x05ac,
      watch: (signal) => refs.iterate(signal),
      async open() {
        return ok(session());
      },
    },
    watcher: { watch: (signal) => usb.iterate(signal) },
    plug() {
      usb.push({ type: 'added', device: PHONE });
      refs.push({ type: 'added', ref });
    },
    unplug() {
      usb.push({ type: 'removed', device: PHONE });
    },
    pulls: () => notes.map((note) => note.itemId),
  };

  function session(): BridgeSession {
    return {
      ref,
      rangedReads: false,
      access: () => ({ state: 'ready' }),
      onAccessChange: () => () => undefined,
      async *list(signal) {
        const items = [...byId.values()].map((file) => file.item);
        if (!signal.aborted) yield items;
      },
      async thumbnail() {
        return ok(null);
      },
      async pull(itemId, pull) {
        const n = (counts.get(itemId) ?? 0) + 1;
        counts.set(itemId, n);
        notes.push({ itemId, offset: pull.offset, n });
        if (input.cutId === itemId && n === 1) {
          await writeFile(pull.dest, Buffer.alloc(37));
          return err(DeviceGone());
        }
        if (input.shortPulls?.id === itemId && n <= input.shortPulls.times) {
          await writeFile(pull.dest, Buffer.alloc(11));
          return err(ShortRead());
        }
        const file = byId.get(itemId);
        if (!file) return err(DeviceGone());
        await writeFile(pull.dest, file.bytes);
        return ok({
          bytes: file.bytes.length,
          sha256: createHash('sha256').update(file.bytes).digest('hex'),
          ancillary: [],
        });
      },
      async sourceHash(itemId) {
        if (input.wrongSource) return ok('0'.repeat(64));
        const file = byId.get(itemId);
        return ok(file ? createHash('sha256').update(file.bytes).digest('hex') : null);
      },
      async close() {
        return undefined;
      },
    };
  }

  return phone;
}

function createQueue<T>(): { push(event: T): void; iterate(signal: AbortSignal): AsyncIterable<T> } {
  const items: T[] = [];
  let wake: (() => void) | null = null;
  return {
    push(event) {
      items.push(event);
      const resolve = wake;
      wake = null;
      resolve?.();
    },
    iterate(signal) {
      return {
        async *[Symbol.asyncIterator]() {
          while (!signal.aborted) {
            const next = items.shift();
            if (next !== undefined) {
              yield next;
              continue;
            }
            await new Promise<void>((resolve) => {
              const finish = (): void => resolve();
              wake = finish;
              signal.addEventListener('abort', finish, { once: true });
              if (signal.aborted || items.length > 0) finish();
            });
          }
        },
      };
    },
  };
}

export async function importPhone(phone: FakePhone, root: string): Promise<DeviceRun> {
  const staging = join(root, 'staging');
  const originals = join(root, 'originals');
  const state = join(root, 'state');
  await mkdir(staging);
  await mkdir(originals);
  await mkdir(state);
  const copy = createCopySink(staging, originals, new Set());
  const service = createHarness(state, copy.sink, media, phone);
  const stop = new AbortController();
  try {
    const iter = service.devices(stop.signal)[Symbol.asyncIterator]();
    await iter.next();
    phone.plug();
    let key = '';
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      const step = await iter.next();
      if (step.done || !step.value) break;
      const found = step.value.devices.find((device) => device.connected);
      if (found) {
        key = found.key;
        break;
      }
    }
    if (key.length === 0) throw new Error('phone did not connect');
    const opened = await service.openDevice(key, stop.signal);
    if (!opened.ok) throw new Error(opened.error.code);
    const started = await service.importFromDevice({ deviceKey: key, selection }, stop.signal);
    if (!started.ok) throw new Error(started.error.code);
    return await untilTerminal(service, started.value.runId, stop.signal);
  } finally {
    stop.abort();
  }
}
