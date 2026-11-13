// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-CMD: app://media/template-reel/<templateId> plays a template's kept reel in byte ranges, read-only, and only
 * the file the template media store names, inside that template's own folder. Every other path under it, every
 * path-traversal attempt and every template without a kept reel is a 404.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createContainer,
  createManualClock,
  newId,
  ok,
  templateReelUrl,
  unwrap,
  type TemplateId,
  type TemplateMediaStore,
} from '@taalcut/core';
import { createTemplateMediaStore, createTemplateStore, openDatabase } from '@taalcut/library';
import { planFormat } from '@taalcut/templates';
import { keptReelPath, libraryTemplateReels, serveTemplateReel } from '../src/main/protocol/template-reel';
import { templatesRoot } from '../src/shared/template-assets';
import { LibraryDatabaseToken } from '../src/shared/tokens';

const userData = mkdtempSync(join(tmpdir(), 'taalcut-template-reel-'));
afterAll(() => rmSync(userData, { recursive: true, force: true }));
const root = templatesRoot(userData);

/** A template's media folder with `name` in it. */
function kept(templateId: TemplateId, name: string, bytes = '0123456789'): string {
  const folder = join(root, 'media', templateId);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, name), bytes);
  return join(folder, name);
}

const reel = newId<'Template'>();
const reelPath = kept(reel, 'reference.mp4');
const webm = newId<'Template'>();
kept(webm, 'reference.webm', 'webm');
const text = newId<'Template'>();
const textPath = kept(text, 'notes.txt', 'not a video');
const empty = newId<'Template'>();
const emptyPath = kept(empty, 'reference.mp4', '');
const secret = join(userData, 'secret.mp4');
writeFileSync(secret, 'the owner’s own file');
const linked = newId<'Template'>();
mkdirSync(join(root, 'media', linked), { recursive: true });
symlinkSync(secret, join(root, 'media', linked, 'reference.mp4'));
const outside = newId<'Template'>();
mkdirSync(join(root, 'media', outside), { recursive: true });

/** A store that knows these templates' rows; any other template has no media. */
const paths = new Map<TemplateId, string>([
  [reel, reelPath],
  [webm, join(root, 'media', webm, 'reference.webm')],
  [text, textPath],
  [empty, emptyPath],
  [linked, join(root, 'media', linked, 'reference.mp4')],
  [outside, join(root, 'media', outside, '..', reel, 'reference.mp4')],
]);
const store: Pick<TemplateMediaStore, 'get'> = {
  get: async (templateId) => {
    const path = paths.get(templateId);
    return ok(path ? { media: {} as never, path } : null);
  },
};
const reelOf = (templateId: TemplateId) => keptReelPath(store, root, templateId);

function request(url: string, init: { method?: string; range?: string } = {}) {
  const headers = new Headers(init.range ? { range: init.range } : {});
  return { url, method: init.method ?? 'GET', headers };
}
const status = async (url: string, init?: { method?: string; range?: string }) =>
  (await serveTemplateReel(request(url, init), reelOf))?.status;

