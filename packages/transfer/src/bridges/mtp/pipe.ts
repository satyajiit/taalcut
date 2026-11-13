// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Production pipe over `usb` 3.2.1 WebUSB. Imported only when a real phone is
 * opened, so tests that inject a pipe never load the addon.
 */
import type { UsbDeviceInfo } from '../../usb/bridge';
import {
  loadUsbAddon,
  readUsbProp,
  rememberUsbDevice,
  usbLocationOf,
  watchUsbBus,
} from '../../usb-watch/usb-addon';
import type { ClaimResult, MtpPipe, PipeStatus } from './session';

/**
 * `usb` 3.2.1 defaults bulk transfers to `DEFAULT_TIMEOUT = 1000` ms, which is too short when an
 * Android phone wakes its storage or answers a large MTP directory listing.
 */
const TRANSFER_TIMEOUT_MS = 15_000;

interface BulkDevice {
  readonly vendorId: number;
  readonly productId: number;
  readonly serialNumber: string | null;
  readonly productName: string | null;
  readonly opened: boolean;
  readonly configuration: unknown;
  readonly bus: unknown;
  readonly address: unknown;
  readonly handle: unknown;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(number: number): Promise<void>;
  releaseInterface(number: number): Promise<void>;
  transferIn(endpoint: number, length: number, timeout?: number): Promise<unknown>;
  transferOut(endpoint: number, data: Uint8Array, timeout?: number): Promise<unknown>;
  controlTransferOut(setup: ControlSetup, data?: Uint8Array): Promise<unknown>;
}

interface ControlSetup {
  readonly requestType: 'class';
  readonly recipient: 'interface';
  readonly request: number;
  readonly value: number;
  readonly index: number;
}

interface Ends {
  readonly interfaceNumber: number;
  readonly inn: number;
  readonly out: number;
}

export interface StillPlug {
  readonly type: 'added' | 'removed';
  readonly info: UsbDeviceInfo;
  readonly open: () => Promise<MtpPipe | null>;
}

export async function* watchStillImage(signal: AbortSignal): AsyncGenerator<StillPlug> {
  const loaded = await loadUsbAddon();
  // The hub logs a bridge whose watch fails; the WebUSB watcher reports the same missing addon to the person.
  if (!loaded.ok) throw loaded.error;
  const known = new Map<string, UsbDeviceInfo>();
  yield* watchUsbBus(loaded.value, signal, (raw, type) => {
    if (!isBulk(raw)) return null;
    const info = rememberUsbDevice(known, describe(raw), type);
    if (type === 'removed') return { type, info, open: () => Promise.resolve(null) };
    return plugOf(raw, info);
  });
}

export async function openStillImage(device: BulkDevice): Promise<MtpPipe | null> {
  const ends = stillEnds(readUsbProp(device, 'configuration'));
  if (!ends) return null;
  return new BulkPipe(device, ends);
}

function plugOf(device: BulkDevice, info: UsbDeviceInfo): StillPlug | null {
  if (!info.interfaces.some((iface) => iface.cls === 6 && iface.sub === 1 && iface.proto === 1)) return null;
  return { type: 'added', info, open: () => openStillImage(device) };
}

class BulkPipe implements MtpPipe {
  private claimed = false;

  constructor(
    private readonly device: BulkDevice,
    private readonly ends: Ends,
  ) {}

  async claim(signal: AbortSignal): Promise<ClaimResult> {
    if (signal.aborted) return 'failed';
    const openedHere = !this.device.opened;
    try {
      if (openedHere) await this.device.open();
      // macOS configures a phone when it is plugged in; selecting again fails once anything has claimed it.
      if (!isRecord(this.device.configuration)) await this.device.selectConfiguration(1);
      await this.device.claimInterface(this.ends.interfaceNumber);
      this.claimed = true;
      return 'claimed';
    } catch (cause) {
      if (openedHere) await this.closeAfterFailedClaim();
      return claimFailure(cause);
    }
  }

  async transferOut(data: Uint8Array, signal: AbortSignal): Promise<PipeStatus> {
    if (signal.aborted || !this.claimed) return 'stall';
    try {
      return statusOf(await this.device.transferOut(this.ends.out, data, TRANSFER_TIMEOUT_MS));
    } catch (cause) {
      return isDisconnect(cause) ? 'gone' : 'stall';
    }
  }

  async transferIn(
    length: number,
    signal: AbortSignal,
  ): Promise<{ readonly data: Uint8Array; readonly status: PipeStatus }> {
    if (signal.aborted || !this.claimed) return { data: new Uint8Array(), status: 'stall' };
    try {
      return bytesOf(await this.device.transferIn(this.ends.inn, length, TRANSFER_TIMEOUT_MS));
    } catch (cause) {
      return { data: new Uint8Array(), status: isDisconnect(cause) ? 'gone' : 'stall' };
    }
  }

