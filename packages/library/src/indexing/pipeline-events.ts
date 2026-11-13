// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the indexing pipeline tells the rest of the app: `library.indexing` with the status, only when it changed
 * and at most twice a second (a trailing one catches up), and `library.changed` for the assets whose stage results
 * were stored (facts, pictures, shots, speech) or whose files the media cache let go, so the Library refreshes them
 * in place: batched, at most one event a second.
 */
import type { EventBus, IndexingStatus } from '@taalcut/core';

const EVENT_GAP_MS = 500;
/** Assets whose results were stored are announced at most this often. */
const CHANGED_GAP_MS = 1000;
/** Ids per `library.changed` event. */
const CHANGED_BATCH = 1000;

export interface PipelineEventsDeps {
  readonly events: EventBus;
  readonly status: () => IndexingStatus;
  readonly now: () => number;
  /** Runs the trailing status event as one of the pipeline's steps, so it never interleaves with one. */
  readonly later: (publish: () => void) => void;
}

export interface PipelineEvents {
  /** `library.indexing` with the status now, unless it is unchanged; held back to the gap, not dropped. */
  publish(): void;
  /** What the Library shows of this asset changed: it goes out with the next `library.changed`. */
  changed(assetId: string): void;
  /** Drops the pending timers (the pipeline stopped). */
  stop(): void;
}

export function createPipelineEvents(deps: PipelineEventsDeps): PipelineEvents {
  const { events, now } = deps;
  let lastSent = '';
  let lastSentAt = -Infinity;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  function publish(): void {
    const wait = lastSentAt + EVENT_GAP_MS - now();
    if (wait > 0) {
      trailing ??= setTimeout(() => {
        trailing = undefined;
        deps.later(publish);
      }, wait);
      return;
    }
    const current = deps.status();
    const fingerprint = JSON.stringify({
      ...current,
      updatedAt: 0,
      sources: current.sources.map((s) => ({ ...s, updatedAt: 0 })),
    });
    if (fingerprint === lastSent) return;
    lastSent = fingerprint;
    lastSentAt = now();
    events.emit('library.indexing', current);
  }

  const changed = new Set<string>();
  let changedTimer: ReturnType<typeof setTimeout> | undefined;
  function flushChanged(): void {
    changedTimer = undefined;
    const ids = [...changed];
    changed.clear();
    for (let i = 0; i < ids.length; i += CHANGED_BATCH)
      events.emit('library.changed', {
        projectId: null,
        entity: 'asset',
        change: 'updated',
        ids: ids.slice(i, i + CHANGED_BATCH),
      });
  }

  return {
    publish,
    changed(assetId) {
      changed.add(assetId);
      changedTimer ??= setTimeout(flushChanged, CHANGED_GAP_MS);
    },
    stop() {
      if (trailing) clearTimeout(trailing);
      if (changedTimer) clearTimeout(changedTimer);
      trailing = changedTimer = undefined;
    },
  };
}