describe('serveTemplateReel', () => {
  it('streams the kept reel whole, or the byte range a <video> asks for', async () => {
    const whole = await serveTemplateReel(request(templateReelUrl(reel)), reelOf);
    expect(whole?.status).toBe(200);
    expect(whole?.headers.get('content-type')).toBe('video/mp4');
    expect(whole?.headers.get('accept-ranges')).toBe('bytes');
    expect(whole?.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await whole?.text()).toBe('0123456789');

    const part = await serveTemplateReel(request(templateReelUrl(reel), { range: 'bytes=2-5' }), reelOf);
    expect(part?.status).toBe(206);
    expect(part?.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await part?.text()).toBe('2345');
    const tail = await serveTemplateReel(request(templateReelUrl(reel), { range: 'bytes=-3' }), reelOf);
    expect(await tail?.text()).toBe('789');

    const head = await serveTemplateReel(request(templateReelUrl(reel), { method: 'HEAD' }), reelOf);
    expect(head?.headers.get('content-length')).toBe('10');
    expect(head?.body).toBeNull();
    const other = await serveTemplateReel(request(templateReelUrl(webm)), reelOf);
    expect(other?.headers.get('content-type')).toBe('video/webm');
  });

  it('is a 404 for a template without a kept reel, a file that isn’t a video, and an empty one', async () => {
    expect(await status(templateReelUrl(newId<'Template'>()))).toBe(404);
    expect(await status(templateReelUrl(text))).toBe(404);
    expect(await status(templateReelUrl(empty))).toBe(404);
  });

  it('is a 404 for every path-traversal attempt and anything that isn’t just the id', async () => {
    const attempts = [
      'app://media/template-reel/..%2F..%2Fsecret.mp4',
      `app://media/template-reel/${reel}%2F..%2F..%2Fsecret.mp4`,
      `app://media/template-reel/${reel}/reference.mp4`,
      `app://media/template-reel/${reel}/..%2F..%2Fsecret.mp4`,
      `app://media/template-reel/${reel}?path=/etc/passwd`,
      `app://media/template-reel/${reel}#t=1`,
      `app://media/template-reel/${reel.toLowerCase()}`,
      `app://media/template-reel/${reel}%00`,
      'app://media/template-reel/',
      'app://media/template-reel/not-an-id',
    ];
    for (const url of attempts) expect([url, await status(url)]).toEqual([url, 404]);
    // Dot segments are resolved by the URL parser before any handler sees them: these no longer name the route.
    for (const url of [
      'app://media/template-reel/%2e%2e/%2e%2e/secret.mp4',
      `app://media/template-reel/${reel}/../../secret.mp4`,
    ])
      expect([url, await status(url)]).toEqual([url, undefined]);
    // A link planted in the folder, or a row naming a path out of it, reads nothing outside it.
    expect(await status(templateReelUrl(linked))).toBe(404);
    expect(await status(templateReelUrl(outside))).toBe(404);
    expect(readFileSync(secret, 'utf8')).toBe('the owner’s own file');
  });

  it('refuses a range past the end and anything but a read', async () => {
    expect(await status(templateReelUrl(reel), { range: 'bytes=40-50' })).toBe(416);
    expect(await status(templateReelUrl(reel), { range: 'bytes=0-1,4-5' })).toBe(416);
    for (const method of ['POST', 'PUT', 'DELETE'])
      expect(await status(templateReelUrl(reel), { method })).toBe(405);
  });

  it('leaves every other URL to the next handler', async () => {
    for (const url of [
      `app://media/originals/${newId<'Asset'>()}`,
      `app://taalcut/template-reel/${reel}`,
      `app://preview/template-reel/${reel}`,
      `app://media/templates/${'a'.repeat(64)}.jpg`,
    ])
      expect(await serveTemplateReel(request(url), reelOf)).toBeUndefined();
  });
});

describe('libraryTemplateReels', () => {
  it('serves a template the library keeps a reel for, and nothing before the library is bound', async () => {
    const clock = createManualClock(Date.UTC(2026, 9, 31));
    const db = unwrap(openDatabase({ path: ':memory:', clock: () => clock.now() }));
    const templates = createTemplateStore(db, { assetsDir: join(root, 'assets') });
    const template = unwrap(
      planFormat(
        { formatId: 'vlog', targetSeconds: 20, brief: null, createdAt: 1 },
        { template: () => newId(), slot: () => newId(), overlay: () => newId() },
      ),
    );
    unwrap(await templates.create(template, { name: 'A', projectId: null, listed: true }));
    const download = join(userData, 'download.mp4');
    writeFileSync(download, 'a kept reel');
    const media = createTemplateMediaStore(db, { templatesRoot: root });
    unwrap(
      await media.keep(template.id, {
        path: download,
        mode: 'copy',
        durationMs: 20_000,
        hasAudio: true,
        source: 'anonymous',
      }),
    );
    const reels = libraryTemplateReels(userData);
    expect(await serveTemplateReel(request(templateReelUrl(template.id)), reels.resolve)).toMatchObject({
      status: 404,
    });
    reels.bind(createContainer().value(LibraryDatabaseToken, db));
    const served = await serveTemplateReel(request(templateReelUrl(template.id)), reels.resolve);
    expect(served?.status).toBe(200);
    expect(await served?.text()).toBe('a kept reel');
    expect(await status(templateReelUrl(newId<'Template'>()))).toBe(404);
    // Removed media is gone from the route at once: the store is asked on every request.
    unwrap(await media.remove(template.id));
    expect((await serveTemplateReel(request(templateReelUrl(template.id)), reels.resolve))?.status).toBe(404);
  });
});