  /** Still Image class Cancel Request (0x64): CancellationCode 0x4001, then the transaction's id. */
  async cancelRequest(transactionId: number): Promise<void> {
    const payload = new Uint8Array(6);
    const view = new DataView(payload.buffer);
    view.setUint16(0, 0x4001, true);
    view.setUint32(2, transactionId, true);
    try {
      await this.device.controlTransferOut(
        {
          requestType: 'class',
          recipient: 'interface',
          request: 0x64,
          value: 0,
          index: this.ends.interfaceNumber,
        },
        payload,
      );
    } catch {
      // The device may already be gone: the transaction ends with it.
    }
  }

  async release(): Promise<void> {
    try {
      if (this.claimed) await this.device.releaseInterface(this.ends.interfaceNumber);
    } catch {
      // Already released.
    }
    try {
      await this.device.close();
    } catch {
      // Already closed.
    }
    this.claimed = false;
  }

  private async closeAfterFailedClaim(): Promise<void> {
    try {
      await this.device.close();
    } catch {
      // The claim already failed and is what gets reported; a device that won't close is gone or held.
    }
  }
}

/** nusb's errors, as the addon words them: exclusive access or busy means another process holds it. */
function claimFailure(cause: unknown): ClaimResult {
  const text = errorText(cause);
  if (/exclusive access|resource busy|busy|permission denied|access denied|not permitted/i.test(text))
    return 'busy';
  if (isDisconnect(cause)) return 'gone';
  return 'failed';
}

function isDisconnect(cause: unknown): boolean {
  return /disconnected|not connected|no such device|device not found|entity not found/i.test(
    errorText(cause),
  );
}

function errorText(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name} ${cause.message}`;
  return typeof cause === 'string' ? cause : '';
}

function describe(device: BulkDevice): UsbDeviceInfo {
  const interfaces: { cls: number; sub: number; proto: number }[] = [];
  const configuration = readUsbProp(device, 'configuration');
  if (isRecord(configuration) && Array.isArray(configuration.interfaces)) {
    for (const iface of configuration.interfaces) {
      if (!isRecord(iface) || !isRecord(iface.alternate)) continue;
      const alt = iface.alternate;
      if (
        typeof alt.interfaceClass !== 'number' ||
        typeof alt.interfaceSubclass !== 'number' ||
        typeof alt.interfaceProtocol !== 'number'
      ) {
        continue;
      }
      interfaces.push({ cls: alt.interfaceClass, sub: alt.interfaceSubclass, proto: alt.interfaceProtocol });
    }
  }
  const serial = readUsbProp(device, 'serialNumber');
  const product = readUsbProp(device, 'productName');
  return {
    locationId: usbLocationOf(device),
    vendorId: device.vendorId,
    productId: device.productId,
    serial: typeof serial === 'string' && serial.length > 0 ? serial : null,
    product: typeof product === 'string' && product.length > 0 ? product : null,
    interfaces,
  };
}

function stillEnds(configuration: unknown): Ends | null {
  if (!isRecord(configuration) || !Array.isArray(configuration.interfaces)) return null;
  for (const iface of configuration.interfaces) {
    if (!isRecord(iface) || typeof iface.interfaceNumber !== 'number' || !isRecord(iface.alternate)) continue;
    const alt = iface.alternate;
    if (alt.interfaceClass !== 6 || alt.interfaceSubclass !== 1 || alt.interfaceProtocol !== 1) continue;
    if (!Array.isArray(alt.endpoints)) continue;
    let inn: number | null = null;
    let out: number | null = null;
    for (const endpoint of alt.endpoints) {
      if (!isRecord(endpoint) || endpoint.type !== 'bulk' || typeof endpoint.endpointNumber !== 'number')
        continue;
      if (endpoint.direction === 'in') inn = endpoint.endpointNumber;
      if (endpoint.direction === 'out') out = endpoint.endpointNumber;
    }
    if (inn !== null && out !== null) return { interfaceNumber: iface.interfaceNumber, inn, out };
  }
  return null;
}

function isBulk(value: unknown): value is BulkDevice {
  if (!isRecord(value)) return false;
  return (
    typeof value.vendorId === 'number' &&
    typeof value.productId === 'number' &&
    typeof value.open === 'function' &&
    typeof value.close === 'function' &&
    typeof value.claimInterface === 'function' &&
    typeof value.releaseInterface === 'function' &&
    typeof value.selectConfiguration === 'function' &&
    typeof value.transferIn === 'function' &&
    typeof value.transferOut === 'function' &&
    typeof value.controlTransferOut === 'function'
  );
}

function bytesOf(result: unknown): { readonly data: Uint8Array; readonly status: PipeStatus } {
  if (!isRecord(result)) return { data: new Uint8Array(), status: 'stall' };
  const status = result.status === 'ok' ? 'ok' : 'stall';
  const data = result.data;
  if (data instanceof Uint8Array) return { data, status };
  if (data instanceof DataView)
    return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), status };
  return { data: new Uint8Array(), status };
}

function statusOf(result: unknown): PipeStatus {
  return isRecord(result) && result.status === 'ok' ? 'ok' : 'stall';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
