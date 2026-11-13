// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stand-in for the mac helper's `devices` service behind HelperEndpoint.
 * Like the helper (`--allow-root`), it refuses a thumbnail `dest` or a
 * download `destDir` outside the folders it was given.
 */
import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative } from 'node:path';
import { createImageCaptureBridge } from '../../../src/bridges/image-capture/bridge';
import type { HelperEndpoint, HelperEvent } from '../../../src/bridges/image-capture/client';
import type { BridgeDeviceRef, BridgeSession, UsbDeviceInfo } from '../../../src/usb/bridge';
import { scratch } from '../scratch';

export type Params = Readonly<Record<string, string | number | boolean | null>>;

export const REF: BridgeDeviceRef = {
  bridge: 'image-capture',
  handle: 'h1',
  identity: 'ABC',
  label: 'Phone',
  platform: 'ios',
};

export class FakeEndpoint implements HelperEndpoint {
  readonly calls: { method: string; params: Params }[] = [];
  /** Folders the fake helper may write to. Empty: anywhere (a test that is not about confinement). */
  roots: string[] = [];
  handle: (method: string, params: Params, signal: AbortSignal) => Promise<unknown> = async () => ({
    ok: true,
  });
  closed = 0;
  private readonly listeners = new Set<(event: HelperEvent) => void>();

  async request(method: string, params: Params, signal: AbortSignal): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'devices.thumbnail') await this.confine(params.dest, true);
    if (method === 'devices.download') await this.confine(params.destDir, false);
    return this.handle(method, params, signal);
  }

  onEvent(listener: (event: HelperEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(name: string, payload: unknown): void {
    for (const listener of this.listeners) listener({ name, payload });
  }

  close(): Promise<void> {
    this.closed += 1;
    return Promise.resolve();
  }

  private async confine(
    path: string | number | boolean | null | undefined,
    parentOnly: boolean,
  ): Promise<void> {
    if (this.roots.length === 0) return;
    if (typeof path !== 'string') throw helperFailure('helper.bad_request');
    const real = await realpath(parentOnly ? dirname(path) : path);
    for (const root of this.roots) {
      const rel = relative(await realpath(root), real);
      if (!rel.startsWith('..') && !isAbsolute(rel)) return;
    }
    throw helperFailure('helper.path_not_allowed');
  }
}

export function helperFailure(code: string, message = code): Error {
  return Object.assign(new Error(message), { code });
}

export function openReady(): {
  readonly access: 'ready';
  readonly iCloudPhotosEnabled: true;
  readonly count: number;
} {
  return { access: 'ready', iCloudPhotosEnabled: true, count: 1 };
}

export { cleanScratch, scratch } from '../scratch';

export async function open(
  fake: FakeEndpoint,
  scratchDir?: string,
): Promise<{ session: BridgeSession; scratchDir: string }> {
  const dir = scratchDir ?? (await scratch('taalcut-icc-test-'));
  const bridge = createImageCaptureBridge({ connect: async () => fake, scratchDir: dir });
  const opened = await bridge.open(REF, new AbortController().signal);
  if (!opened.ok) throw new Error(opened.error.code);
  return { session: opened.value, scratchDir: dir };
}

export function removedOf(session: BridgeSession): boolean {
  return 'removed' in session && session.removed === true;
}

export function stillImage(): UsbDeviceInfo['interfaces'][number] {
  return { cls: 6, sub: 1, proto: 1 };
}

export function usb(partial: Partial<UsbDeviceInfo>): UsbDeviceInfo {
  return {
    locationId: '1',
    vendorId: 0,
    productId: 1,
    serial: null,
    product: null,
    interfaces: [],
    ...partial,
  };
}
