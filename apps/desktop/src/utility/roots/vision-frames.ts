// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs process's per-asset frame cache (IX-D2): vision's indexing jobs
 * read each asset's video once and share the frames. Whatever a previous
 * jobs process left is no one's any more, so the cache is cleared at start
 * (nothing reads frames before the first job, which waits for `ready`);
 * entries nobody used for the idle time are swept every minute, and an
 * asset's entry goes when its indexing completes.
 */
import type { EventBus } from '@taalcut/core';
import { createFrameCache, type FrameCache } from '@taalcut/media';
import { frameCacheRoot } from '../../shared/media-cache';

/** How often the frame cache drops entries nobody used for its idle time. */
const FRAME_SWEEP_MS = 60_000;

export function indexFrameCache(
  userData: string,
  events: EventBus,
): { readonly cache: FrameCache; readonly ready: Promise<void> } {
  const cache = createFrameCache({ root: frameCacheRoot(userData) });
  const ready = cache.clear();
  setInterval(() => void cache.sweepIdle(), FRAME_SWEEP_MS).unref();
  events.on('library.indexMilestone', (event) => {
    if (event.payload.milestone !== 'complete') return;
    for (const assetId of event.payload.assetIds) void cache.drop(assetId);
  });
  return { cache, ready };
}
