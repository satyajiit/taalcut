// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * app://preview (packages/render SPEC section 5): session folders by token,
 * manifest entries only under allowed roots, HTTP Range for <video>, and the
 * preview page's own CSP on every response.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PREVIEW_CSP } from '@taalcut/core';
import { servePreview } from '../src/main/render/preview-protocol';
import { parseRange, planPreviewRequest, type PreviewRoots } from '../src/main/render/preview-resolve';
import { nodePreviewFiles } from '../src/main/render/preview-protocol';

const TOKEN = '0123456789abcdef0123456789abcdef';
const BYTES = Buffer.from(Array.from({ length: 1000 }, (_, index) => index % 256));

let base: string;
let roots: PreviewRoots;

const get = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
  servePreview(new Request(`app://preview/${path}`, { method, headers }), roots);

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'taalcut-preview-'));
  const preview = join(base, 'cache', 'render', 'preview');
  const renders = join(base, 'renders');
  const outside = join(base, 'outside');
  const session = join(preview, TOKEN);
  await mkdir(join(session, 'media'), { recursive: true });
  await mkdir(renders, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(session, 'index.html'), '<!doctype html><title>p</title>');
  await writeFile(join(session, 'media', 'a.mp4'), BYTES);
  await writeFile(join(session, '.hidden'), 'x');
  await writeFile(join(renders, 'render.mp4'), BYTES);
  await writeFile(join(outside, 'secret.mp4'), 'nope');
  await symlink(join(outside, 'secret.mp4'), join(session, 'media', 'escape.mp4'));
  await writeFile(
    join(session, 'manifest.json'),
    JSON.stringify({
      'media/render.mp4': join(renders, 'render.mp4'),
      'media/outside.mp4': join(outside, 'secret.mp4'),
      'media/relative.mp4': 'renders/render.mp4',
    }),
  );
  roots = { preview, allowed: [renders] };
});

afterAll(() => rm(base, { recursive: true, force: true }));

describe('app://preview', () => {
  it('serves a session file with the preview CSP, no-store and cross-origin resource policy', async () => {
    const response = await get(`${TOKEN}/index.html`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toBe(PREVIEW_CSP);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(await response.text()).toContain('<title>p</title>');
  });

  it('answers byte ranges with 206: closed, open-ended and suffix', async () => {
    const closed = await get(`${TOKEN}/media/a.mp4`, { range: 'bytes=10-19' });
    expect(closed.status).toBe(206);
    expect(closed.headers.get('content-range')).toBe('bytes 10-19/1000');
    expect(closed.headers.get('content-length')).toBe('10');
    expect(Buffer.from(await closed.arrayBuffer())).toEqual(BYTES.subarray(10, 20));

    const open = await get(`${TOKEN}/media/a.mp4`, { range: 'bytes=990-' });
    expect(open.headers.get('content-range')).toBe('bytes 990-999/1000');
    expect(Buffer.from(await open.arrayBuffer())).toEqual(BYTES.subarray(990));

    const suffix = await get(`${TOKEN}/media/a.mp4`, { range: 'bytes=-5' });
    expect(suffix.status).toBe(206);
    expect(suffix.headers.get('content-range')).toBe('bytes 995-999/1000');

    const past = await get(`${TOKEN}/media/a.mp4`, { range: 'bytes=0-5000' });
    expect(past.headers.get('content-range')).toBe('bytes 0-999/1000');
  });

  it('refuses an unsatisfiable range with 416 and the size', async () => {
    const response = await get(`${TOKEN}/media/a.mp4`, { range: 'bytes=1000-' });
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */1000');
  });

  it('answers HEAD without a body', async () => {
    const response = await get(`${TOKEN}/media/a.mp4`, {}, 'HEAD');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('1000');
    expect(await response.text()).toBe('');
  });

  it('serves a manifest entry under an allowed root', async () => {
    const response = await get(`${TOKEN}/media/render.mp4`, { range: 'bytes=0-3' });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-type')).toBe('video/mp4');
  });

  it('refuses manifest entries outside the allowed roots, relative ones, and the manifest itself', async () => {
    expect((await get(`${TOKEN}/media/outside.mp4`)).status).toBe(403);
    expect((await get(`${TOKEN}/media/relative.mp4`)).status).toBe(403);
    expect((await get(`${TOKEN}/manifest.json`)).status).toBe(404);
  });

  it('refuses a symlink that leaves the session folder', async () => {
    expect((await get(`${TOKEN}/media/escape.mp4`)).status).toBe(404);
  });

  it('answers unknown tokens, bad tokens, dot-files and missing files with 404', async () => {
    expect((await get('ffffffffffffffffffffffffffffffff/index.html')).status).toBe(404);
    expect((await get('not-a-token/index.html')).status).toBe(404);
    expect((await get(`${TOKEN.toUpperCase()}/index.html`)).status).toBe(404);
    expect((await get(`${TOKEN}/.hidden`)).status).toBe(404);
    expect((await get(`${TOKEN}/missing.js`)).status).toBe(404);
    expect((await get(TOKEN)).status).toBe(404);
  });

  it('refuses traversal hidden behind encoded slashes with 403', async () => {
    expect((await get(`${TOKEN}/..%2f..%2frenders%2frender.mp4`)).status).toBe(403);
    expect((await get(`${TOKEN}/media%2f..%2f..%2f..%2fouside`)).status).toBe(403);
    // Plain and %2e dot segments are resolved by the URL parser before main sees them: no token, 404.
    expect((await get(`${TOKEN}/%2e%2e/%2e%2e/renders/render.mp4`)).status).toBe(404);
  });

  it('allows only GET and HEAD on the preview host', async () => {
    expect((await get(`${TOKEN}/index.html`, {}, 'POST')).status).toBe(405);
    const files = nodePreviewFiles();
    expect(
      planPreviewRequest({ url: `app://taalcut/${TOKEN}/index.html`, method: 'GET' }, roots, files),
    ).toEqual({
      kind: 'error',
      status: 404,
    });
    expect(planPreviewRequest({ url: 'app://preview/%E0%A4%A', method: 'GET' }, roots, files)).toEqual({
      kind: 'error',
      status: 400,
    });
  });
});

describe('parseRange', () => {
  it('parses one range and ignores what it does not support', () => {
    expect(parseRange(null, 10)).toBeUndefined();
    expect(parseRange('bytes=0-0', 10)).toEqual({ start: 0, end: 0 });
    expect(parseRange('bytes=-20', 10)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=0-1,4-5', 10)).toBeUndefined();
    expect(parseRange('items=0-1', 10)).toBeUndefined();
    expect(parseRange('bytes=-', 10)).toBeUndefined();
    expect(parseRange('bytes=5-2', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable');
  });
});
