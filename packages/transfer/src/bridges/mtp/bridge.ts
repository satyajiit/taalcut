// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Android MTP initiator. Claims the still-image interface only.
 * Ranged reads resume a partial file. A failed claim is device-busy so the
 * hub can try the next bridge. Serials stay on the USB record and are not logged.
 */
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { err, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import type {
  BridgeDeviceRef,
  BridgeSession,
  DeviceAccess,
  DeviceBridge,
  PullOptions,
  PullResult,
  UsbDeviceInfo,
  UsbWatcher,
} from '../../usb/bridge';
import {
  BridgeFailed,
  DeviceBusy,
  DeviceGone,
  DeviceLocked,
  DeviceUnsupported,
  ShortRead,
} from '../../usb/errors';
import { guardBridgeSessions } from '../../usb/bridge-guard';
import { syncDir } from '../../usb/fs-atomic';
import { CHUNK_BYTES } from './codes';
import { collectMedia, pagesOf } from './listing';
import { watchStillImage } from './pipe';
import { createMtpSession, type ClaimResult, type MtpPipe, type MtpSession } from './session';

export interface MtpBridgeOptions {
  /** Tests hand back a scripted pipe. Production opens WebUSB when this is omitted. */
  readonly openPipe?: (device: UsbDeviceInfo, signal: AbortSignal) => Promise<MtpPipe | null>;
  /** Tests share this with the hub. Production watches WebUSB when this is omitted. */
  readonly plugs?: UsbWatcher;
}

export function createMtpBridge(options?: MtpBridgeOptions): DeviceBridge {
  const known = new Map<string, UsbDeviceInfo>();
  const openers = new Map<string, () => Promise<MtpPipe | null>>();

  return guardBridgeSessions({
    kind: 'mtp',
    claims: claimsMtp,
    async *watch(signal: AbortSignal) {
      if (options?.plugs) {
        for await (const event of options.plugs.watch(signal)) {
          if (signal.aborted) return;
          if (!claimsMtp(event.device)) continue;
          if (event.type === 'added') known.set(event.device.locationId, event.device);
          else known.delete(event.device.locationId);
          yield { type: event.type, ref: toRef(event.device) };
        }
        return;
      }
      for await (const event of watchStillImage(signal)) {
        if (event.type === 'removed') {
          known.delete(event.info.locationId);
          openers.delete(event.info.locationId);
          yield { type: 'removed' as const, ref: toRef(event.info) };
          continue;
        }
        known.set(event.info.locationId, event.info);
        openers.set(event.info.locationId, event.open);
        yield { type: 'added' as const, ref: toRef(event.info) };
      }
    },
    async open(ref: BridgeDeviceRef, signal: AbortSignal): AsyncResult<BridgeSession> {
      if (ref.bridge !== 'mtp') return err(DeviceUnsupported());
      if (signal.aborted) return err(DeviceGone());
      const device = known.get(ref.handle) ?? deviceFromRef(ref);
      const pipe = await openFor(device, options?.openPipe, openers.get(ref.handle), signal);
      if (!pipe) return err(DeviceGone());
      const claimed = await pipe.claim(signal);
      if (claimed !== 'claimed') {
        await pipe.release();
        return err(claimError(claimed));
      }
      const session = createMtpSession(pipe);
      const opened = await session.open(signal);
      if (!opened.ok) {
        await pipe.release();
        return opened;
      }
      return ok(mtpBridgeSession(ref, session));
    },
  });
}

/** Busy is the camera agent (ptpcamerad) holding the still-image interface for another app. */
function claimError(result: Exclude<ClaimResult, 'claimed'>): TaalcutError {
  if (result === 'busy') return DeviceBusy(undefined, { detail: 'camera-agent' });
  if (result === 'gone') return DeviceGone();
  return BridgeFailed(undefined, { detail: 'claim' });
}

export function claimsMtp(device: UsbDeviceInfo): boolean {
  return device.interfaces.some((iface) => iface.cls === 6 && iface.sub === 1 && iface.proto === 1);
}

async function openFor(
  device: UsbDeviceInfo,
  injected: MtpBridgeOptions['openPipe'],
  live: (() => Promise<MtpPipe | null>) | undefined,
  signal: AbortSignal,
): Promise<MtpPipe | null> {
  if (injected) return injected(device, signal);
  if (live) return live();
  return null;
}

const UNLOCK_POLL_MS = 1_500;

export function mtpBridgeSession(ref: BridgeDeviceRef, session: MtpSession): BridgeSession {
  let access: DeviceAccess = { state: 'ready' };
  let closed = false;
  let unlockTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(next: DeviceAccess) => void>();
  const stopUnlockPoll = (): void => {
    if (unlockTimer !== null) {
      clearTimeout(unlockTimer);
      unlockTimer = null;
    }
  };
  const armUnlockPoll = (): void => {
    stopUnlockPoll();
    if (closed || access.state !== 'locked') return;
    unlockTimer = setTimeout(() => {
      unlockTimer = null;
      if (closed || access.state !== 'locked') return;
      void session.storageIds(AbortSignal.timeout(4_000)).then((storages) => {
        if (closed || access.state !== 'locked') return;
        if (storages.ok && storages.value.length > 0) {
          setAccess({ state: 'ready' });
          return;
        }
        if (!storages.ok && DeviceGone.is(storages.error)) return;
        armUnlockPoll();
      });
    }, UNLOCK_POLL_MS);
    unlockTimer.unref?.();
  };
  const setAccess = (next: DeviceAccess): void => {
    if (access.state === next.state) return;
    access = next;
    if (next.state === 'locked') armUnlockPoll();
    else stopUnlockPoll();
    for (const listener of [...listeners]) listener(next);
  };
  return {
    ref,
    rangedReads: true,
    access: () => access,
    onAccessChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async *list(signal) {
      const items = await collectMedia(session, signal);
      if (!items.ok) {
        if (DeviceLocked.is(items.error)) setAccess({ state: 'locked' });
        throw items.error;
      }
      setAccess({ state: 'ready' });
      for (const page of pagesOf(items.value)) yield page;
    },
    thumbnail(itemId, signal) {
      const handle = handleOf(itemId);
      if (handle === null) return Promise.resolve(err(BridgeFailed(undefined, { detail: 'item' })));
      return session.thumb(handle, signal);
    },
    pull(itemId, pullOptions) {
      return pullObject(session, itemId, pullOptions);
    },
    async close() {
      closed = true;
      stopUnlockPoll();
      access = { state: 'ready' };
      listeners.clear();
      await session.close();
    },
  };
}

async function pullObject(
  session: MtpSession,
  itemId: string,
  options: PullOptions,
): AsyncResult<PullResult> {
  const handle = handleOf(itemId);
  if (handle === null) return err(BridgeFailed(undefined, { detail: 'item' }));
  const info = await session.info(handle, options.signal);
  if (!info.ok) return info;
  // A 4 GiB+ object whose real size the phone won't tell: reading it would keep a truncated original.
  if (!info.value.sizeKnown) return err(BridgeFailed(undefined, { detail: 'object_size_unknown' }));
  const size = info.value.size;
  // A part longer than the object is not a prefix of it: start again.
  const start = options.offset <= size ? options.offset : 0;
  // File-system errors reject: the run pauses on ENOSPC (disk full) and fails the item otherwise.
  const file = await open(options.dest, start > 0 ? 'r+' : 'w');
  let position = start;
  try {
    while (position < size) {
      if (options.signal.aborted) return err(DeviceGone());
      const ask = Math.min(CHUNK_BYTES, size - position);
      const chunk = await session.readAt(handle, position, ask, size, options.signal);
      if (!chunk.ok) return chunk;
      if (chunk.value.byteLength === 0 || chunk.value.byteLength > ask) {
        return err(ShortRead());
      }
      await file.write(chunk.value, 0, chunk.value.byteLength, position);
      position += chunk.value.byteLength;
      options.onBytes?.(position);
    }
    await file.sync();
  } finally {
    await file.close();
  }
  await syncDir(dirname(options.dest));
  const hashed = await hashFile(options.dest);
  if (hashed.bytes !== size) return err(ShortRead());
  return ok({ bytes: hashed.bytes, sha256: hashed.hex, ancillary: [] });
}

async function hashFile(path: string): Promise<{ readonly hex: string; readonly bytes: number }> {
  const hash = createHash('sha256');
  const file = await open(path, 'r');
  let bytes = 0;
  try {
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    for (;;) {
      const read = await file.read(buffer, 0, buffer.length, position);
      if (read.bytesRead === 0) break;
      hash.update(buffer.subarray(0, read.bytesRead));
      position += read.bytesRead;
      bytes += read.bytesRead;
    }
  } finally {
    await file.close();
  }
  return { hex: hash.digest('hex'), bytes };
}

function handleOf(itemId: string): number | null {
  if (!/^\d+$/.test(itemId)) return null;
  const handle = Number(itemId);
  if (!Number.isSafeInteger(handle) || handle <= 0) return null;
  return handle;
}

function toRef(device: UsbDeviceInfo): BridgeDeviceRef {
  const label = device.product && device.product.trim().length > 0 ? device.product : 'Android';
  return {
    bridge: 'mtp',
    handle: device.locationId,
    identity: device.serial && device.serial.length > 0 ? device.serial : device.locationId,
    label,
    platform: 'android',
  };
}

function deviceFromRef(ref: BridgeDeviceRef): UsbDeviceInfo {
  return {
    locationId: ref.handle,
    vendorId: 0x18d1,
    productId: 0,
    serial: ref.identity,
    product: ref.label,
    interfaces: [{ cls: 6, sub: 1, proto: 1 }],
  };
}
