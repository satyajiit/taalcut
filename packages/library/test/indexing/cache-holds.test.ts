// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2 rounds 3 and 4: what the media cache asks before it evicts. The files of a clip a window shows stay until main
 * says the page closed (the open clips are a setting main writes, read at each ask), so do an asset's while a stage
 * of it is fed, queued or running; any other file's row goes the moment the cache asks. A stage about to read a file
 * that was let go has it made again first. Offline originals are named.
 */
import { newId, unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createCacheHolds,
  createRepositories,
  FILE_EVICTED,
  offlineContentHashes,
  OPEN_CLIPS_MAX,
  OPEN_CLIPS_SETTING,
  openClips,
  reindexAssets,
  saveOpenClips,
} from '../../src/index';
import { openTestDb } from '../helpers';
import { hashOf, proxyOf, setup, spriteOf } from './eviction-harness';
import { addAssets } from './harness';

const DAY = 24 * 60 * 60_000;

describe('what the media cache may evict', () => {
  it('keeps the files of a clip a window shows until its page closes, and lets any other go at once', async () => {
    const t = await setup();
    const [clip, other] = addAssets(t.db, ['video', 'video']).assets as [AssetId, AssetId];
    await t.run();
    unwrap(saveOpenClips(t.db, [clip])); // main: a window shows the clip
    const files = createRepositories(t.db).derivedFiles;

    expect(t.pipeline.release(proxyOf(hashOf(t.db, clip)).key)).toBe(false);
    expect(files.hasKey(proxyOf(hashOf(t.db, clip)).key)).toBe(true);
    expect(t.pipeline.release(proxyOf(hashOf(t.db, other)).key)).toBe(true);
    expect(files.hasKey(proxyOf(hashOf(t.db, other)).key)).toBe(false);
    expect(t.rows.get(other, 'media.proxy')).toMatchObject({ state: 'done', reasonKey: FILE_EVICTED });
    await vi.waitFor(() => expect(t.changed).toContain(other), { timeout: 3000 });
    // A key the library doesn't know (another process's file) is nobody's.
    expect(t.pipeline.release(`subjects/ab/${'ab'.repeat(32)}.v1.json`)).toBe(true);

    // Open all day, nothing renewed: still held. Closed: let go at the next ask.
    t.clock.advance(DAY);
    expect(t.pipeline.release(spriteOf(hashOf(t.db, clip)).key)).toBe(false);
    unwrap(saveOpenClips(t.db, []));
    expect(t.pipeline.release(spriteOf(hashOf(t.db, clip)).key)).toBe(true);
  });

  it('holds nothing for asking a clip first, and everything while the open clips can’t be read', async () => {
    const t = await setup();
    const [clip, other] = addAssets(t.db, ['video', 'video']).assets as [AssetId, AssetId];
    await t.run();
    // The clip page asks while its clip is indexed or a file was let go: that boosts, it doesn't hold.
    unwrap(await t.pipeline.prioritise([clip]));
    expect(t.pipeline.release(proxyOf(hashOf(t.db, clip)).key)).toBe(true);
    expect(unwrap(openClips(t.db))).toEqual(new Set());

    unwrap(createRepositories(t.db).settings.set(OPEN_CLIPS_SETTING.key, ['not a clip']));
    expect(openClips(t.db).ok).toBe(false);
    expect(t.pipeline.release(proxyOf(hashOf(t.db, other)).key)).toBe(false);
    // Main's next write heals it (a clip two windows show is listed once); a list too long to be one is refused.
    unwrap(saveOpenClips(t.db, [clip, clip]));
    expect(unwrap(openClips(t.db))).toEqual(new Set([clip]));
    expect(t.pipeline.release(proxyOf(hashOf(t.db, other)).key)).toBe(true);
    const many = Array.from({ length: OPEN_CLIPS_MAX + 1 }, () => newId<'Asset'>());
    expect(saveOpenClips(t.db, many)).toMatchObject({ ok: false, error: { code: 'core.validation' } });
    expect(unwrap(openClips(t.db))).toEqual(new Set([clip]));
  });

  it('keeps an asset’s files while one of its stages is queued or running, or being fed', async () => {
    const t = await setup({ reads: true });
    const [clip] = addAssets(t.db, ['video']).assets as [AssetId];
    await t.run();
    const proxy = proxyOf(hashOf(t.db, clip)).key;
    unwrap(reindexAssets(t.db, [clip], ['media.filmstrip'])); // Analyse again
    await t.pipeline.tick();
    expect(t.rows.get(clip, 'media.filmstrip')?.state).toBe('queued');
    expect(t.pipeline.release(proxy)).toBe(false);
    await t.run();
    expect(t.pipeline.release(proxy)).toBe(true);

    const holds = createCacheHolds(t.db);
    expect(await holds.feeding(clip, () => Promise.resolve(holds.holds(clip)))).toBe(true);
    expect(holds.holds(clip)).toBe(false);
  });

  it('makes a let-go file again before a stage that reads it runs', async () => {
    const t = await setup({ reads: true });
    const [clip] = addAssets(t.db, ['video']).assets as [AssetId];
    await t.run();
    expect(t.pipeline.release(proxyOf(hashOf(t.db, clip)).key)).toBe(true);
    // The filmstrip waits to run again (analysed again, or not yet fed when its proxy went).
    unwrap(reindexAssets(t.db, [clip], ['media.filmstrip']));
    const ran = t.queue.ran.length;
    await t.run();
    expect(t.queue.ran.slice(ran)).toEqual([`test.proxy ${clip}`, `test.filmstrip ${clip}`]);
    expect(t.rows.get(clip, 'media.proxy')).toMatchObject({ state: 'done', reasonKey: null });
    expect(createRepositories(t.db).derivedFiles.hasKey(proxyOf(hashOf(t.db, clip)).key)).toBe(true);
  });

  it('names the content of originals that aren’t online', () => {
    const db = openTestDb({ file: false });
    const assets = createRepositories(db).assets;
    const [online] = addAssets(db, ['video']).assets as [AssetId];
    const [offline] = addAssets(db, ['video'], { sourceName: 'Drive', state: 'offline' }).assets as [AssetId];
    unwrap(assets.setContentHash(online, 'a'.repeat(64)));
    unwrap(assets.setContentHash(offline, 'b'.repeat(64)));
    expect(offlineContentHashes(db)).toEqual(['b'.repeat(64)]);
  });
});
