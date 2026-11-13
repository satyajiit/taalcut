// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * REF1-KEEP: the template media store. A download moves in, a person's file is copied and left as it was; the
 * summary carries the media in a create, a get and a list; another reel replaces it; deleting the template takes
 * the row at once and the folder at the next prune; a row whose file is gone is pruned.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, unwrap, type TemplateId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createTemplateMediaStore,
  createTemplateStore,
  keptFileName,
  templateMediaFolder,
  templateMediaPath,
} from '../../src/index';
import { fakeClock, openTestDb, tempDir } from '../helpers';
import { template } from './documents';

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

async function setup() {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  const root = join(tempDir(), 'templates');
  const store = createTemplateStore(db, { assetsDir: join(root, 'assets') });
  const media = createTemplateMediaStore(db, { templatesRoot: root });
  const doc = template();
  const id = doc.id as TemplateId;
  const created = unwrap(await store.create(doc, { name: 'Goa', projectId: null, listed: true }));
  const scratch = join(tempDir(), 'scratch');
  mkdirSync(scratch, { recursive: true });
  const reel = (name: string, text: string) => {
    const path = join(scratch, name);
    writeFileSync(path, text);
    return path;
  };
  return { clock, db, root, store, media, id, created, reel };
}

const keep = { durationMs: 15_000, hasAudio: true, source: 'anonymous' as const };

describe('template media store', () => {
  it('moves a download in, measures it, and the summary carries it everywhere', async () => {
    const { root, store, media, id, created, reel } = await setup();
    expect(created.media).toBeNull();
    const download = reel('reference.MP4', 'video and music');
    const kept = unwrap(await media.keep(id, { ...keep, path: download, mode: 'move' }));
    expect(kept).toMatchObject({ file: 'reference.mp4', bytes: 15, sha256: sha('video and music'), ...keep });
    expect(existsSync(download)).toBe(false);
    const path = templateMediaPath(root, id, kept);
    expect(path).toBe(join(root, 'media', id, 'reference.mp4'));
    expect(readFileSync(path, 'utf8')).toBe('video and music');
    expect(unwrap(await media.get(id))).toEqual({ media: kept, path });
    // No temp file is left beside it.
    expect(readdirSync(templateMediaFolder(root, id))).toEqual(['reference.mp4']);

    expect(unwrap(await store.get(id)).summary.media).toEqual(kept);
    expect(
      unwrap(await store.list({ includeUnlisted: false, includeArchived: false, limit: 50 })).items[0]?.media,
    ).toEqual(kept);
    expect(unwrap(await store.setMeta(id, { name: 'Goa sunset' })).media).toEqual(kept);
    expect(media.mediaOf([id, newId<'Template'>()])).toEqual(new Map([[id, kept]]));
  });

  it('copies a person’s file and leaves it as it was; another reel replaces it', async () => {
    const { root, media, id, reel } = await setup();
    const mine = reel('my reel.mov', 'mine');
    const copied = unwrap(await media.keep(id, { ...keep, source: 'file', path: mine, mode: 'copy' }));
    expect(copied).toMatchObject({ file: 'reference.mov', source: 'file', sha256: sha('mine') });
    expect(readFileSync(mine, 'utf8')).toBe('mine');
    const again = unwrap(
      await media.keep(id, {
        ...keep,
        source: 'session',
        path: reel('reference.webm', 'again'),
        mode: 'move',
      }),
    );
    expect(again).toMatchObject({ file: 'reference.webm', source: 'session' });
    expect(readdirSync(templateMediaFolder(root, id))).toEqual(['reference.webm']);
    expect(unwrap(await media.get(id))?.media).toEqual(again);
  });

  it('refuses a template that is gone, a file that is gone and an empty file, keeping nothing', async () => {
    const { root, media, id, reel } = await setup();
    const other = newId<'Template'>();
    const download = reel('reference.mp4', 'x');
    const gone = await media.keep(other, { ...keep, path: download, mode: 'move' });
    expect(!gone.ok && gone.error.code).toBe('core.not_found');
    expect(existsSync(download)).toBe(true);
    const missing = await media.keep(id, { ...keep, path: join(root, 'nope.mp4'), mode: 'copy' });
    expect(!missing.ok && missing.error.code).toBe('core.not_found');
    const empty = await media.keep(id, { ...keep, path: reel('empty.mp4', ''), mode: 'copy' });
    expect(empty.ok).toBe(false);
    expect(unwrap(await media.get(id))).toBeNull();
    expect(readdirSync(templateMediaFolder(root, id))).toEqual([]);
  });

  it('goes with its template: the row at once, the folder at the next prune', async () => {
    const { root, store, media, id, reel } = await setup();
    unwrap(await media.keep(id, { ...keep, path: reel('reference.mp4', 'reel'), mode: 'move' }));
    unwrap(await store.remove(id));
    expect(media.mediaOf([id]).size).toBe(0);
    expect(existsSync(templateMediaFolder(root, id))).toBe(true);
    expect(unwrap(media.prune())).toEqual({ folders: 1, rows: 0 });
    expect(existsSync(templateMediaFolder(root, id))).toBe(false);
  });

  it('prunes a row whose file is gone and stray files, and leaves a keep in progress alone', async () => {
    const { clock, root, store, media, id, reel } = await setup();
    const kept = unwrap(await media.keep(id, { ...keep, path: reel('reference.mp4', 'reel'), mode: 'move' }));
    const folder = templateMediaFolder(root, id);
    writeFileSync(join(folder, '.reference.mp4.abc.tmp'), 'fresh');
    expect(unwrap(media.prune())).toEqual({ folders: 0, rows: 0 });
    expect(readdirSync(folder).sort()).toEqual(['.reference.mp4.abc.tmp', 'reference.mp4']);

    // A second template whose keep has its file but not yet its row.
    const second = template();
    unwrap(await store.create(second, { name: 'Delhi', projectId: null, listed: true }));
    const halfway = templateMediaFolder(root, second.id);
    mkdirSync(halfway, { recursive: true });
    writeFileSync(join(halfway, 'reference.mp4'), 'arriving');
    rmSync(templateMediaPath(root, id, kept));
    expect(unwrap(await media.get(id))).toBeNull();
    clock.advance(1000);
    expect(unwrap(media.prune())).toEqual({ folders: 0, rows: 1 });
    expect(unwrap(await store.get(id)).summary.media).toBeNull();
    expect(existsSync(join(halfway, 'reference.mp4'))).toBe(true);
  });

  it('removes a template’s media on request, and names the file by what came', async () => {
    const { root, media, id, reel } = await setup();
    unwrap(await media.keep(id, { ...keep, path: reel('reference.mp4', 'reel'), mode: 'move' }));
    unwrap(await media.remove(id));
    expect(unwrap(await media.get(id))).toBeNull();
    expect(existsSync(templateMediaFolder(root, id))).toBe(false);
    unwrap(await media.remove(id));
    expect(keptFileName('/a/b/reference.WEBM')).toBe('reference.webm');
    expect(keptFileName('/a/b/reference')).toBe('reference.mp4');
    expect(keptFileName('/a/b/reference.mp4;rm')).toBe('reference.mp4');
  });
});
