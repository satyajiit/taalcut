// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createMtpBridge } from '../../../src/bridges/mtp/bridge';
import {
  OP_GET_OBJECT_HANDLES,
  OP_GET_OBJECT_INFO,
  OP_GET_PARTIAL_OBJECT,
  OP_GET_PARTIAL_OBJECT_64,
  OP_GET_STORAGE_IDS,
  OP_OPEN_SESSION,
} from '../../../src/bridges/mtp/codes';
import type { BridgeDeviceRef, UsbDeviceInfo } from '../../../src/usb/bridge';
import { bytesBody, createMemoryPipe, folder, type MemoryObject } from './memory-pipe';

const REF: BridgeDeviceRef = {
  bridge: 'mtp',
  handle: 'loc-1',
  identity: 'hidden-serial',
  label: 'Pixel',
  platform: 'android',
};

const signal = new AbortController().signal;
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('MTP session', () => {
  it('claims still image and ignores an adb-only phone', () => {
    const bridge = createMtpBridge();
    expect(bridge.claims(usb([{ cls: 6, sub: 1, proto: 1 }]))).toBe(true);
    expect(bridge.claims(usb([{ cls: 0xff, sub: 0x42, proto: 1 }]))).toBe(false);
  });

  it('lists one JPEG under DCIM and reads it with GetPartialObject64', async () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0, 1, 2, 3, 0xff, 0xd9]);
    const pipe = createMemoryPipe([folder(1, 0, 'DCIM'), file(2, 1, 'photo.jpg', bytes, '20240601T120000')]);
    const bridge = createMtpBridge({ openPipe: async () => pipe });
    const opened = await bridge.open(REF, signal);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const items = [];
    for await (const page of opened.value.list(signal)) items.push(...page);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: 'photo.jpg',
      folder: 'DCIM',
      album: 'DCIM',
      sizeBytes: bytes.byteLength,
      width: 4,
    });
    const dir = await mkdtemp(join(tmpdir(), 'mtp-session-'));
    dirs.push(dir);
    const pulled = await opened.value.pull('2', { dest: join(dir, 'photo.jpg'), offset: 0, signal });
    expect(pulled.ok).toBe(true);
    if (!pulled.ok) return;
    expect(Buffer.compare(await readFile(join(dir, 'photo.jpg')), bytes)).toBe(0);
    expect(pulled.value.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(pipe.opcodes).toEqual([
      OP_OPEN_SESSION,
      OP_GET_STORAGE_IDS,
      OP_GET_OBJECT_HANDLES,
      OP_GET_OBJECT_INFO,
      OP_GET_OBJECT_HANDLES,
      OP_GET_OBJECT_INFO,
      OP_GET_PARTIAL_OBJECT_64,
    ]);
    await opened.value.close();
  });

  it('treats a session that is already open as success', async () => {
    const pipe = createMemoryPipe([folder(1, 0, 'DCIM')], { sessionAlreadyOpen: true });
    const opened = await createMtpBridge({ openPipe: async () => pipe }).open(REF, signal);
    expect(opened.ok).toBe(true);
    if (opened.ok) await opened.value.close();
  });

  it('reports a failed claim as device busy', async () => {
    const pipe = createMemoryPipe([], { claim: 'busy' });
    const opened = await createMtpBridge({ openPipe: async () => pipe }).open(REF, signal);
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.error.code).toBe('transfer.device_busy');
      expect(opened.error.detail).toBe('camera-agent');
    }
  });

  it('tells a claim that failed for another reason, or on a phone that left, from a busy one', async () => {
    const failed = await createMtpBridge({
      openPipe: async () => createMemoryPipe([], { claim: 'failed' }),
    }).open(REF, signal);
    expect(failed.ok ? null : failed.error.code).toBe('transfer.bridge_failed');
    const gone = await createMtpBridge({
      openPipe: async () => createMemoryPipe([], { claim: 'gone' }),
    }).open(REF, signal);
    expect(gone.ok ? null : gone.error.code).toBe('transfer.device_gone');
  });

  it('opens the session as transaction 0 and numbers the next operation 1', async () => {
    const pipe = createMemoryPipe([folder(1, 0, 'DCIM')]);
    const opened = await createMtpBridge({ openPipe: async () => pipe }).open(REF, signal);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    for await (const page of opened.value.list(signal)) expect(page).toEqual([]);
    expect(pipe.transactions.slice(0, 3)).toEqual([0, 1, 2]);
    await opened.value.close();
  });

  it('returns a short read when a container stalls', async () => {
    const pipe = createMemoryPipe(
      [folder(1, 0, 'DCIM'), file(2, 1, 'photo.jpg', Uint8Array.of(1, 2, 3, 4), '20240601T120000')],
      {
        stallOnPartial: true,
      },
    );
    const opened = await createMtpBridge({ openPipe: async () => pipe }).open(REF, signal);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const dir = await mkdtemp(join(tmpdir(), 'mtp-stall-'));
    dirs.push(dir);
    const pulled = await opened.value.pull('2', { dest: join(dir, 'photo.jpg'), offset: 0, signal });
    expect(pulled.ok).toBe(false);
    if (!pulled.ok) expect(pulled.error.code).toBe('transfer.short_read');
    await opened.value.close();
  });

  it('falls back to GetPartialObject when the 64-bit read is unsupported', async () => {
    const bytes = Uint8Array.of(9, 8, 7);
    const pipe = createMemoryPipe(
      [folder(1, 0, 'Pictures'), file(2, 1, 'shot.png', bytes, '20240602T010000')],
      {
        partial64Unsupported: true,
      },
    );
    const opened = await createMtpBridge({ openPipe: async () => pipe }).open(REF, signal);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const dir = await mkdtemp(join(tmpdir(), 'mtp-fallback-'));
    dirs.push(dir);
    const pulled = await opened.value.pull('2', { dest: join(dir, 'shot.png'), offset: 0, signal });
    expect(pulled.ok).toBe(true);
    const again = await opened.value.pull('2', { dest: join(dir, 'again.png'), offset: 0, signal });
    expect(again.ok).toBe(true);
    expect(pipe.opcodes.filter((code) => code === OP_GET_PARTIAL_OBJECT_64)).toHaveLength(1);
    expect(pipe.opcodes.filter((code) => code === OP_GET_PARTIAL_OBJECT)).toHaveLength(2);
    await opened.value.close();
  });

  it('pauses on a cable pull mid-pull, and the part continues from its size on the next pull', async () => {
    const bytes = Uint8Array.from({ length: 3 * 1024 * 1024 + 77 }, (_, index) => (index * 7) & 0xff);
    const objects = [folder(1, 0, 'DCIM'), file(2, 1, 'clip.jpg', bytes, '20240601T120000')];
    let unplugged = 0;
    const first = createMemoryPipe(objects, {
      disconnectAt: { handle: 2, offset: 2 * 1024 * 1024, onGone: () => (unplugged += 1) },
    });
    const cut = await createMtpBridge({ openPipe: async () => first }).open(REF, signal);
    expect(cut.ok).toBe(true);
    if (!cut.ok) return;
    const dir = await mkdtemp(join(tmpdir(), 'mtp-cut-'));
    dirs.push(dir);
    const dest = join(dir, 'clip.jpg.part');
    const dropped = await cut.value.pull('2', { dest, offset: 0, signal });
    expect(dropped.ok ? null : dropped.error.code).toBe('transfer.device_gone');
    expect(unplugged).toBe(1);
    await cut.value.close();
    const kept = (await readFile(dest)).byteLength;
    expect(kept).toBe(2 * 1024 * 1024);

    const second = createMemoryPipe(objects, { maxTransfer: 512 });
    const back = await createMtpBridge({ openPipe: async () => second }).open(REF, signal);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const resumed = await back.value.pull('2', { dest, offset: kept, signal });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(second.reads[0]).toEqual({ handle: 2, offset: kept });
    expect(Buffer.compare(await readFile(dest), bytes)).toBe(0);
    expect(resumed.value.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    await back.value.close();
  });

  it('lists the folder path and the album, sanitised, and skips .thumbnails', async () => {
    const pipe = createMemoryPipe([
      folder(1, 0, 'DCIM'),
      folder(2, 1, 'Camera'),
      folder(3, 2, '.hidden:odd'),
      folder(6, 1, '.thumbnails'),
      file(4, 2, 'a/b.jpg', Uint8Array.of(0xff, 0xd8, 0xff), '20240601T120000Z'),
      file(5, 3, 'c.jpg', Uint8Array.of(0xff, 0xd8, 0xff), '20240601T120000+0530'),
      file(7, 6, 'thumb.jpg', Uint8Array.of(0xff, 0xd8, 0xff), '20240601T120000Z'),
    ]);
    const opened = await createMtpBridge({ openPipe: async () => pipe }).open(REF, signal);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const items = [];
    for await (const page of opened.value.list(signal)) items.push(...page);
    expect(items.map((item) => [item.name, item.folder, item.album, item.createdAt])).toEqual([
      ['ab.jpg', 'DCIM/Camera', 'Camera', Date.UTC(2024, 5, 1, 12, 0, 0)],
      ['c.jpg', 'DCIM/Camera/hiddenodd', 'hiddenodd', Date.UTC(2024, 5, 1, 6, 30, 0)],
    ]);
    await opened.value.close();
  });

  it('reports a locked Android phone with no exposed MTP storage as transfer.device_locked', async () => {
    const pipe = createMemoryPipe([], { noStorage: true });
    const opened = await createMtpBridge({ openPipe: async () => pipe }).open(REF, signal);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await expect(
      (async () => {
        for await (const _page of opened.value.list(signal)) {
          /* drain */
        }
      })(),
    ).rejects.toMatchObject({ code: 'transfer.device_locked' });
    expect(opened.value.access()).toEqual({ state: 'locked' });
    await opened.value.close();
  });

  it('skips a leftover container from an aborted earlier transaction instead of failing with short_read', async () => {
    const base = createMemoryPipe([
      folder(1, 0, 'DCIM'),
      file(2, 1, 'photo.jpg', Uint8Array.of(0xff, 0xd8, 0xff, 0xd9), '20240601T120000Z'),
    ]);
    let injectedStale = false;
    const pipe = {
      ...base,
      async transferIn(length: number, sig: AbortSignal) {
        if (!injectedStale) {
          injectedStale = true;
          const stale = new Uint8Array(12);
          const view = new DataView(stale.buffer);
          view.setUint32(0, 12, true);
          view.setUint16(4, 3, true);
          view.setUint16(6, 0x2001, true);
          view.setUint32(8, 9999, true);
          return { data: stale, status: 'ok' as const };
        }
        return base.transferIn(length, sig);
      },
    };
    const opened = await createMtpBridge({ openPipe: async () => pipe }).open(REF, signal);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const items = [];
    for await (const page of opened.value.list(signal)) items.push(...page);
    expect(items).toHaveLength(1);
    await opened.value.close();
  });

  it('ignores a USB bulk zero-length packet between a packet-aligned data container and its response', async () => {
    const payload = new Uint8Array(36 * 1024 - 12).fill(0xab);
    const base = createMemoryPipe([
      folder(1, 0, 'DCIM'),
      file(2, 1, 'photo.jpg', payload, '20240601T120000Z'),
    ]);
    let sendZlp = false;
    const pipe = {
      ...base,
      async transferIn(length: number, sig: AbortSignal) {
        if (sendZlp) {
          sendZlp = false;
          return { data: new Uint8Array(), status: 'ok' as const };
        }
        const got = await base.transferIn(length, sig);
        if (got.data.byteLength === 35 * 1024) sendZlp = true;
        return got;
      },
    };
    const opened = await createMtpBridge({ openPipe: async () => pipe }).open(REF, signal);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const dir = await mkdtemp(join(tmpdir(), 'mtp-zlp-'));
    dirs.push(dir);
    const pulled = await opened.value.pull('2', { dest: join(dir, 'photo.jpg'), offset: 0, signal });
    expect(pulled.ok).toBe(true);
    await opened.value.close();
  });
});

function file(
  handle: number,
  parent: number,
  name: string,
  bytes: Uint8Array,
  created: string,
): MemoryObject {
  return {
    handle,
    storageId: 1,
    parent,
    format: name.endsWith('.png') ? 0x380b : 0x3801,
    name,
    created,
    modified: created,
    body: bytesBody(bytes),
    width: 4,
    height: 2,
  };
}

function usb(interfaces: UsbDeviceInfo['interfaces']): UsbDeviceInfo {
  return { locationId: '1', vendorId: 0x18d1, productId: 1, serial: null, product: 'Pixel', interfaces };
}
