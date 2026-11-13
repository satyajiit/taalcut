// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { noteDerivedRead, planMediaRequest, serveDerivedMedia } from '../src/main/protocol/media-protocol';
import { darwin } from '../src/platform/darwin';
import { linux } from '../src/platform/linux';
import { frameCacheRoot, mediaCacheRoot } from '../src/shared/media-cache';

const HASH = 'ab'.repeat(32);
const KEY = `proxies/ab/${HASH}.v1.mp4`;
const TOUCH_KEY = `waveforms/ab/${HASH}.v1.bin`;

function request(url: string, method = 'GET', range?: string) {
  return {
    url,
    method,
    headers: { get: (name: string) => (name.toLowerCase() === 'range' ? (range ?? null) : null) },
  };
}

describe('mediaCacheRoot', () => {
  it('on macOS uses the Library Caches sibling of Application Support, and stays inside other userData dirs', () => {
    expect(mediaCacheRoot('/Users/ada/Library/Application Support/Taalcut', darwin)).toBe(
      '/Users/ada/Library/Caches/Taalcut',
    );
    expect(mediaCacheRoot('/tmp/taalcut-user', darwin)).toBe('/tmp/taalcut-user/media-cache');
  });

  it('on Linux stays inside a userData outside ~/.config (platform.test.ts has the XDG rule)', () => {
    expect(mediaCacheRoot('/tmp/taalcut-user', linux)).toBe('/tmp/taalcut-user/media-cache');
    expect(frameCacheRoot('/tmp/taalcut-user', linux)).toBe('/tmp/taalcut-user/media-cache-frames');
  });
});

describe('planMediaRequest', () => {
  const root = '/cache';
  const file = join(root, KEY);
  const statFile = (path: string) => (path === file ? 100 : undefined);

  it('plans a byte range inside the cache and refuses other hosts, bad keys and bad ranges', () => {
    expect(
      planMediaRequest(request(`app://media/${KEY}`, 'GET', 'bytes=10-19'), root, statFile),
    ).toMatchObject({
      kind: 'file',
      path: file,
      range: { start: 10, end: 19 },
      size: 100,
      contentType: 'video/mp4',
    });
    expect(planMediaRequest(request(`app://media/${KEY}`, 'GET', 'bytes=-5'), root, statFile)).toMatchObject({
      range: { start: 95, end: 99 },
    });
    expect(planMediaRequest(request('app://taalcut/index.html'), root, statFile)).toEqual({ kind: 'skip' });
    expect(planMediaRequest(request(`app://media/${KEY}`, 'POST'), root, statFile)).toEqual({
      kind: 'error',
      status: 405,
    });
    // %2e%2e%2f stays encoded until we decode it, so ".." is still visible and refused.
    expect(planMediaRequest(request('app://media/proxies/%2e%2e%2fsecret.mp4'), root, statFile)).toEqual({
      kind: 'error',
      status: 400,
    });
    // The URL parser folds a bare ".." before we see it. What remains is not a derived key.
    expect(planMediaRequest(request('app://media/proxies/%2e%2e/secret.mp4'), root, statFile)).toEqual({
      kind: 'error',
      status: 404,
    });
    expect(planMediaRequest(request('app://media/not-a-key.jpg'), root, statFile)).toEqual({
      kind: 'error',
      status: 404,
    });
    expect(planMediaRequest(request(`app://media/${KEY}`, 'GET', 'bytes=0-1,2-3'), root, statFile)).toEqual({
      kind: 'error',
      status: 416,
      size: 100,
    });
    expect(planMediaRequest(request(`app://media/${KEY}`, 'GET', 'bytes=1000-'), root, statFile)).toEqual({
      kind: 'error',
      status: 416,
      size: 100,
    });
  });
});

describe('serveDerivedMedia', () => {
  let base = '';
  let root = '';
  const body = Buffer.from('abcdefghijklmnopqrstuvwxyz0123456789');

  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'taalcut-media-protocol-')));
    root = join(base, 'cache');
    mkdirSync(join(root, 'proxies', 'ab'), { recursive: true });
    writeFileSync(join(root, KEY), body);
    mkdirSync(join(root, 'waveforms', 'ab'), { recursive: true });
    writeFileSync(join(root, TOUCH_KEY), 'peaks');
    mkdirSync(join(base, 'outside'));
    writeFileSync(join(base, 'outside', 'secret.mp4'), 'secret');
    symlinkSync(
      join(base, 'outside', 'secret.mp4'),
      join(root, 'proxies', 'ab', `${'cd'.repeat(32)}.v1.mp4`),
    );
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('returns 206 for a range, 200 for the whole file, and 416 for a bad range', async () => {
    const part = await serveDerivedMedia(request(`app://media/${KEY}`, 'GET', 'bytes=0-3'), root);
    expect(part?.status).toBe(206);
    expect(part?.headers.get('content-range')).toBe(`bytes 0-3/${body.length}`);
    expect(part?.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await part!.arrayBuffer())).toEqual(body.subarray(0, 4));

    const head = await serveDerivedMedia(request(`app://media/${KEY}`, 'HEAD', 'bytes=0-3'), root);
    expect(head?.status).toBe(206);
    expect(head?.headers.get('content-length')).toBe('4');
    expect(new Uint8Array(await head!.arrayBuffer())).toHaveLength(0);

    const whole = await serveDerivedMedia(request(`app://media/${KEY}`), root);
    expect(whole?.status).toBe(200);
    expect(Buffer.from(await whole!.arrayBuffer())).toEqual(body);

    const bad = await serveDerivedMedia(request(`app://media/${KEY}`, 'GET', 'bytes=0-1,2-3'), root);
    expect(bad?.status).toBe(416);
    expect(bad?.headers.get('content-range')).toBe(`bytes */${body.length}`);
    expect(await serveDerivedMedia(request('app://taalcut/'), root)).toBeUndefined();
  });

  it('does not follow a symlink out of the cache', async () => {
    const leaked = `proxies/ab/${'cd'.repeat(32)}.v1.mp4`;
    const response = await serveDerivedMedia(request(`app://media/${leaked}`), root);
    expect(response?.status).toBe(404);
  });

  it('touches mtime at most once per 10 minutes', async () => {
    const when = 1_700_000_000_000;
    const path = join(root, TOUCH_KEY);
    await noteDerivedRead(root, TOUCH_KEY, when);
    const first = statSync(path).mtimeMs;
    await noteDerivedRead(root, TOUCH_KEY, when + 1_000);
    expect(statSync(path).mtimeMs).toBe(first);
    await noteDerivedRead(root, TOUCH_KEY, when + 11 * 60 * 1000);
    expect(statSync(path).mtimeMs).toBeGreaterThan(first);
  });
});
