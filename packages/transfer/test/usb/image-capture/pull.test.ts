// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Downloads and thumbnails go only where the helper may write (`--allow-root`):
 * a download into its own folder beside the `.part`, a thumbnail under the
 * scratch folder. Nothing else in the shared staging folder is touched.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BridgeFailed } from '../../../src/usb/errors';
import { cleanScratch, FakeEndpoint, helperFailure, open, openReady, scratch } from './fake-endpoint';

afterEach(cleanScratch);

describe('image capture pull', () => {
  it('hashes the download, places it at dest and leaves the rest of staging alone', async () => {
    const staging = await scratch();
    const payload = Buffer.from('hello-iphone');
    const sha = createHash('sha256').update(payload).digest('hex');
    const fake = new FakeEndpoint();
    fake.roots = [staging];
    let folder = '';
    fake.handle = async (method, params) => {
      if (method !== 'devices.download') return openReady();
      expect(params.offset).toBe(0);
      if (typeof params.destDir !== 'string') throw new Error('destDir');
      folder = params.destDir;
      expect(await readdir(folder)).toEqual([]);
      await writeFile(join(folder, 'clip.HEIC'), payload);
      await writeFile(join(folder, 'clip.AAE'), 'edit');
      // A Wi-Fi upload and another item's journal land in the shared folder meanwhile.
      await writeFile(join(staging, 'wifi.part'), 'upload');
      await writeFile(join(staging, 'other.import.json'), '{}');
      fake.emit('download.progress', { handle: params.handle, id: params.id, bytes: 4, total: 12 });
      // The helper reports every name that appeared in destDir during the download.
      return { file: join(folder, 'clip.HEIC'), bytes: payload.length, sha256: 'x', ancillary: ['clip.AAE'] };
    };
    const { session } = await open(fake);
    let seen = -1;
    const dest = join(staging, 'out.part');
    const result = await session.pull('7', {
      dest,
      offset: 128,
      signal: new AbortController().signal,
      onBytes: (received) => {
        seen = received;
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ bytes: payload.length, sha256: sha, ancillary: [] });
    expect(folder).toBe(`${dest}.icc`);
    expect(await readFile(dest)).toEqual(payload);
    expect((await readdir(staging)).sort()).toEqual(['other.import.json', 'out.part', 'wifi.part']);
    expect(seen).toBe(4);
  });

  it('refuses a file outside the download folder and clears the folder', async () => {
    const staging = await scratch();
    const fake = new FakeEndpoint();
    fake.roots = [staging];
    fake.handle = async (method) => {
      if (method !== 'devices.download') return openReady();
      await writeFile(join(staging, 'elsewhere.HEIC'), 'x');
      return { file: join(staging, 'elsewhere.HEIC'), bytes: 1 };
    };
    const { session } = await open(fake);
    const result = await session.pull('7', {
      dest: join(staging, 'a.part'),
      offset: 0,
      signal: new AbortController().signal,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toEqual(BridgeFailed(undefined, { detail: 'devices.session_failed' }));
    expect((await readdir(staging)).sort()).toEqual(['elsewhere.HEIC']);
  });

  it('returns item_empty and download_failed as BridgeFailed details without a path', async () => {
    const staging = await scratch();
    const fake = new FakeEndpoint();
    fake.handle = async (method) => {
      if (method === 'devices.download') throw helperFailure('devices.item_empty', '/tmp/secret/phone.jpg');
      return openReady();
    };
    const { session } = await open(fake);
    const empty = await session.pull('7', {
      dest: join(staging, 'a.part'),
      offset: 0,
      signal: new AbortController().signal,
    });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.error).toEqual(BridgeFailed(undefined, { detail: 'devices.item_empty' }));

    fake.handle = async (method) => {
      if (method === 'devices.download')
        throw helperFailure('devices.download_failed', '/tmp/secret/phone.jpg');
      return openReady();
    };
    const failed = await session.pull('7', {
      dest: join(staging, 'b.part'),
      offset: 3,
      signal: new AbortController().signal,
    });
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.error).toEqual(BridgeFailed(undefined, { detail: 'devices.download_failed' }));
    expect(await readdir(staging)).toEqual([]);
  });

  it('writes thumbnails under the scratch folder the helper may write to', async () => {
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const thumbs = await scratch();
    const fake = new FakeEndpoint();
    fake.roots = [thumbs];
    fake.handle = async (method, params) => {
      if (method !== 'devices.thumbnail') return openReady();
      expect(params.maxPixel).toBe(256);
      if (typeof params.dest !== 'string') throw new Error('dest');
      await writeFile(params.dest, jpeg);
      return { path: params.dest, width: 2, height: 2 };
    };
    const { session } = await open(fake, thumbs);
    const result = await session.thumbnail('7', new AbortController().signal);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) throw new Error('no thumbnail');
    expect(Buffer.from(result.value).equals(Buffer.from(jpeg))).toBe(true);
    expect(await readdir(thumbs)).toEqual([]);

    fake.handle = async (method) => (method === 'devices.thumbnail' ? { path: null } : openReady());
    const none = await session.thumbnail('8', new AbortController().signal);
    expect(none.ok && none.value).toBeNull();
  });

  it('a scratch folder outside the allowed roots is refused, as the helper would', async () => {
    const thumbs = await scratch();
    const elsewhere = await scratch();
    const fake = new FakeEndpoint();
    fake.roots = [thumbs];
    fake.handle = async () => openReady();
    const { session } = await open(fake, elsewhere);
    const result = await session.thumbnail('7', new AbortController().signal);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toEqual(BridgeFailed(undefined, { detail: 'helper.path_not_allowed' }));
  });
});
