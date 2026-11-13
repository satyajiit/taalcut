// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2: app://media/originals/<assetId> plays a clip's original that is its own proxy, in byte ranges, and only the
 * file the library names for that clip.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { serveOriginalMedia } from '../src/main/protocol/original-media';

const dir = mkdtempSync(join(tmpdir(), 'taalcut-original-'));
const movie = join(dir, 'IMG_0042.MOV');
writeFileSync(movie, Buffer.from('0123456789'));
const odd = join(dir, 'clip.mkv');
writeFileSync(odd, Buffer.from('mkv'));

const id = newId<'Asset'>();
const other = newId<'Asset'>();
const originals = (assetId: AssetId) => (assetId === id ? movie : assetId === other ? odd : undefined);

function request(url: string, init: { method?: string; range?: string } = {}) {
  const headers = new Headers(init.range ? { range: init.range } : {});
  return { url, method: init.method ?? 'GET', headers };
}

describe('serveOriginalMedia', () => {
  it('streams the whole file, or the byte range a <video> asks for', async () => {
    const whole = serveOriginalMedia(request(`app://media/originals/${id}`), originals);
    expect(whole?.status).toBe(200);
    expect(whole?.headers.get('content-type')).toBe('video/mp4');
    expect(whole?.headers.get('accept-ranges')).toBe('bytes');
    expect(await whole?.text()).toBe('0123456789');

    const part = serveOriginalMedia(request(`app://media/originals/${id}`, { range: 'bytes=2-5' }), originals);
    expect(part?.status).toBe(206);
    expect(part?.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await part?.text()).toBe('2345');

    const head = serveOriginalMedia(request(`app://media/originals/${id}`, { method: 'HEAD' }), originals);
    expect(head?.headers.get('content-length')).toBe('10');
  });

  it('refuses what the library doesn’t name, a range past the end and anything but a read', () => {
    const at = (url: string, init?: { method?: string; range?: string }) =>
      serveOriginalMedia(request(url, init), originals)?.status;
    expect(at(`app://media/originals/${newId<'Asset'>()}`)).toBe(404);
    expect(at(`app://media/originals/${other}`)).toBe(404);
    expect(at('app://media/originals/not-an-id')).toBe(400);
    expect(at('app://media/originals/..%2F..%2Fetc%2Fpasswd')).toBe(400);
    expect(at(`app://media/originals/${id}`, { range: 'bytes=40-50' })).toBe(416);
    expect(at(`app://media/originals/${id}`, { method: 'POST' })).toBe(405);
  });

  it('leaves every other URL to the next handler', () => {
    expect(serveOriginalMedia(request(`app://media/proxies/ab/${'a'.repeat(64)}.v1.mp4`), originals)).toBeUndefined();
    expect(serveOriginalMedia(request(`app://taalcut/originals/${id}`), originals)).toBeUndefined();
  });
});
