// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * app://media/templates/<sha256>.<jpg|webp> (core's templateAssetUrl) and
 * app://media/styles/<sha256>.<png|jpg|webp> (styleAssetUrl): served from the
 * store's folder through the library's path function; only sha256 names; a
 * link out of the folder, a bad name or a missing file is a 404; other media
 * URLs are left to the next handler.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { styleAssetUrl, templateAssetUrl } from '@taalcut/core';
import { styleAssetPath, templateAssetPath } from '@taalcut/library';
import { styleAssetHandler, templateAssetHandler } from '../src/main/protocol/stored-assets';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const SHA = createHash('sha256').update(JPEG).digest('hex');
const OTHER = 'a'.repeat(64);

let base: string;
let dir: string;
let serve: ReturnType<typeof templateAssetHandler>;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'taalcut-template-assets-'));
  dir = join(base, 'templates', 'assets');
  const path = templateAssetPath(dir, SHA);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JPEG);
  // A link inside the folder that points outside it.
  await writeFile(join(base, 'secret'), 'nope');
  await mkdir(join(templateAssetPath(dir, OTHER), '..'), { recursive: true });
  await symlink(join(base, 'secret'), templateAssetPath(dir, OTHER));
  serve = templateAssetHandler(dir);
});

afterAll(() => rm(base, { recursive: true, force: true }));

const request = (url: string, method = 'GET') => serve(new Request(url, { method }));

describe('template assets on app://media', () => {
  it('serves a contact sheet by the URL core builds', async () => {
    const url = templateAssetUrl({ asset: SHA, mediaType: 'image/jpeg' });
    const response = await request(url);
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toBe('image/jpeg');
    expect(response?.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response?.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(Buffer.from(await response!.arrayBuffer())).toEqual(JPEG);
    const head = await request(url, 'HEAD');
    expect(head?.status).toBe(200);
    expect(head?.headers.get('content-length')).toBe(String(JPEG.length));
  });

  it('refuses bad names, links out of the folder, missing files and writes', async () => {
    expect((await request(`app://media/templates/${SHA}.png`))?.status).toBe(404);
    expect((await request('app://media/templates/..%2F..%2Fsecret.jpg'))?.status).toBe(404);
    expect((await request(`app://media/templates/${OTHER}.jpg`))?.status).toBe(404);
    expect((await request(`app://media/templates/${'b'.repeat(64)}.webp`))?.status).toBe(404);
    expect((await request(`app://media/templates/${SHA}.jpg`, 'POST'))?.status).toBe(405);
  });

  it('leaves every other URL to the next handler', async () => {
    expect(await request('app://media/thumbs/ab/abc.jpg')).toBeUndefined();
    expect(await request('app://taalcut/templates/x')).toBeUndefined();
    expect(await request(`app://preview/templates/${SHA}.jpg`)).toBeUndefined();
  });
});

describe('Style logos on app://media', () => {
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
  const LOGO = createHash('sha256').update(PNG).digest('hex');
  let styles: string;
  let logos: ReturnType<typeof styleAssetHandler>;

  beforeAll(async () => {
    styles = join(base, 'styles', 'assets');
    await mkdir(join(styleAssetPath(styles, LOGO), '..'), { recursive: true });
    await writeFile(styleAssetPath(styles, LOGO), PNG);
    logos = styleAssetHandler(styles);
  });

  it('serves a logo by the URL core builds, and nothing a template URL names', async () => {
    const response = await logos(new Request(styleAssetUrl({ asset: LOGO, mediaType: 'image/png' })));
    expect(response?.status).toBe(200);
    expect(response?.headers.get('content-type')).toBe('image/png');
    expect(response ? Buffer.from(await response.arrayBuffer()) : null).toEqual(PNG);
    expect((await logos(new Request(`app://media/styles/${LOGO}.gif`)))?.status).toBe(404);
    expect((await logos(new Request(`app://media/styles/${'c'.repeat(64)}.png`)))?.status).toBe(404);
    expect(
      await logos(new Request(templateAssetUrl({ asset: SHA, mediaType: 'image/jpeg' }))),
    ).toBeUndefined();
  });
});
