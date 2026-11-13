// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Production connect: claim the adb interface over WebUSB, and on a busy
 * claim talk to the adb server at 127.0.0.1:5037 once. `usb` and the WebUSB
 * transport are imported only here, so unit tests never open a device.
 * A key the phone has not allowed yet is an auth prompt, not a hard failure.
 */
import {
  AdbAuthType,
  AdbDaemonTransport,
  AdbPublicKeyAuthenticator,
  AdbServerClient,
  AdbSignatureAuthenticator,
  type AdbAuthenticator,
  type AdbDaemonConnection,
  type AdbTransport,
} from '@yume-chan/adb';
import { type UsbDeviceInfo } from '../../usb/bridge';
import { createEventQueue } from '../../usb/event-queue';
import { loadUsbAddon, readUsbProp, usbLocationOf, type UsbAddon } from '../../usb-watch/usb-addon';
import { createAdbCredentialStore, type AdbKeySource } from './credentials';
import { abortError, isAbort } from './failures';

const ADB_HOST = '127.0.0.1';
const ADB_PORT = 5037;

export interface AdbConnectHooks {
  /** Replaces the WebUSB claim. Tests throw the library's busy error. */
  readonly claim?: (device: UsbDeviceInfo, signal: AbortSignal) => Promise<AdbTransport>;
  /** Replaces 127.0.0.1:5037. Used once after a busy claim. */
  readonly server?: (device: UsbDeviceInfo, signal: AbortSignal) => Promise<AdbTransport>;
}

/**
 * The phone is showing the debugging Allow prompt. `whenReady` resolves if they tap Allow and
 * rejects if the authentication fails; either way the connection is closed on failure.
 * The session that holds it owns it from here: `cancel()` lets go of the interface.
 */
export class AdbAllowPending extends Error {
  override readonly name = 'AdbAllowPending';
  constructor(
    readonly whenReady: Promise<AdbTransport>,
    readonly cancel: () => void,
  ) {
    super('adb-allow');
  }
}

/** The interface is taken and the adb server could not be used either. */
export class AdbInterfaceBusy extends Error {
  override readonly name = 'AdbInterfaceBusy';
  constructor() {
    super('adb-busy');
  }
}

export class AdbDeviceMissing extends Error {
  override readonly name = 'AdbDeviceMissing';
  constructor() {
    super('adb-missing');
  }
}

export function isAdbBusyError(error: unknown): boolean {
  if (error instanceof AdbInterfaceBusy) return true;
  if (!(error instanceof Error)) return false;
  if (busyText(error)) return true;
  return error.cause instanceof Error && error.cause !== error && busyText(error.cause);
}

/**
 * One claim, then at most one server connection. A busy claim is not retried.
 */
export async function connectAdbTransport(
  device: UsbDeviceInfo,
  signal: AbortSignal,
  keys: AdbKeySource,
  hooks: AdbConnectHooks = {},
): Promise<AdbTransport> {
  throwIfAborted(signal);
  try {
    if (hooks.claim) return await hooks.claim(device, signal);
    return await claimWebUsb(device, signal, keys);
  } catch (error) {
    if (!isAdbBusyError(error)) throw error;
  }
  try {
    if (hooks.server) return await hooks.server(device, signal);
    return await connectServer(device, signal);
  } catch (error) {
    if (error instanceof AdbAllowPending || isAbort(error)) throw error;
    throw new AdbInterfaceBusy();
  }
}

export interface AdbPlug {
  readonly type: 'added' | 'removed';
  readonly device: UsbDeviceInfo;
}

/** WebUSB devices that expose the adb interface. Ends when `signal` aborts. */
export async function* watchAdbDevices(signal: AbortSignal): AsyncGenerator<AdbPlug> {
  const usb = await loadBackend();
  const webusb = await import('@yume-chan/adb-daemon-webusb');
  const manager = new webusb.AdbDaemonWebUsbDeviceManager(usb);
  const observer = await manager.trackDevices();
  const plugs = createEventQueue<AdbPlug>();
  for (const device of observer.current) plugs.push({ type: 'added', device: infoFrom(device) });
  const stopAdd = observer.onDeviceAdd((devices) => {
    for (const device of devices) plugs.push({ type: 'added', device: infoFrom(device) });
  });
  const stopRemove = observer.onDeviceRemove((devices) => {
    for (const device of devices) plugs.push({ type: 'removed', device: infoFrom(device) });
  });
  try {
    yield* plugs.drain(signal);
  } finally {
    stopAdd();
    stopRemove();
    observer.stop();
  }
}

async function claimWebUsb(
  device: UsbDeviceInfo,
  signal: AbortSignal,
  keys: AdbKeySource,
): Promise<AdbTransport> {
  throwIfAborted(signal);
  const usb = await loadBackend();
  const webusb = await import('@yume-chan/adb-daemon-webusb');
  const manager = new webusb.AdbDaemonWebUsbDeviceManager(usb);
  const listed = await manager.getDevices();
  const match = listed.find((candidate) => samePhone(infoFrom(candidate), device));
  if (!match) throw new AdbDeviceMissing();
  const connection = await match.connect();
  // Closing the USB device ends the transfers the authentication waits on, so it fails and lets go.
  const release = (): void => closeDevice(match.raw);
  return authenticateDaemon(connection, match.serial, keys, signal, release);
}

