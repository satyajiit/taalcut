// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createImageCaptureBridge } from '../../src/bridges/image-capture/bridge';
import {
  FORMAT_ASSOCIATION,
  OP_GET_OBJECT_HANDLES,
  OP_GET_OBJECT_INFO,
  OP_GET_STORAGE_IDS,
  OP_OPEN_SESSION,
  RES_OK,
  TYPE_RESPONSE,
} from '../../src/bridges/mtp/codes';
import {
  decodeContainer,
  encodeContainer,
  encodeIdArray,
  encodeObjectInfo,
} from '../../src/bridges/mtp/container';
import { BridgeFailed, DeviceGone, DeviceLocked } from '../../src/usb/errors';
import {
  cleanScratch,
  FakeEndpoint,
  helperFailure,
  open,
  openReady,
  REF,
  removedOf,
  scratch,
  stillImage,
  usb,
} from './image-capture/fake-endpoint';

afterEach(cleanScratch);

describe('image capture bridge', () => {
  it('claims an iPhone and rejects a charging-only Android', async () => {
    let connects = 0;
    const bridge = createImageCaptureBridge({
      connect: async () => {
        connects += 1;
        return new FakeEndpoint();
      },
      scratchDir: await scratch(),
    });
    expect(bridge.claims(usb({ vendorId: 0x05ac, product: 'iPhone', interfaces: [stillImage()] }))).toBe(
      true,
    );
    expect(bridge.claims(usb({ vendorId: 0x05ac, product: 'Keyboard' }))).toBe(true);
    expect(bridge.claims(usb({ vendorId: 0x04e8, product: 'iPad Air' }))).toBe(true);
    expect(bridge.claims(usb({ vendorId: 0x18d1, interfaces: [stillImage()] }))).toBe(true);
    expect(
      bridge.claims(
        usb({ vendorId: 0x18d1, product: 'Pixel', interfaces: [{ cls: 255, sub: 255, proto: 0 }] }),
      ),
    ).toBe(false);
    expect(connects).toBe(0);
  });

  it('maps a catalogue page and the open iCloud flag, and drops what it cannot use', async () => {
    const fake = new FakeEndpoint();
    fake.handle = async (method, params) => {
      if (method === 'devices.list') {
        expect(params).toMatchObject({ handle: 'h1', cursor: 0, limit: 500 });
        return {
          items: [
            {
              id: '7',
              name: 'bad:name.JPG',
              uti: 'image',
              size: 1200,
              width: 400,
              height: 300,
              created: 1_700_000_000_000,
              modified: 1_700_000_100_000,
              folder: 'DCIM/100APPLE',
              relatedUUID: 'LIVE-1',
              burstUUID: 'BURST-1',
              highFramerate: false,
              timeLapse: false,
              sidecars: ['IMG_0001.AAE'],
            },
            {
              id: '8',
              name: 'clip.MOV',
              uti: 'movie',
              size: 50,
              duration: 2.5,
              highFramerate: true,
              timeLapse: true,
              availability: 'cloud-only',
              sidecars: [],
            },
            { id: '9', name: 'voice.m4a', uti: 'audio', size: 10 },
            { id: '10', name: 'nosize.HEIC', uti: 'image' },
            { id: '11', name: 'half.HEIC', uti: 'image', size: 10.5 },
            { id: '12', name: 'bad-width.MOV', uti: 'movie', size: 10, width: 'wide' },
          ],
        };
      }
      return openReady();
    };
    const { session } = await open(fake);
    expect(session.ref).toMatchObject({ iCloudPhotos: true });
    expect(session.rangedReads).toBe(false);
    const page = await session.list(new AbortController().signal)[Symbol.asyncIterator]().next();
    expect(page.value).toHaveLength(2);
    const image = page.value?.[0];
    const movie = page.value?.[1];
    expect(image).toMatchObject({
      id: '7',
      name: 'badname.JPG',
      kind: 'image',
      sizeBytes: 1200,
      createdAt: 1_700_000_000_000,
      width: 400,
      height: 300,
      durationMs: null,
      type: 'image/jpeg',
      folder: 'DCIM/100APPLE',
      album: null,
      availability: 'unknown',
      sidecars: ['IMG_0001.AAE'],
      flags: { livePhotoGroup: 'LIVE-1', burst: true },
    });
    expect(movie).toMatchObject({
      kind: 'video',
      type: 'video/quicktime',
      durationMs: 2500,
      availability: 'cloud-only',
      flags: { highFrameRate: true, timeLapse: true },
    });
  });

  it('fails a malformed catalogue page and a malformed open instead of guessing', async () => {
    const fake = new FakeEndpoint();
    fake.handle = async (method) => (method === 'devices.list' ? { items: 'nope' } : openReady());
    const { session, scratchDir } = await open(fake);
    const listing = session.list(new AbortController().signal)[Symbol.asyncIterator]();
    await expect(listing.next()).rejects.toMatchObject({ code: BridgeFailed.code });

    fake.handle = async () => ({ access: 'maybe', count: 1 });
    const bridge = createImageCaptureBridge({ connect: async () => fake, scratchDir });
    const opened = await bridge.open(REF, new AbortController().signal);
    expect(opened.ok).toBe(false);
    if (!opened.ok)
      expect(opened.error).toEqual(BridgeFailed(undefined, { detail: 'devices.session_failed' }));
  });

  it('opens a locked phone as locked and reports a busy holder', async () => {
    const fake = new FakeEndpoint();
    fake.handle = async () => ({ access: 'locked', iCloudPhotosEnabled: false });
    const { session } = await open(fake);
    expect(session.access()).toEqual({ state: 'locked' });
    fake.emit('device.access', { handle: 'h1', state: 'busy', holder: 'camera-agent' });
    expect(session.access()).toEqual({ state: 'busy', holder: 'camera-agent' });
    fake.emit('device.access', { handle: 'h1', state: 'busy', holder: 'someone' });
    expect(session.access()).toEqual({ state: 'busy', holder: 'unknown' });
    fake.emit('device.access', { handle: 'h1', state: 'sleepy' });
    expect(session.access()).toEqual({ state: 'busy', holder: 'unknown' });
  });

  it('surfaces device.removed on the session and locked access as DeviceLocked', async () => {
    const dir = await scratch();
    const fake = new FakeEndpoint();
    fake.handle = async (method) => {
      if (method === 'devices.download') throw helperFailure('devices.session_failed');
      return openReady();
    };
    const { session } = await open(fake);
    const seen: string[] = [];
    session.onAccessChange((access) => seen.push(access.state));
    expect(removedOf(session)).toBe(false);
    fake.emit('device.access', { handle: 'h1', state: 'locked' });
    expect(session.access()).toEqual({ state: 'locked' });
    expect(seen).toEqual(['locked']);
    const locked = await session.pull('7', {
      dest: join(dir, 'c.part'),
      offset: 0,
      signal: new AbortController().signal,
    });
    expect(locked.ok).toBe(false);
    if (locked.ok) return;
    expect(DeviceLocked.is(locked.error)).toBe(true);

    fake.emit('device.removed', { handle: 'h1' });
    expect(removedOf(session)).toBe(true);
    const gone = await session.pull('7', {
      dest: join(dir, 'd.part'),
      offset: 0,
      signal: new AbortController().signal,
    });
    expect(gone.ok).toBe(false);
    if (gone.ok) return;
    expect(DeviceGone.is(gone.error)).toBe(true);
    expect(fake.calls.filter((call) => call.method === 'devices.download')).toHaveLength(1);
  });

  it('sets platform from product kind, not the helper platform string', async () => {
    const fake = new FakeEndpoint();
    fake.handle = async (method) => {
      if (method === 'devices.start') {
        fake.emit('device.added', { handle: 'h', label: 'Phone', productKind: 'iPhone', platform: 'other' });
        fake.emit('device.added', { handle: 'p', label: 'Pad', productKind: 'iPad', identity: '3' });
        fake.emit('device.added', { handle: 'c', label: 'Cam', productKind: 'Camera', platform: 'ios' });
        fake.emit('device.added', { handle: 'x', label: 'Pro', productKind: 'iPad Pro', identity: '4' });
        fake.emit('device.added', { label: 'no handle' });
      }
      return { ok: true };
    };
    const bridge = createImageCaptureBridge({ connect: async () => fake, scratchDir: await scratch() });
    const controller = new AbortController();
    const iter = bridge.watch(controller.signal)[Symbol.asyncIterator]();
    try {
      const platforms: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        const next = await iter.next();
        if (next.value?.type === 'added') platforms.push(next.value.ref.platform);
      }
      expect(platforms).toEqual(['ios', 'ios', 'other', 'other']);
      fake.emit('device.removed', { handle: 'h' });
      const removed = await iter.next();
      expect(removed.value?.type).toBe('removed');
      if (removed.value?.type === 'removed') expect(removed.value.ref.handle).toBe('h');
    } finally {
      controller.abort();
      await iter.return?.();
    }
    expect(fake.closed).toBe(1);
  });

  it('after a helper restart, drops the old handles and asks for the devices again', async () => {
    const fake = new FakeEndpoint();
    let starts = 0;
    fake.handle = async (method) => {
      if (method === 'devices.start') {
        starts += 1;
        fake.emit('device.added', { handle: `h${starts}`, label: 'Phone', productKind: 'iPhone' });
        return { ok: true };
      }
      return openReady();
    };
    const bridge = createImageCaptureBridge({ connect: async () => fake, scratchDir: await scratch() });
    const controller = new AbortController();
    const iter = bridge.watch(controller.signal)[Symbol.asyncIterator]();
    try {
      const first = await iter.next();
      expect(first.value).toMatchObject({ type: 'added', ref: { handle: 'h1' } });
      if (first.value?.type !== 'added') return;
      const opened = await bridge.open(first.value.ref, controller.signal);
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      fake.emit('helper.restarted', {});
      expect(removedOf(opened.value)).toBe(true);
      expect((await iter.next()).value).toMatchObject({ type: 'removed', ref: { handle: 'h1' } });
      expect((await iter.next()).value).toMatchObject({ type: 'added', ref: { handle: 'h2' } });
      expect(starts).toBe(2);
      await opened.value.close();
      expect(fake.closed).toBe(0);
    } finally {
      controller.abort();
      await iter.return?.();
    }
    expect(fake.closed).toBe(1);
  });

  it('tunnels MTP over devices.ptp when ptpcamerad holds an Android phone with an empty ICC catalogue', async () => {
    const fake = new FakeEndpoint();
    let unlocked = false;
    const okResp = Buffer.from(encodeContainer(TYPE_RESPONSE, RES_OK, 1, new Uint8Array())).toString(
      'base64',
    );
    fake.handle = async (method, params) => {
      if (method === 'devices.open') {
        return { access: 'ready', iCloudPhotosEnabled: false, count: 0, ptp: true };
      }
      if (method === 'devices.ptp') {
        const cmd = decodeContainer(new Uint8Array(Buffer.from(String(params.command), 'base64')));
        if (!cmd) throw new Error('bad ptp command');
        if (cmd.code === OP_OPEN_SESSION) {
          return { data: '', response: okResp };
        }
        if (cmd.code === OP_GET_STORAGE_IDS) {
          const ids = unlocked ? [0x00010001] : [];
          return { data: Buffer.from(encodeIdArray(ids)).toString('base64'), response: okResp };
        }
        if (cmd.code === OP_GET_OBJECT_HANDLES) {
          const parent = new DataView(cmd.payload.buffer, cmd.payload.byteOffset, cmd.payload.byteLength).getUint32(
            8,
            true,
          );
          const handles = parent === 0xffff_ffff ? [1] : [2];
          return { data: Buffer.from(encodeIdArray(handles)).toString('base64'), response: okResp };
        }
        if (cmd.code === OP_GET_OBJECT_INFO) {
          const handle = new DataView(cmd.payload.buffer, cmd.payload.byteOffset, cmd.payload.byteLength).getUint32(
            0,
            true,
          );
          const info =
            handle === 1
              ? encodeObjectInfo({
                  storageId: 0x00010001,
                  format: FORMAT_ASSOCIATION,
                  size: 0,
                  width: 0,
                  height: 0,
                  parent: 0,
                  name: 'DCIM',
                  created: '20261106T120000Z',
                  modified: '20261106T120000Z',
                })
              : encodeObjectInfo({
                  storageId: 0x00010001,
                  format: 0x3801,
                  size: 4096,
                  width: 1920,
                  height: 1080,
                  parent: 1,
                  name: 'SAM_0001.JPG',
                  created: '20261106T120000Z',
                  modified: '20261106T120000Z',
                });
          return { data: Buffer.from(info).toString('base64'), response: okResp };
        }
      }
      return { ok: true };
    };
    const bridge = createImageCaptureBridge({ connect: async () => fake, scratchDir: await scratch() });
    const opened = await bridge.open(
      { bridge: 'image-capture', handle: 'h-sam', identity: 'RZGL', label: 'SM-S948B', platform: 'other' },
      new AbortController().signal,
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.rangedReads).toBe(true);

    // Locked Android (0 storages) transitions to locked instead of DeviceBusy.
    const lockedIter = opened.value.list(new AbortController().signal)[Symbol.asyncIterator]();
    await expect(lockedIter.next()).rejects.toMatchObject({ code: DeviceLocked.code });
    expect(opened.value.access()).toEqual({ state: 'locked' });

    // Once unlocked on the phone, the same session lists DCIM over devices.ptp.
    unlocked = true;
    const pages: unknown[] = [];
    for await (const p of opened.value.list(new AbortController().signal)) {
      pages.push(p);
    }
    expect(opened.value.access()).toEqual({ state: 'ready' });
    expect(pages).toEqual([
      [expect.objectContaining({ id: '2', name: 'SAM_0001.JPG', folder: 'DCIM', sizeBytes: 4096 })],
    ]);
    await opened.value.close();
  });
});
