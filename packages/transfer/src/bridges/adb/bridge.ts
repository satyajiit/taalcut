// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Android Debug Bridge device bridge. Sync reads have no offset, so pull
 * truncates and rewrites. A debugging prompt is a session in
 * `needs-debugging-allow`, not a failed open; the session owns that pending
 * authentication and lets go of the interface when it closes. If the
 * authentication then fails, the card moves to `not-trusted` (unplug and
 * plug in again to be asked again) or, for a key main can't give,
 * `unsupported`. adb has no thumbnails: `thumbnail` is always null and the
 * picker shows the kind's placeholder.
 */
import { Adb, type AdbTransport } from '@yume-chan/adb';
import { CancelledError, err, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import {
  type BridgeDeviceRef,
  type BridgeSession,
  type DeviceAccess,
  type DeviceBridge,
  type PullOptions,
  type PullResult,
  type UsbDeviceInfo,
} from '../../usb/bridge';
import { BridgeFailed, DeviceBusy, DeviceGone, DeviceUnsupported } from '../../usb/errors';
import { guardBridgeSessions } from '../../usb/bridge-guard';
import { type AdbKeySource } from './credentials';
import { adbFailureCode, isAbort, isConnectionGone } from './failures';
import { listMedia, pagesOf } from './listing';
import { hashOnDevice, pullFromDevice } from './pull';
import {
  AdbAllowPending,
  AdbDeviceMissing,
  AdbInterfaceBusy,
  connectAdbTransport,
  isAdbBusyError,
  watchAdbDevices,
  type AdbPlug,
} from './transport';

export type { AdbKeySource } from './credentials';

const ADB_CLASS = 0xff;
const ADB_SUBCLASS = 0x42;
const ADB_PROTOCOL = 0x01;

type AdbLog = { info(line: string): void };

export interface AdbBridgeOptions {
  readonly keys: AdbKeySource;
  /** Phones with the adb interface as they come and go. Default: WebUSB through `usb`. */
  readonly devices?: (signal: AbortSignal) => AsyncIterable<AdbPlug>;
  /** Opens one phone. Default: claim the interface over WebUSB, then 127.0.0.1:5037 once. */
  readonly connect?: (device: UsbDeviceInfo, signal: AbortSignal) => Promise<AdbTransport>;
  /** Codes only: never a serial, a path or the key. */
  readonly log?: AdbLog;
}

export function createAdbBridge(options: AdbBridgeOptions): DeviceBridge {
  const known = new Map<string, UsbDeviceInfo>();
  const devices = options.devices ?? watchAdbDevices;
  const connect =
    options.connect ??
    ((device: UsbDeviceInfo, signal: AbortSignal) => connectAdbTransport(device, signal, options.keys));

  return guardBridgeSessions({
    kind: 'adb',
    claims(device: UsbDeviceInfo): boolean {
      return device.interfaces.some(
        (iface) => iface.cls === ADB_CLASS && iface.sub === ADB_SUBCLASS && iface.proto === ADB_PROTOCOL,
      );
    },
    async *watch(signal: AbortSignal) {
      for await (const plug of devices(signal)) {
        if (plug.type === 'removed') {
          known.delete(plug.device.locationId);
          yield { type: 'removed' as const, ref: toRef(plug.device) };
          continue;
        }
        known.set(plug.device.locationId, plug.device);
        yield { type: 'added' as const, ref: toRef(plug.device) };
      }
    },
    async open(ref: BridgeDeviceRef, signal: AbortSignal): AsyncResult<BridgeSession> {
      if (ref.bridge !== 'adb') return err(DeviceUnsupported());
      if (signal.aborted) return err(CancelledError());
      const device = known.get(ref.handle) ?? deviceFromRef(ref);
      try {
        const transport = await connect(device, signal);
        return ok(createSession(ref, { kind: 'ready', adb: new Adb(transport) }, options.log));
      } catch (error) {
        if (error instanceof AdbAllowPending) {
          return ok(createSession(ref, { kind: 'pending', pending: error }, options.log));
        }
        return err(mapConnectError(error));
      }
    },
  });
}

type SessionStart =
  | { readonly kind: 'ready'; readonly adb: Adb }
  | { readonly kind: 'pending'; readonly pending: AdbAllowPending };

function createSession(ref: BridgeDeviceRef, start: SessionStart, log: AdbLog | undefined): BridgeSession {
  let adb: Adb | undefined;
  let access: DeviceAccess = { state: 'needs-debugging-allow' };
  let closed = false;
  let gone = false;
  let pulling = false;
  const paths = new Map<string, string>();
  const listeners = new Set<(next: DeviceAccess) => void>();
  const setAccess = (next: DeviceAccess) => {
    access = next;
    for (const listener of [...listeners]) listener(next);
  };
  const adopt = (next: Adb): void => {
    adb = next;
    const markGone = (): void => {
      gone = true;
    };
    next.disconnected.then(markGone, markGone);
  };
  /** A failure on a phone that has gone away is DeviceGone, whatever the command saw. */
  const settle = <T>(result: Awaited<AsyncResult<T>>): Awaited<AsyncResult<T>> =>
    !result.ok && gone && result.error.code !== 'transfer.device_gone' ? err(DeviceGone()) : result;

  if (start.kind === 'ready') {
    adopt(start.adb);
    access = { state: 'ready' };
  } else {
    start.pending.whenReady.then(
      (transport) => {
        if (closed) {
          void closeQuietly(() => transport.close(), log);
          return;
        }
        adopt(new Adb(transport));
        setAccess({ state: 'ready' });
      },
      (error: unknown) => {
        if (closed) return;
        log?.info(`usb adb auth failed ${adbFailureCode(error)}`);
        setAccess(authFailedAccess(error));
      },
    );
  }

  return {
    ref,
    rangedReads: false,
    access: () => access,
    onAccessChange(listener: (next: DeviceAccess) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async *list(signal: AbortSignal) {
      const current = adb;
      if (!current || access.state !== 'ready') return;
      try {
        const listed = await listMedia(current, signal);
        paths.clear();
        for (const [id, path] of listed.paths) paths.set(id, path);
        yield* pagesOf(listed.items, signal);
      } catch (error) {
        if (signal.aborted || CancelledError.is(error)) return;
        throw gone ? DeviceGone() : mapOpError(error);
      }
    },
    thumbnail(_itemId: string, _signal: AbortSignal): AsyncResult<Uint8Array | null> {
      return Promise.resolve(ok(null));
    },
    pull(itemId: string, options: PullOptions): AsyncResult<PullResult> {
      return withPath(itemId, async (current, path) => {
        if (pulling) return err(BridgeFailed(undefined, { detail: 'pull' }));
        pulling = true;
        try {
          return settle(await pullFromDevice(current, path, options));
        } finally {
          pulling = false;
        }
      });
    },
    sourceHash(itemId: string, signal: AbortSignal): AsyncResult<string | null> {
      return withPath(itemId, async (current, path) => settle(await hashOnDevice(current, path, signal)));
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      listeners.clear();
      const current = adb;
      adb = undefined;
      if (current) {
        await closeQuietly(() => current.close(), log);
        return;
      }
      if (start.kind === 'pending') start.pending.cancel();
    },
  };

  function withPath<T>(itemId: string, run: (current: Adb, path: string) => AsyncResult<T>): AsyncResult<T> {
    const current = adb;
    if (access.state !== 'ready' || !current) {
      return Promise.resolve(err(BridgeFailed(undefined, { detail: access.state })));
    }
    const path = paths.get(itemId);
    if (!path) return Promise.resolve(err(BridgeFailed(undefined, { detail: 'unknown-item' })));
    return run(current, path);
  }
}

/** A key main could not give is not something the phone can fix; anything else asks again on replug. */
function authFailedAccess(error: unknown): DeviceAccess {
  if (adbFailureCode(error) === 'adb-key') return { state: 'unsupported', reason: 'adb-key' };
  return { state: 'not-trusted' };
}

/** Close a transport or connection without letting a phone that is already gone reject the caller. */
async function closeQuietly(close: () => PromiseLike<void> | void, log: AdbLog | undefined): Promise<void> {
  try {
    await close();
  } catch (error) {
    log?.info(`usb adb close failed ${adbFailureCode(error)}`);
  }
}

function toRef(device: UsbDeviceInfo): BridgeDeviceRef {
  return {
    bridge: 'adb',
    handle: device.locationId,
    identity: device.serial ?? device.locationId,
    label: device.product && device.product.trim().length > 0 ? device.product : 'Android',
    platform: 'android',
  };
}

function deviceFromRef(ref: BridgeDeviceRef): UsbDeviceInfo {
  return {
    locationId: ref.handle,
    vendorId: 0,
    productId: 0,
    serial: ref.identity,
    product: ref.label,
    interfaces: [{ cls: ADB_CLASS, sub: ADB_SUBCLASS, proto: ADB_PROTOCOL }],
  };
}

function mapConnectError(error: unknown): TaalcutError {
  if (isAbort(error)) return CancelledError();
  if (error instanceof AdbInterfaceBusy || isAdbBusyError(error))
    return DeviceBusy(undefined, { detail: 'adb-server' });
  if (error instanceof AdbDeviceMissing || isConnectionGone(error)) return DeviceGone();
  return BridgeFailed(undefined, { detail: adbFailureCode(error) });
}

function mapOpError(error: unknown): TaalcutError {
  if (isAbort(error)) return CancelledError();
  if (isConnectionGone(error)) return DeviceGone();
  return BridgeFailed(undefined, { detail: adbFailureCode(error) });
}
