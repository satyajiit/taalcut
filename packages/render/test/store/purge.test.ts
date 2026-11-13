// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** render.purge: the conform cache back under its cap (LRU), stale folders and week-old deleted renders. */
import { mkdir, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, type ProjectId } from '@taalcut/core';
import {
  planRenderPurge,
  purgeDeletedRenders,
  purgeRenderCache,
  type PurgeEntry,
} from '../../src/store/purge';
import { renderRow } from '../commands/support';
import { tempDir } from '../support/media';
import { memoryRenderStore } from '../support/render-store';

const HOUR = 3_600_000;
const entry = (name: string, bytes: number, mtimeMs: number): PurgeEntry => ({
  path: `/x/${name}`,
  name,
  bytes,
  mtimeMs,
});

describe('planRenderPurge', () => {
  it('drops least recently used segments, a clip’s files together, until under the cap', () => {
    const plan = planRenderPurge(
      {
        conform: [
          entry('aaa.mp4', 40, 1_000),
          entry('aaa.wav', 10, 5_000),
          entry('bbb.mp4', 30, 2_000),
          entry('ccc.mp4', 30, 9_000),
        ],
        work: [],
        preview: [],
      },
      { now: 10_000, conformMaxBytes: 70 },
    );
    // aaa was used at 5 000 (its wav), so bbb (2 000) goes first, then aaa.
    expect(plan.remove).toEqual(['/x/bbb.mp4', '/x/aaa.mp4', '/x/aaa.wav']);
    expect(plan.freedBytes).toBe(80);
  });

  it('removes abandoned partial writes, stale work and preview folders, and keeps what it is told to', () => {
    const now = 100 * HOUR;
    const plan = planRenderPurge(
      {
        conform: [entry('k.mp4.part', 5, now - 2 * HOUR), entry('j.mp4.part', 5, now - 60_000)],
        work: [entry('KEEP', 1, 0), entry('OLD', 2, 0), entry('NEW', 3, now - HOUR)],
        preview: [entry('a'.repeat(32), 4, 0), entry('b'.repeat(32), 4, now)],
      },
      { now, keepWork: new Set(['KEEP']) },
    );
    expect(plan.remove).toEqual(['/x/k.mp4.part', '/x/OLD', `/x/${'a'.repeat(32)}`]);
  });
});

describe('purgeRenderCache and purgeDeletedRenders', () => {
  let work: Awaited<ReturnType<typeof tempDir>>;
  beforeEach(async () => {
    work = await tempDir('purge');
  });
  afterEach(() => work.dispose());

  it('carries out the plan on disk', async () => {
    const folders = {
      conform: join(work.dir, 'conform'),
      work: join(work.dir, 'work'),
      preview: join(work.dir, 'preview'),
    };
    await mkdir(folders.conform, { recursive: true });
    await mkdir(join(folders.work, 'stale'), { recursive: true });
    await writeFile(join(folders.work, 'stale', 'final.mp4'), 'x'.repeat(10));
    await writeFile(join(folders.conform, 'old.mp4'), 'x'.repeat(100));
    await writeFile(join(folders.conform, 'new.mp4'), 'x'.repeat(100));
    const old = new Date(Date.now() - 48 * HOUR);
    await utimes(join(folders.conform, 'old.mp4'), old, old);
    await utimes(join(folders.work, 'stale'), old, old);
    const result = await purgeRenderCache(folders, { now: Date.now(), conformMaxBytes: 150 });
    expect(result).toEqual({ removed: 2, freedBytes: 110 });
    expect(await readdir(folders.conform)).toEqual(['new.mp4']);
    expect(await readdir(folders.work)).toEqual([]);
  });

  it('removes files of renders deleted over a week ago and clears their path', async () => {
    const store = memoryRenderStore();
    const project: ProjectId = newId<'Project'>();
    const now = 30 * 24 * HOUR;
    const file = join(work.dir, 'old.mp4');
    await writeFile(file, 'mp4');
    await writeFile(join(work.dir, 'old.srt'), 'srt');
    const old = renderRow({ projectId: project, deletedAt: now - 8 * 24 * HOUR, filePath: file, bytes: 3 });
    const recent = renderRow({
      projectId: project,
      deletedAt: now - HOUR,
      filePath: join(work.dir, 'recent.mp4'),
    });
    store.records.set(old.id, old);
    store.records.set(recent.id, recent);
    const removed = await purgeDeletedRenders(store, { now });
    expect(removed.ok && removed.value).toBe(1);
    expect(
      await stat(file).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect(await readdir(work.dir)).toEqual([]);
    expect(store.records.get(old.id)?.filePath).toBeNull();
    expect(store.records.get(recent.id)?.filePath).not.toBeNull();
  });
});