async function connectServer(device: UsbDeviceInfo, signal: AbortSignal): Promise<AdbTransport> {
  throwIfAborted(signal);
  const tcp = await import('@yume-chan/adb-server-node-tcp');
  const client = new AdbServerClient(new tcp.AdbServerNodeTcpConnector({ host: ADB_HOST, port: ADB_PORT }));
  const listed = await client.getDevices();
  const match = selectServerDevice(listed, device);
  if (!match) throw new AdbInterfaceBusy();
  if (match.state === 'unauthorized') {
    // The wait belongs to the session from here, not to the open call that found the prompt.
    const waiting = new AbortController();
    throw new AdbAllowPending(waitUntilAuthorized(client, match.serial, waiting.signal), () =>
      waiting.abort(),
    );
  }
  return client.createTransport({ transportId: match.transportId });
}

async function waitUntilAuthorized(
  client: AdbServerClient,
  serial: string,
  signal: AbortSignal,
): Promise<AdbTransport> {
  while (!signal.aborted) {
    await delay(1000, signal);
    const listed = await client.getDevices();
    const match = listed.find((item) => item.serial === serial && item.state === 'device');
    if (match) return client.createTransport({ transportId: match.transportId });
  }
  throw abortError();
}

/**
 * Signature auth first, then the public key (the phone's Allow prompt). Before the prompt the
 * open call's signal can stop it; once the prompt shows, AdbAllowPending hands `release` to the
 * session. Any failure closes the device, so a refused or broken auth never keeps the interface.
 */
export async function authenticateDaemon(
  connection: AdbDaemonConnection,
  serial: string,
  keys: AdbKeySource,
  signal: AbortSignal,
  release: () => void,
): Promise<AdbTransport> {
  let markPrompt: (() => void) | undefined;
  const prompted = new Promise<void>((resolve) => {
    markPrompt = resolve;
  });
  const authenticators: readonly AdbAuthenticator[] = [
    AdbSignatureAuthenticator,
    async function* (store, getNext) {
      const packet = await getNext();
      if (packet.arg0 !== AdbAuthType.Token) return;
      markPrompt?.();
      yield* AdbPublicKeyAuthenticator(store, async () => packet);
    },
  ];
  const pending = AdbDaemonTransport.authenticate({
    serial,
    connection,
    credentialStore: createAdbCredentialStore(keys),
    authenticators,
    // Checksums stay on until the banner arrives. Delayed ack is negotiated later.
    initialDelayedAckBytes: 0,
  }).catch((error: unknown) => {
    release();
    throw error;
  });
  const aborted = abortSignalled(signal);
  try {
    const outcome = await Promise.race([
      pending.then((transport) => ({ kind: 'ready' as const, transport })),
      prompted.then(() => ({ kind: 'prompt' as const })),
      aborted.promise.then(() => ({ kind: 'aborted' as const })),
    ]);
    if (outcome.kind === 'aborted') {
      release();
      throw abortError();
    }
    if (outcome.kind === 'prompt') throw new AdbAllowPending(pending, release);
    return outcome.transport;
  } finally {
    aborted.dispose();
  }
}

async function loadBackend(): Promise<UsbAddon> {
  const loaded = await loadUsbAddon();
  if (!loaded.ok) throw new AdbDeviceMissing();
  return loaded.value;
}

/** `USBDevice.close()` on the raw device, read structurally. A device already gone has nothing to close. */
function closeDevice(raw: unknown): void {
  if (!isRecord(raw) || typeof raw.close !== 'function') return;
  const closing: unknown = Reflect.apply(raw.close, raw, []);
  if (isRecord(closing) && typeof closing.then === 'function') {
    // Closing a device that is already unplugged rejects; there is nothing left to release then.
    Promise.resolve(closing).catch(() => undefined);
  }
}

function infoFrom(device: {
  readonly serial: string;
  readonly name: string | undefined;
  readonly raw: object;
}): UsbDeviceInfo {
  const raw = isRecord(device.raw) ? device.raw : {};
  const rawSerial = readUsbProp(raw, 'serialNumber');
  const serial =
    typeof rawSerial === 'string' && rawSerial.length > 0
      ? rawSerial
      : device.serial.length > 0
        ? device.serial
        : null;
  const vendorId = readUsbProp(raw, 'vendorId');
  const productId = readUsbProp(raw, 'productId');
  return {
    locationId: usbLocationOf(raw),
    vendorId: typeof vendorId === 'number' ? vendorId : 0,
    productId: typeof productId === 'number' ? productId : 0,
    serial,
    product: typeof device.name === 'string' && device.name.length > 0 ? device.name : null,
    interfaces: [{ cls: 0xff, sub: 0x42, proto: 0x01 }],
  };
}

function samePhone(listed: UsbDeviceInfo, wanted: UsbDeviceInfo): boolean {
  if (wanted.serial && listed.serial) return wanted.serial === listed.serial;
  return (
    wanted.vendorId === listed.vendorId &&
    wanted.productId === listed.productId &&
    wanted.locationId === listed.locationId
  );
}

function selectServerDevice(
  devices: readonly AdbServerClient.Device[],
  wanted: UsbDeviceInfo,
): AdbServerClient.Device | undefined {
  if (wanted.serial) return devices.find((item) => item.serial === wanted.serial);
  return devices.length === 1 ? devices[0] : undefined;
}

function busyText(error: Error): boolean {
  return (
    error.name === 'DeviceBusyError' ||
    error.name === 'NetworkError' ||
    error.message.includes('already in used') ||
    /unable to claim|resource busy|LIBUSB_ERROR_BUSY/i.test(error.message)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

/** Resolves when `signal` aborts. `dispose()` removes the listener once the caller stops waiting. */
function abortSignalled(signal: AbortSignal): { readonly promise: Promise<void>; dispose(): void } {
  let onAbort: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    onAbort = () => resolve();
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return {
    promise,
    dispose() {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    },
  };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
