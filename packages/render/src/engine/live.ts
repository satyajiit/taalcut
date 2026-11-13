// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Live state of the exports running in this process: their progress (the
 * store keeps no progress; a window's snapshot gets it from here) and a
 * change signal the renders router's `watch` follows. Progress is published
 * at most 4 times a second per render.
 */
import type { JobProgress, RenderId } from '@taalcut/core';

export interface LiveRenders {
  progress(renderId: RenderId): JobProgress | null;
  /** Sets (or with null clears) a render's progress; throttled to 4/s unless `force`. */
  setProgress(renderId: RenderId, progress: JobProgress | null, force?: boolean): void;
  /** Something about renders changed (progress, or a store write by this process). */
  changed(): void;
  onChange(listener: () => void): () => void;
}

export const PROGRESS_INTERVAL_MS = 250;

export function createLiveRenders(now: () => number = Date.now): LiveRenders {
  const progress = new Map<RenderId, JobProgress>();
  const lastPublished = new Map<RenderId, number>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    progress: (renderId) => progress.get(renderId) ?? null,
    setProgress(renderId, value, force = false) {
      if (value === null) {
        progress.delete(renderId);
        lastPublished.delete(renderId);
        notify();
        return;
      }
      progress.set(renderId, value);
      const at = now();
      const last = lastPublished.get(renderId);
      if (!force && last !== undefined && at - last < PROGRESS_INTERVAL_MS) return;
      lastPublished.set(renderId, at);
      notify();
    },
    changed: notify,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
