// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planDeviceThumb, serveDeviceThumb } from '../src/main/protocol/device-thumbs';

const DEVICE = 'ABCDEFGHIJKLMNOP';
const ITEM = 'QRSTUVWXYZ234567';
const URL = `app://media/device/${DEVICE}/${ITEM}.jpg`;
const BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x01, 0x02, 0x03, 0x04]);

function request(url: string, method = 'GET') {
  return { url, method };
}

describe('device thumbs', () => {
  let root = '';

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'taalcut-device-thumbs-')));
    mkdirSync(join(root, DEVICE), { recursive: true });
    writeFileSync(join(root, DEVICE, `${ITEM}.jpg`), BYTES);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('plans a good key and ignores every other media URL', () => {
    expect(planDeviceThumb(request(URL), root)).toMatchObject({ kind: 'file', size: BYTES.length });
    expect(planDeviceThumb(request('app://media/proxies/ab/file.mp4'), root)).toBeUndefined();
    expect(planDeviceThumb(request('app://taalcut/index.html'), root)).toBeUndefined();
  });

  it('refuses traversal, a missing file and a bad method', async () => {
    // %2e%2e%2f stays one segment until decode, so ".." is still visible. A bare ".." is folded by the URL parser.
    const traversal = await serveDeviceThumb(request('app://media/device/%2e%2e%2fsecret.jpg'), root);
    expect(traversal?.status).toBe(403);

    const missing = await serveDeviceThumb(
      request('app://media/device/AAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBB.jpg'),
      root,
    );
    expect(missing?.status).toBe(404);

    const badKey = await serveDeviceThumb(request('app://media/device/not-a-thumb.jpg'), root);
    expect(badKey?.status).toBe(404);

    const method = await serveDeviceThumb(request(URL, 'POST'), root);
    expect(method?.status).toBe(405);
  });

  it('returns the JPEG for GET and only the length for HEAD', async () => {
    const get = await serveDeviceThumb(request(URL), root);
    expect(get).toBeDefined();
    if (get === undefined) return;
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/jpeg');
    expect(get.headers.get('content-length')).toBe(String(BYTES.length));
    expect(Buffer.from(await get.arrayBuffer())).toEqual(BYTES);

    const head = await serveDeviceThumb(request(URL, 'HEAD'), root);
    expect(head).toBeDefined();
    if (head === undefined) return;
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(BYTES.length));
    expect(new Uint8Array(await head.arrayBuffer())).toHaveLength(0);
  });
});
