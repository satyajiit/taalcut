// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2: files the media cache lets go. When `media.derivedEvicted` names a clip's proxy and filmstrip sprite, their
 * rows go at once (the detail names no missing file), the stages that made them stay done and nothing is made again
 * then; when the clip is opened (`indexing.prioritise`) they are made again first, ahead of other work, and the
 * detail has them back.
 */
import { unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { assetDetail, createRepositories, FILE_EVICTED, indexingStatus } from '../../src/index';
import { hashOf, proxyOf, setup, spriteOf, waveOf } from './eviction-harness';
import { addAssets } from './harness';

describe('files the media cache lets go', () => {
  it('lets a clip’s copy and filmstrip go at once, and makes nothing again until the clip is opened', async () => {
    const t = await setup();
    const { assets } = addAssets(t.db, ['video', 'video']);
    await t.run();
    const [clip, other] = assets as [AssetId, AssetId];
    const before = unwrap(assetDetail(t.db, clip));
    expect(before.playback).toMatchObject({ source: 'proxy' });
    expect(before.filmstrip?.times).toHaveLength(2);
    const hash = hashOf(t.db, clip);
    const ran = t.queue.ran.length;

    t.events.emit('media.derivedEvicted', {
      keys: [proxyOf(hash).key, spriteOf(hash).key],
      freedBytes: 2000,
    });
    await t.pipeline.idle();

    const repos = createRepositories(t.db);
    expect(repos.derivedFiles.hasKey(proxyOf(hash).key)).toBe(false);
    expect(repos.derivedFiles.hasKey(spriteOf(hash).key)).toBe(false);
    expect(repos.derivedFiles.hasKey(waveOf(hash).key)).toBe(true);
    const after = unwrap(assetDetail(t.db, clip));
    expect([after.playback, after.filmstrip]).toEqual([null, null]);
    expect(unwrap(assetDetail(t.db, other)).filmstrip).not.toBeNull();
    // The analysis finished: the stages stay done (the library isn't busy), marked for the next opening.
    expect(t.rows.get(clip, 'media.proxy')).toMatchObject({ state: 'done', reasonKey: FILE_EVICTED });
    expect(t.rows.get(clip, 'media.filmstrip')).toMatchObject({ state: 'done', reasonKey: FILE_EVICTED });
    expect(t.rows.get(clip, 'media.previews')).toMatchObject({ state: 'done', reasonKey: null });
    expect(after.stages.find((s) => s.stage === 'media.proxy')).toMatchObject({ state: 'done' });
    expect(after.stages.find((s) => s.stage === 'media.proxy')).not.toHaveProperty('reasonKey');
    expect(indexingStatus(t.db, { paused: false }).overall).toMatchObject({ done: 2, waiting: 0, active: 0 });
    // The clip's page and cards refresh: the library says the asset changed.
    await vi.waitFor(() => expect(t.changed).toContain(clip), { timeout: 3000 });

    await t.run();
    expect(t.queue.ran.length).toBe(ran);
    // A key the library doesn't know, or one evicted twice, changes nothing.
    expect(unwrap(await t.pipeline.evicted([proxyOf(hash).key]))).toEqual({ assets: 0 });
  });

  it('makes them again when the clip is opened, ahead of other work, and the detail has them back', async () => {
    const t = await setup();
    const { assets } = addAssets(t.db, ['video']);
    await t.run();
    const [clip] = assets as [AssetId];
    const hash = hashOf(t.db, clip);
    unwrap(await t.pipeline.evicted([proxyOf(hash).key, spriteOf(hash).key]));
    // Another folder's clip arrives meanwhile: all its stages wait.
    const { assets: later } = addAssets(t.db, ['video'], { sourceName: 'Later' });
    const ran = t.queue.ran.length;

    unwrap(await t.pipeline.prioritise([clip]));
    expect(t.rows.get(clip, 'media.proxy')).toMatchObject({ reasonKey: null, priority: 1 });
    expect(['waiting', 'queued']).toContain(t.rows.get(clip, 'media.proxy')?.state);
    expect(t.rows.get(clip, 'media.previews')?.state).toBe('done');
    await t.run();

    expect(t.queue.ran.slice(ran, ran + 2)).toEqual([`test.proxy ${clip}`, `test.filmstrip ${clip}`]);
    expect(t.queue.ran.slice(ran)).toContain(`test.hash ${later[0]}`);
    expect(t.queue.ran.slice(ran).filter((run) => run.endsWith(clip))).toHaveLength(2);
    const back = unwrap(assetDetail(t.db, clip));
    expect(back.playback).toMatchObject({ source: 'proxy', file: { key: proxyOf(hash).key } });
    expect(back.filmstrip?.file.key).toBe(spriteOf(hash).key);
    expect(t.rows.get(clip, 'media.proxy')).toMatchObject({ state: 'done', reasonKey: null });
    // Opened again with nothing let go: nothing is made again.
    unwrap(await t.pipeline.prioritise([clip]));
    const settled = t.queue.ran.length;
    await t.run();
    expect(t.queue.ran.length).toBe(settled);
  });
});
