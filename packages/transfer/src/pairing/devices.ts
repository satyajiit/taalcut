// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TransferDeviceId } from '@taalcut/core';
import type { TransferPlatform } from '../deps';
import { TRANSFER_LIMITS } from '../limits';

/** A paired phone. `hash` is the SHA-256 of the bearer credential; the credential itself is never stored. */
export interface StoredDevice {
  readonly id: TransferDeviceId;
  readonly hash: string;
  label: string;
  platform: TransferPlatform;
  userAgent: string;
  connectedAt: number;
  lastSeenAt: number;
}

interface DeviceFile {
  devices: StoredDevice[];
}

export function createDeviceStore(stateDir: string) {
  const path = join(stateDir, 'devices.json');
  let devices: StoredDevice[] = [];

  async function load(): Promise<void> {
    await mkdir(stateDir, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as DeviceFile;
      devices = Array.isArray(parsed.devices) ? parsed.devices.filter(isDevice) : [];
    } catch {
      devices = [];
    }
  }

  function living(now: number): StoredDevice[] {
    return devices.filter((device) => now - device.lastSeenAt <= TRANSFER_LIMITS.credentialTtlMs);
  }

  /** Constant-time over the stored hashes. Expired credentials are dropped. */
  function find(credential: string, now: number): StoredDevice | null {
    const presented = Buffer.from(sha256(credential), 'hex');
    let found: StoredDevice | null = null;
    const next: StoredDevice[] = [];
    for (const device of devices) {
      const fresh = now - device.lastSeenAt <= TRANSFER_LIMITS.credentialTtlMs;
      if (!fresh) continue;
      next.push(device);
      const hash = Buffer.from(device.hash, 'hex');
      if (hash.length === presented.length && timingSafeEqual(hash, presented)) found = device;
    }
    devices = next;
    return found;
  }

  function touch(id: string, now: number): void {
    const device = devices.find((item) => item.id === id);
    if (device) device.lastSeenAt = now;
  }

  async function add(device: StoredDevice): Promise<void> {
    devices = devices.filter((item) => item.id !== device.id);
    devices.push(device);
    await flush();
  }

  async function remove(id: string): Promise<void> {
    devices = devices.filter((item) => item.id !== id);
    await flush();
  }

  async function forget(): Promise<number> {
    const count = devices.length;
    devices = [];
    await flush();
    return count;
  }

  async function flush(): Promise<void> {
    await mkdir(stateDir, { recursive: true });
    const body = JSON.stringify({ devices });
    await writeFile(path, body, { mode: 0o600 });
    await chmod(path, 0o600);
  }

  return { load, living, find, touch, add, remove, forget, flush, filePath: path };
}

export type DeviceStore = ReturnType<typeof createDeviceStore>;

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isDevice(value: unknown): value is StoredDevice {
  if (!value || typeof value !== 'object') return false;
  const device = value as StoredDevice;
  return (
    typeof device.id === 'string' &&
    typeof device.hash === 'string' &&
    device.hash.length === 64 &&
    typeof device.label === 'string' &&
    typeof device.lastSeenAt === 'number'
  );
}
