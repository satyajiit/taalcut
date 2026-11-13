// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adbGeneratePublicKey, adbGetPublicKeySize, rsaSign, type AdbCredentialStore } from '@yume-chan/adb';
import { describe, expect, it } from 'vitest';
import { createAdbBridge } from '../../src/bridges/adb/bridge';
import { createAdbCredentialStore } from '../../src/bridges/adb/credentials';
import { type AdbPlug } from '../../src/bridges/adb/transport';
import {
  abort,
  adbBridge,
  digest,
  FILES,
  fromList,
  hashOf,
  iface,
  IMAGE,
  IMAGE_MTIME,
  keys,
  listAll,
  noDevices,
  PKCS8,
  REF,
  rowFor,
  ROWS,
  unused,
  USB_INFO,
  VIDEO,
  VIDEO_MTIME,
  withSession,
} from './adb/fixtures';
import { createFakeAdb, type FakeFile, type FakeRow } from './adb/fake-transport';

describe('adb bridge', () => {
  it('claims only the adb interface', () => {
    const bridge = adbBridge({ connect: unused });
    expect(bridge.claims(USB_INFO)).toBe(true);
    expect(bridge.claims(iface(0xff, 0x42, 0x02))).toBe(false);
    expect(bridge.claims(iface(0x06, 0x01, 0x01))).toBe(false);
  });

  it('watches the injected device source, separate from the connector', async () => {
    const plugs: readonly AdbPlug[] = [
      { type: 'added', device: { ...USB_INFO, serial: 'SER123' } },
      { type: 'removed', device: { ...USB_INFO, serial: 'SER123' } },
    ];
    const bridge = createAdbBridge({ keys, connect: unused, devices: () => fromList(plugs) });
    const seen: string[] = [];
    for await (const event of bridge.watch(abort())) {
      seen.push(`${event.type} ${event.ref.handle} ${event.ref.identity} ${event.ref.label}`);
    }
    expect(seen).toEqual(['added bus-1 SER123 Pixel', 'removed bus-1 SER123 Pixel']);
  });

  it('builds one credential the daemon can sign with', async () => {
    const store = createAdbCredentialStore(keys);
    const generated = await Promise.resolve(store.generateKey());
    const expected = digest(PKCS8);
    expect(digest(generated.buffer)).toBe(expected);
    expect(generated.name).toBe('taalcut');
    expect(await keyDigests(store)).toEqual([expected]);
    expect(await keyDigests(store)).toEqual([expected]);
    expect(rsaSign(generated.buffer, Uint8Array.from([1, 2, 3])).byteLength).toBe(256);
    expect(adbGeneratePublicKey(generated.buffer).byteLength).toBe(adbGetPublicKeySize());
  });

  it('lists folders and replaces the album from MediaStore', async () => {
    const fake = createFakeAdb({ files: FILES, rows: ROWS, content: 'ok' });
    await withSession(fake, async (session) => {
      const items = await listAll(session);
      expect(items.map((item) => item.id)).toEqual(['42', '7']);
      const image = items[0];
      const video = items[1];
      if (!image || !video) return;
      // A name-only match lends MediaStore's metadata; the size stays the one the phone listed.
      expect(image).toMatchObject({
        name: 'weirdname.png',
        kind: 'image',
        sizeBytes: IMAGE.byteLength,
        createdAt: 1_650_000_000_123,
        modifiedAt: IMAGE_MTIME * 1000,
        width: 100,
        height: 200,
        durationMs: null,
        type: 'image/jpeg',
        folder: 'DCIM/Camera',
        album: 'Holiday',
        availability: 'unknown',
      });
      expect(video).toMatchObject({
        name: 'My Clip.mp4',
        kind: 'video',
        sizeBytes: VIDEO.byteLength,
        createdAt: VIDEO_MTIME * 1000,
        durationMs: 1500,
        folder: 'Movies',
        album: 'Trips',
        availability: 'unknown',
      });
      expect(session.rangedReads).toBe(false);
      expect(await session.thumbnail(image.id, abort())).toEqual({ ok: true, value: null });
    });
    expect(fake.transcript).toContain('LIST');
    expect(fake.transcript).toContain('EXEC content-query');
    expect(fake.transcript.every((line) => !line.includes('/'))).toBe(true);
  });

  it('falls back to date_added on a phone whose files table has no datetaken', async () => {
    const fake = createFakeAdb({ files: FILES, rows: ROWS, content: 'ok', dateTakenColumn: false });
    await withSession(fake, async (session) => {
      const items = await listAll(session);
      expect(items.map((item) => [item.id, item.createdAt, item.album])).toEqual([
        ['42', 1_700_000_000_000, 'Holiday'],
        ['7', VIDEO_MTIME * 1000, 'Trips'],
      ]);
    });
    expect(fake.transcript.filter((line) => line === 'EXEC content-query')).toHaveLength(2);
  });

  it('gives a MediaStore row to one file only', async () => {
    const twin = Uint8Array.from([4, 4, 4]);
    const files: readonly FakeFile[] = [
      { path: '/sdcard/DCIM/Camera/IMG_1.jpg', bytes: twin, mtime: IMAGE_MTIME },
      { path: '/sdcard/Pictures/Saved/IMG_1.jpg', bytes: IMAGE, mtime: IMAGE_MTIME + 1 },
    ];
    const rows: readonly FakeRow[] = [{ ...rowFor('99', 'IMG_1.jpg', twin.byteLength), bucket: 'Camera' }];
    const fake = createFakeAdb({ files, rows, content: 'ok' });
    await withSession(fake, async (session) => {
      const items = await listAll(session);
      const ids = items.map((item) => item.id).sort();
      expect(ids).toEqual(['/sdcard/Pictures/Saved/IMG_1.jpg', '99']);
      expect(items.find((item) => item.id === '99')?.sizeBytes).toBe(twin.byteLength);
    });
  });

  it('a phone unplugged mid-walk ends the listing with device_gone, not a partial list', async () => {
    const fake = createFakeAdb({ files: FILES, rows: ROWS, content: 'ok', unplugAtList: 3 });
    const bridge = createAdbBridge({
      keys,
      devices: noDevices,
      connect: () => Promise.resolve(fake.transport),
    });
    const opened = await bridge.open(REF, abort());
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await expect(listAll(opened.value)).rejects.toMatchObject({ code: 'transfer.device_gone' });
    await opened.value.close();
  });

  it('keeps the folder walk when content query fails', async () => {
    const fake = createFakeAdb({ files: FILES, rows: ROWS, content: 'fail' });
    await withSession(fake, async (session) => {
      const items = await listAll(session);
      expect(items.map((item) => item.album)).toEqual(['Movies', 'Camera']);
      const video = items[0];
      const image = items[1];
      if (!video || !image) return;
      expect(video).toMatchObject({
        id: '/sdcard/Movies/My Clip.mp4',
        sizeBytes: VIDEO.byteLength,
        createdAt: VIDEO_MTIME * 1000,
        folder: 'Movies',
      });
      expect(image).toMatchObject({
        id: '/sdcard/DCIM/Camera/weird:name.png',
        name: 'weirdname.png',
        sizeBytes: IMAGE.byteLength,
        createdAt: IMAGE_MTIME * 1000,
        type: 'image/png',
        folder: 'DCIM/Camera',
      });
    });
  });

  it('pulls from offset 0 and matches sha256sum', async () => {
    const fake = createFakeAdb({ files: FILES, rows: ROWS, content: 'ok', sha256sum: 'ok' });
    const dir = await mkdtemp(join(tmpdir(), 'taalcut-adb-'));
    try {
      await withSession(fake, async (session) => {
        const items = await listAll(session);
        const image = items.find((item) => item.id === '42');
        expect(image).toBeDefined();
        if (!image) return;
        const dest = join(dir, 'out.bin');
        await writeFile(dest, new Uint8Array(64).fill(0xab));
        let received = 0;
        const pulled = await session.pull(image.id, {
          dest,
          offset: 128,
          signal: abort(),
          onBytes: (n) => {
            received = n;
          },
        });
        expect(pulled.ok).toBe(true);
        if (!pulled.ok) return;
        const expected = createHash('sha256').update(IMAGE).digest('hex');
        expect(pulled.value).toEqual({ bytes: IMAGE.byteLength, sha256: expected, ancillary: [] });
        expect(received).toBe(IMAGE.byteLength);
        expect(Buffer.compare(await readFile(dest), Buffer.from(IMAGE))).toBe(0);
        expect(await hashOf(session)(image.id, abort())).toEqual({ ok: true, value: expected });
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    expect(fake.transcript).toContain('RECV');
    expect(fake.transcript).toContain('EXEC sha256sum');
  });

  it('a part that cannot be written is an error value, not a rejection', async () => {
    const fake = createFakeAdb({ files: FILES, rows: ROWS, content: 'ok' });
    await withSession(fake, async (session) => {
      const items = await listAll(session);
      const first = items[0];
      if (!first) throw new Error('no item');
      const pulled = await session.pull(first.id, {
        dest: join(tmpdir(), 'taalcut-adb-missing-dir', 'nested', 'out.part'),
        offset: 0,
        signal: abort(),
      });
      expect(pulled).toMatchObject({ ok: false, error: { code: 'transfer.bridge_failed', detail: 'write' } });
    });
  });

  it('a sha256sum that fails on the phone is an error, not a missing hash', async () => {
    const fake = createFakeAdb({ files: FILES, content: 'fail', sha256sum: 'error' });
    await withSession(fake, async (session) => {
      const items = await listAll(session);
      const first = items[0];
      if (!first) throw new Error('no item');
      expect(await hashOf(session)(first.id, abort())).toMatchObject({
        ok: false,
        error: { code: 'transfer.bridge_failed', detail: 'sha256sum' },
      });
    });
  });

  it('returns null when sha256sum is absent', async () => {
    const fake = createFakeAdb({ files: FILES, content: 'fail', sha256sum: 'missing' });
    await withSession(fake, async (session) => {
      const items = await listAll(session);
      const first = items[0];
      expect(first).toBeDefined();
      if (!first) return;
      expect(await hashOf(session)(first.id, abort())).toEqual({ ok: true, value: null });
      expect(await hashOf(session)('missing', abort())).toMatchObject({
        ok: false,
        error: { code: 'transfer.bridge_failed', detail: 'unknown-item' },
      });
    });
  });
});

async function keyDigests(store: AdbCredentialStore): Promise<string[]> {
  const digests: string[] = [];
  for await (const key of store.iterateKeys()) digests.push(digest(key.buffer));
  return digests;
}
