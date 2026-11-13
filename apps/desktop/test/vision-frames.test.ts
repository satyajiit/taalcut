// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-D2 in the jobs process: the frame cache starts empty (a previous
 * process's frames are cleared before the first job), and an asset's frames
 * go when its indexing completes, not at an earlier milestone.
 */
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventBus, newId, systemClock } from '@taalcut/core';
import { frameCacheRoot } from '../src/shared/media-cache';
import { indexFrameCache } from '../src/utility/roots/vision-frames';

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('indexFrameCache', () => {
  it('clears what a previous process left and drops an asset when its indexing completes', async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-vision-frames-'));
    const root = frameCacheRoot(dir);
    await mkdir(join(root, 'left-over'), { recursive: true });
    await writeFile(join(root, 'left-over', 'frames.bin'), Buffer.alloc(16));
    const bus = createEventBus({ clock: systemClock });

    const frames = indexFrameCache(dir, bus);
    await frames.ready;
    expect(await readdir(root)).toEqual([]);

    const asset = newId<'Asset'>();
    const held = await frames.cache.open(asset);
    if (!held.ok) throw new Error(held.error.code);
    held.value.expect(['vision.analyse']);
    await held.value.close();
    expect(frames.cache.usage().assets).toBe(1);

    bus.emit('library.indexMilestone', { milestone: 'searchable', assetIds: [asset] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(frames.cache.usage().assets).toBe(1);

    bus.emit('library.indexMilestone', { milestone: 'complete', assetIds: [asset] });
    await vi.waitFor(() => expect(frames.cache.usage().assets).toBe(0));
    await vi.waitFor(async () => expect(await readdir(root)).toEqual([]));
  });
});
