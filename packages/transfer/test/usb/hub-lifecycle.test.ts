// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The hub's lifetime: no ghost cards after a stop, one card per iPhone, and a failed watcher said out loud. */
import { afterEach, describe, expect, it } from 'vitest';
import { createManualClock } from '@taalcut/core';
import type { UsbDeviceInfo, UsbWatcher } from '../../src/usb/bridge';
import { deviceKey } from '../../src/usb/device-key';
import { BridgeFailed } from '../../src/usb/errors';
import { createDeviceHub } from '../../src/usb/hub';
import {
  adbIface,
  connect,
  createBridge,
  queue,
  releaseHubs,
  setup,
  trackHub,
  until,
  usb,
  watchOf,
} from './hub-fakes';

afterEach(releaseHubs);

describe('device hub lifetime', () => {
  it('forgets every phone when nothing watches, so an unplug while closed leaves no card', async () => {
    const events = queue<{ type: 'added' | 'removed'; device: UsbDeviceInfo }>();
    const mtp = createBridge({
      kind: 'mtp',
      identity: 'GHOST',
      label: 'Phone',
      platform: 'android',
      access: { state: 'ready' },
    });
    const hub = setup([mtp.bridge], watchOf(events));
    const device = usb({ serial: 'GHOST', vendorId: 0x18d1, product: 'Pixel', interfaces: adbIface });
    await connect(hub, events, device, [mtp]);
    expect((await hub.open(deviceKey('GHOST'), new AbortController().signal)).ok).toBe(true);
    const session = mtp.session();
    hub.release();
    expect(hub.views()).toEqual([]);
    expect(session?.closed()).toBe(true);
    hub.retain();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(hub.view(deviceKey('GHOST'))).toBeNull();
  });

  it('joins the USB serial and the hyphenated UDID Image Capture reports as one iPhone', async () => {
    const events = queue<{ type: 'added' | 'removed'; device: UsbDeviceInfo }>();
    const capture = createBridge({
      kind: 'image-capture',
      identity: '00008110-001A2B3C4D5E801E',
      label: 'iPhone',
      platform: 'ios',
      access: { state: 'ready' },
    });
    const hub = setup([capture.bridge], watchOf(events));
    const device = usb({ serial: '00008110001a2b3c4d5e801e', vendorId: 0x05ac, product: 'iPhone' });
    events.push({ type: 'added', device });
    await until(() => hub.views().length === 1);
    capture.push();
    await until(() => hub.views()[0]?.access === 'ready');
    expect(hub.views()).toHaveLength(1);
    expect(deviceKey('00008110-001A2B3C4D5E801E')).toBe(deviceKey('00008110001a2b3c4d5e801e'));
    expect(hub.views()[0]?.platform).toBe('ios');
  });

  it('says why watching stopped when the USB watcher fails', async () => {
    const lines: string[] = [];
    const watcher: UsbWatcher = {
      watch() {
        return {
          [Symbol.asyncIterator]() {
            return {
              next: () => Promise.reject(BridgeFailed(undefined, { detail: 'usb.addon_unavailable' })),
            };
          },
        };
      },
    };
    const hub = createDeviceHub({
      bridges: [],
      watcher,
      clock: createManualClock(1_700_000_000_000),
      log: { info: (line) => lines.push(line) },
    });
    trackHub(hub);
    hub.retain();
    await until(() => hub.failure() !== null);
    expect(hub.failure()?.code).toBe('transfer.bridge_failed');
    expect(lines).toEqual(['usb watch failed transfer.bridge_failed']);
    hub.release();
    hub.retain();
    expect(hub.failure()).toBeNull();
  });
});
