// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Fake watcher and bridges: access, one card, busy fallback, removal mid-listing. */
import { afterEach, describe, expect, it } from 'vitest';
import type { UsbDeviceInfo } from '../../src/usb/bridge';
import { deviceKey } from '../../src/usb/device-key';
import { adbIface, connect, createBridge, queue, releaseHubs, setup, until, usb, watchOf } from './hub-fakes';

afterEach(releaseHubs);

describe('device hub', () => {
  it("shows locked until listed, then the session's lock and ready", async () => {
    const events = queue<{ type: 'added' | 'removed'; device: UsbDeviceInfo }>();
    const capture = createBridge({
      kind: 'image-capture',
      identity: 'APPLE-1',
      label: 'iPhone',
      platform: 'ios',
      access: { state: 'locked' },
    });
    const hub = setup([capture.bridge], watchOf(events));
    const device = usb({ serial: 'APPLE-1', vendorId: 0x05ac, product: 'iPhone', interfaces: adbIface });
    events.push({ type: 'added', device });
    await until(() => hub.view(deviceKey('APPLE-1'))?.access === 'locked');
    capture.push();
    // Listed by Image Capture and not asked yet: openable. The lock shows once the open asks.
    await until(() => hub.view(deviceKey('APPLE-1'))?.access === 'ready');
    expect(capture.opens()).toBe(0);
    const opened = await hub.open(deviceKey('APPLE-1'), new AbortController().signal);
    expect(opened.ok).toBe(true);
    expect(hub.view(deviceKey('APPLE-1'))?.access).toBe('locked');
    capture.session()?.setAccess({ state: 'ready' });
    expect(hub.view(deviceKey('APPLE-1'))?.access).toBe('ready');
    expect(hub.view(deviceKey('APPLE-1'))?.bridge).toBe('image-capture');
  });

  it('reports a phone the computer does not trust', async () => {
    const events = queue<{ type: 'added' | 'removed'; device: UsbDeviceInfo }>();
    const trusted = createBridge({
      kind: 'image-capture',
      identity: 'APPLE-2',
      label: 'iPad',
      platform: 'ios',
      access: { state: 'not-trusted' },
    });
    const hub = setup([trusted.bridge], watchOf(events));
    const pad = usb({ serial: 'APPLE-2', vendorId: 0x05ac, product: 'iPad' });
    await connect(hub, events, pad, [trusted]);
    const opened = await hub.open(deviceKey('APPLE-2'), new AbortController().signal);
    expect(opened.ok).toBe(true);
    expect(hub.view(deviceKey('APPLE-2'))?.access).toBe('not-trusted');
  });

  it('asks for file transfer when an Android phone has no data interface', async () => {
    const events = queue<{ type: 'added' | 'removed'; device: UsbDeviceInfo }>();
    const hub = setup([], watchOf(events));
    const view = await connect(
      hub,
      events,
      usb({ serial: 'PIXEL-CHARGE', vendorId: 0x18d1, product: 'Pixel' }),
      [],
    );
    expect(view.access).toBe('needs-file-transfer');
    expect(view.platform).toBe('android');
    expect(view.label).toBe('Pixel');
    expect(hub.views()).toHaveLength(1);
  });

  it('shows the debugging prompt, then falls back when adb is busy', async () => {
    const events = queue<{ type: 'added' | 'removed'; device: UsbDeviceInfo }>();
    const adb = createBridge({
      kind: 'adb',
      identity: 'PIXEL-ADB',
      label: 'Pixel',
      platform: 'android',
      access: { state: 'needs-debugging-allow' },
    });
    const hub = setup([adb.bridge], watchOf(events));
    await connect(
      hub,
      events,
      usb({ serial: 'PIXEL-ADB', vendorId: 0x18d1, product: 'Pixel', interfaces: adbIface }),
      [adb],
    );
    const opened = await hub.open(deviceKey('PIXEL-ADB'), new AbortController().signal);
    expect(opened.ok).toBe(true);
    expect(hub.view(deviceKey('PIXEL-ADB'))?.access).toBe('needs-debugging-allow');
    adb.session()?.setAccess({ state: 'ready' });
    expect(hub.view(deviceKey('PIXEL-ADB'))?.access).toBe('ready');

    const busyEvents = queue<{ type: 'added' | 'removed'; device: UsbDeviceInfo }>();
    const busyAdb = createBridge({
      kind: 'adb',
      identity: 'PIXEL-BOTH',
      label: 'Pixel adb',
      platform: 'android',
      access: { state: 'ready' },
      fail: true,
    });
    const mtp = createBridge({
      kind: 'mtp',
      identity: 'PIXEL-BOTH',
      label: 'Pixel files',
      platform: 'android',
      access: { state: 'ready' },
    });
    const both = setup([busyAdb.bridge, mtp.bridge], watchOf(busyEvents));
    await connect(
      both,
      busyEvents,
      usb({ serial: 'PIXEL-BOTH', vendorId: 0x04e8, product: 'Samsung', interfaces: adbIface }),
      [busyAdb, mtp],
    );
    const fellBack = await both.open(deviceKey('PIXEL-BOTH'), new AbortController().signal);
    expect(fellBack.ok).toBe(true);
    expect(busyAdb.opens()).toBe(1);
    expect(mtp.opens()).toBe(1);
    expect(both.view(deviceKey('PIXEL-BOTH'))?.bridge).toBe('mtp');
    expect(both.view(deviceKey('PIXEL-BOTH'))?.access).toBe('ready');
    expect(both.views()).toHaveLength(1);
  });

  it('keeps one card when two bridges see the phone, and closes a listing on removal', async () => {
    const events = queue<{ type: 'added' | 'removed'; device: UsbDeviceInfo }>();
    const adb = createBridge({
      kind: 'adb',
      identity: 'ONE-PHONE',
      label: 'Phone',
      platform: 'android',
      access: { state: 'ready' },
    });
    const mtp = createBridge({
      kind: 'mtp',
      identity: 'ONE-PHONE',
      label: 'Phone',
      platform: 'android',
      access: { state: 'ready' },
    });
    const hub = setup([adb.bridge, mtp.bridge], watchOf(events));
    const device = usb({ serial: 'ONE-PHONE', vendorId: 0x2717, product: 'Redmi', interfaces: adbIface });
    await connect(hub, events, device, [adb, mtp]);
    expect(hub.views()).toHaveLength(1);
    const opened = await hub.open(deviceKey('ONE-PHONE'), new AbortController().signal);
    expect(opened.ok).toBe(true);
    const session = adb.session();
    if (!session) throw new Error('session missing');
    const removed: { key: string; locked: boolean }[] = [];
    hub.onRemoved((key, locked) => removed.push({ key, locked }));
    const iter = session.list(new AbortController().signal)[Symbol.asyncIterator]();
    await iter.next();
    const hanging = iter.next();
    events.push({ type: 'removed', device });
    await until(() => session.closed());
    expect(hub.view(deviceKey('ONE-PHONE'))?.connected).toBe(false);
    expect(removed).toEqual([{ key: deviceKey('ONE-PHONE'), locked: false }]);
    await hanging;
  });

  it('waits for the bridge ref when open is called while the USB device is still opening', async () => {
    const events = queue<{ type: 'added' | 'removed'; device: UsbDeviceInfo }>();
    const mtp = createBridge({
      kind: 'mtp',
      identity: 'SAMSUNG-LATE',
      label: 'Galaxy',
      platform: 'android',
      access: { state: 'ready' },
    });
    const hub = setup([mtp.bridge], watchOf(events));
    const device = usb({
      serial: 'SAMSUNG-LATE',
      vendorId: 0x04e8,
      product: 'Samsung',
      interfaces: [{ cls: 6, sub: 1, proto: 1 }],
    });
    events.push({ type: 'added', device });
    await until(() => hub.view(deviceKey('SAMSUNG-LATE'))?.access === 'opening');
    const opening = hub.open(deviceKey('SAMSUNG-LATE'), new AbortController().signal);
    mtp.push();
    const opened = await opening;
    expect(opened.ok).toBe(true);
    expect(hub.view(deviceKey('SAMSUNG-LATE'))?.access).toBe('ready');
    expect(hub.view(deviceKey('SAMSUNG-LATE'))?.bridge).toBe('mtp');
  });
});
