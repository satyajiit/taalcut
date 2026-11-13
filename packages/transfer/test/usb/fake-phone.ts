// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** An ImageCapture-shaped phone and the USB bus event the hub watches. */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { err, ok } from '@taalcut/core';
import type {
  BridgeDeviceRef,
  BridgeSession,
  DeviceBridge,
  DeviceItem,
  UsbDeviceInfo,
  UsbWatcher,
} from '../../src/usb/bridge';
import { BridgeFailed, DeviceGone } from '../../src/usb/errors';

const IPHONE: UsbDeviceInfo = {
  locationId: 'loc-iphone',
  vendorId: 0x05ac,
  productId: 0x12a8,
  serial: 'IPHONE-FAKE',
  product: 'iPhone',
  interfaces: [{ cls: 6, sub: 1, proto: 1 }],
};

export interface ListedFile {
  readonly item: DeviceItem;
  readonly bytes: Buffer;
}

export interface PhoneOptions {
  readonly iCloudPhotos?: boolean;
  /** `pullIndex` is 1-based. `gone` is a cable pull: the hub must already see the removal. */
  readonly onPull?: (itemId: string, pullIndex: number) => Promise<'ok' | 'gone'>;
  /**
   * What the mac helper says instead of writing bytes, per item and attempt
   * (1-based): `devices.item_empty` (ICC -21447) or `devices.download_failed`
   * (ICC -9934). Null writes the item's bytes.
   */
  readonly helperFailure?: (itemId: string, attempt: number) => string | null;
  /** The on-device hash fails for these items (an adb `sha256sum` that errors). */
  readonly sourceHashFails?: (itemId: string) => boolean;
}

export interface FakePhone {
  readonly bridge: DeviceBridge;
  readonly watcher: UsbWatcher;
  plug(): void;
  unplug(): void;
  pulls(): readonly string[];
}

type AddedOrRemoved = 'added' | 'removed';

export function createFakePhone(files: readonly ListedFile[], options: PhoneOptions = {}): FakePhone {
  const byId = new Map(files.map((file) => [file.item.id, file]));
  const usb = createQueue<{ readonly type: AddedOrRemoved; readonly device: UsbDeviceInfo }>();
  const refs = createQueue<{ readonly type: AddedOrRemoved; readonly ref: BridgeDeviceRef }>();
  const pulled: string[] = [];
  const ref: BridgeDeviceRef = {
    bridge: 'image-capture',
    handle: 'capture-1',
    identity: IPHONE.serial ?? 'IPHONE-FAKE',
    label: 'iPhone',
    platform: 'ios',
    ...(options.iCloudPhotos ? { iCloudPhotos: true } : {}),
  };
  const bridge: DeviceBridge = {
    kind: 'image-capture',
    claims: (device) => device.vendorId === 0x05ac,
    watch: (signal) => refs.iterate(signal),
    async open() {
      return ok(createSession(byId, pulled, ref, options));
    },
  };
  return {
    bridge,
    watcher: { watch: (signal) => usb.iterate(signal) },
    plug() {
      usb.push({ type: 'added', device: IPHONE });
      refs.push({ type: 'added', ref });
    },
    unplug() {
      usb.push({ type: 'removed', device: IPHONE });
    },
    pulls: () => pulled,
  };
}

function createSession(
  byId: ReadonlyMap<string, ListedFile>,
  pulled: string[],
  ref: BridgeDeviceRef,
  options: PhoneOptions,
): BridgeSession {
  let pullCount = 0;
  const attempts = new Map<string, number>();
  return {
    ref,
    rangedReads: false,
    access: () => ({ state: 'ready' }),
    onAccessChange: () => () => undefined,
    async *list(signal) {
      const items = [...byId.values()].map((file) => file.item);
      for (let index = 0; index < items.length && !signal.aborted; index += 500) {
        yield items.slice(index, index + 500);
      }
    },
    async thumbnail() {
      return ok(null);
    },
    async pull(itemId, pull) {
      pullCount += 1;
      pulled.push(itemId);
      const decision = options.onPull ? await options.onPull(itemId, pullCount) : 'ok';
      if (decision === 'gone') return err(DeviceGone());
      const attempt = (attempts.get(itemId) ?? 0) + 1;
      attempts.set(itemId, attempt);
      const failure = options.helperFailure?.(itemId, attempt) ?? null;
      if (failure) return err(BridgeFailed(undefined, { detail: failure }));
      const file = byId.get(itemId);
      if (!file) return err(DeviceGone());
      await writeFile(pull.dest, file.bytes);
      const sha256 = createHash('sha256').update(file.bytes).digest('hex');
      return ok({ bytes: file.bytes.length, sha256, ancillary: [] });
    },
    async sourceHash(itemId) {
      if (options.sourceHashFails?.(itemId))
        return err(BridgeFailed(undefined, { detail: 'adb.shell_failed' }));
      const file = byId.get(itemId);
      return ok(file ? createHash('sha256').update(file.bytes).digest('hex') : null);
    },
    async close() {
      return undefined;
    },
  };
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
