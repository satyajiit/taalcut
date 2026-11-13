// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Fakes for the hub tests: a scriptable USB queue, bridges with access states, and a settle loop. */
import { createManualClock, err, ok, type DeviceView } from '@taalcut/core';
import type {
  BridgeDeviceRef,
  BridgeKind,
  BridgeSession,
  DeviceAccess,
  DeviceBridge,
  UsbDeviceInfo,
  UsbWatcher,
} from '../../src/usb/bridge';
import { deviceKey } from '../../src/usb/device-key';
import { DeviceBusy } from '../../src/usb/errors';
import { createDeviceHub, type DeviceHub } from '../../src/usb/hub';

const hubs: DeviceHub[] = [];

/** For each test file's afterEach: stops every hub the test retained. */
export function releaseHubs(): void {
  for (const hub of hubs.splice(0)) hub.release();
}

export function trackHub(hub: DeviceHub): void {
  hubs.push(hub);
}

export function queue<T>(): { push(event: T): void; iterate(signal: AbortSignal): AsyncIterable<T> } {
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

export async function until(read: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (read()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('hub did not settle');
}

export function usb(input: {
  readonly serial: string;
  readonly vendorId: number;
  readonly product: string;
  readonly interfaces?: UsbDeviceInfo['interfaces'];
}): UsbDeviceInfo {
  return {
    locationId: `loc-${input.serial}`,
    vendorId: input.vendorId,
    productId: 0x1000,
    serial: input.serial,
    product: input.product,
    interfaces: input.interfaces ?? [],
  };
}

export interface Scripted {
  readonly bridge: DeviceBridge;
  readonly ref: BridgeDeviceRef;
  push(): void;
  opens(): number;
  session(): ScriptSession | null;
}

export interface ScriptSession extends BridgeSession {
  setAccess(next: DeviceAccess): void;
  closed(): boolean;
}

export function createBridge(input: {
  readonly kind: BridgeKind;
  readonly identity: string;
  readonly label: string;
  readonly platform: BridgeDeviceRef['platform'];
  readonly access: DeviceAccess;
  readonly fail?: boolean;
}): Scripted {
  const events = queue<{ readonly type: 'added' | 'removed'; readonly ref: BridgeDeviceRef }>();
  const ref: BridgeDeviceRef = {
    bridge: input.kind,
    handle: `${input.kind}-1`,
    identity: input.identity,
    label: input.label,
    platform: input.platform,
  };
  let opens = 0;
  let current: ScriptSession | null = null;
  const bridge: DeviceBridge = {
    kind: input.kind,
    claims: () => true,
    watch: (signal) => events.iterate(signal),
    async open() {
      opens += 1;
      if (input.fail) return err(DeviceBusy(undefined, { detail: 'adb-server' }));
      let access = input.access;
      let isClosed = false;
      let releaseList: (() => void) | null = null;
      const listeners = new Set<(next: DeviceAccess) => void>();
      const session: ScriptSession = {
        ref,
        rangedReads: false,
        access: () => access,
        onAccessChange(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        setAccess(next) {
          access = next;
          for (const listener of listeners) listener(next);
        },
        closed: () => isClosed,
        async *list() {
          yield [];
          await new Promise<void>((resolve) => {
            releaseList = resolve;
          });
        },
        async thumbnail() {
          return ok(null);
        },
        async pull() {
          return err(DeviceBusy(undefined, { detail: 'unknown' }));
        },
        async close() {
          isClosed = true;
          releaseList?.();
        },
      };
      current = session;
      return ok(session);
    },
  };
  return {
    bridge,
    ref,
    push: () => events.push({ type: 'added', ref }),
    opens: () => opens,
    session: () => current,
  };
}

export function watchOf(
  events: ReturnType<typeof queue<{ type: 'added' | 'removed'; device: UsbDeviceInfo }>>,
): UsbWatcher {
  return { watch: (signal) => events.iterate(signal) };
}

export function setup(bridges: readonly DeviceBridge[], watcher: UsbWatcher): DeviceHub {
  const hub = createDeviceHub({ bridges, watcher, clock: createManualClock(1_700_000_000_000) });
  hubs.push(hub);
  hub.retain();
  return hub;
}

export const adbIface = [{ cls: 0xff, sub: 0x42, proto: 0x01 }];

export async function connect(
  hub: DeviceHub,
  events: ReturnType<typeof queue<{ type: 'added' | 'removed'; device: UsbDeviceInfo }>>,
  device: UsbDeviceInfo,
  refs: readonly Scripted[],
): Promise<DeviceView> {
  const key = deviceKey(device.serial ?? device.locationId);
  events.push({ type: 'added', device });
  await until(() => hub.view(key) !== null);
  for (const ref of refs) ref.push();
  await until(() => {
    const current = hub.view(key);
    if (!current?.connected) return false;
    return refs.length === 0 || current.platform !== 'android' || current.access !== 'opening';
  });
  const view = hub.view(key);
  if (!view) throw new Error('missing view');
  return view;
}
