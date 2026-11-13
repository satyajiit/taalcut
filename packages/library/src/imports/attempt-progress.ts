// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ImportItemOutcome, ImportProgress, ImportSession, PublicError, SourceId } from '@taalcut/core';
import type { PreparedImportItem } from './adapter';
import { finishedImportItem, importCounts } from './selection';
import type { ImportStore } from './store';

const INTERVAL = 250;
const countKey = (state: ImportItemOutcome['state']) =>
  state === 'imported'
    ? 'completedItems'
    : state === 'failed'
      ? 'failedItems'
      : state === 'duplicate'
        ? 'skippedItems'
        : state === 'archived'
          ? 'archivedItems'
          : null;

/** One receipt read per attempt. Routine ticks stay in memory until the next bounded persistence flush. */
export function createAttemptProgress(
  store: ImportStore,
  session: ImportSession,
  items: readonly PreparedImportItem[],
  changed: (immediate?: boolean) => void,
  now: () => number,
  signal: AbortSignal,
) {
  const initial = store.outcomes(session.id);
  const outcomes = new Map(initial.map((item) => [item.itemId, item]));
  const allowed = new Map(items.map((item, ordinal) => [item.item.id, ordinal]));
  const counts = importCounts(initial);
  const pending = new Map<string, ImportItemOutcome>();
  let bytes = initial.reduce((sum, item) => sum + item.receivedBytes, 0);
  let patch: Partial<ImportProgress> = {};
  let sourceId: SourceId | undefined;
  let currentFile = session.progress.currentFile;
  let lastFlush = now();
  let sample = { at: lastFlush, bytes: session.progress.receivedBytes };
  let timer: ReturnType<typeof setTimeout> | undefined;

  function update(outcome: ImportItemOutcome) {
    const previous = outcomes.get(outcome.itemId);
    const before = previous ? countKey(previous.state) : null;
    const after = countKey(outcome.state);
    if (before) counts[before]--;
    if (after) counts[after]++;
    bytes += outcome.receivedBytes - (previous?.receivedBytes ?? 0);
    outcomes.set(outcome.itemId, outcome);
    pending.set(outcome.itemId, outcome);
    if (outcome.result?.kind === 'asset') sourceId = outcome.result.sourceId;
    return previous;
  }
  function flush(immediate = false) {
    clearTimeout(timer);
    timer = undefined;
    if (!pending.size && !Object.keys(patch).length && sourceId === undefined) return;
    const current = store.session(session.id);
    if (!current) return;
    const at = now();
    const progress = {
      ...current.progress,
      ...patch,
      ...counts,
      receivedBytes: Math.max(current.progress.receivedBytes, bytes, patch.receivedBytes ?? 0),
    };
    const elapsed = at - sample.at;
    if (elapsed >= INTERVAL) {
      if (patch.bytesPerSecond === undefined) {
        const rate = Math.max(0, ((progress.receivedBytes - sample.bytes) * 1000) / elapsed);
        progress.bytesPerSecond = rate;
        if (patch.etaSeconds === undefined)
          progress.etaSeconds =
            progress.totalBytes !== null && rate > 0
              ? Math.max(0, progress.totalBytes - progress.receivedBytes) / rate
              : null;
      }
      sample = { at, bytes: progress.receivedBytes };
    }
    store.transaction(() => {
      for (const outcome of pending.values())
        store.putOutcome(session.id, outcome, allowed.get(outcome.itemId)!);
      store.saveSession({
        ...current,
        updatedAt: at,
        progress,
        ...(sourceId === undefined ? {} : { sourceId }),
      });
    });
    pending.clear();
    patch = {};
    sourceId = undefined;
    lastFlush = at;
    changed(immediate);
  }
  function schedule(immediate: boolean) {
    const elapsed = now() - lastFlush;
    if (immediate || elapsed >= INTERVAL) flush(immediate);
    else if (!timer)
      timer = setTimeout(() => {
        // Keep dirty receipts for the next tick or the mandatory final flush if a transient write fails.
        try {
          flush();
        } catch {
          timer = undefined;
        }
      }, INTERVAL - elapsed);
  }
  return {
    outcomes,
    counts,
    flush,
    report(outcome: ImportItemOutcome) {
      if (!allowed.has(outcome.itemId)) return;
      const previous = update(outcome);
      schedule(
        previous?.state !== outcome.state ||
          finishedImportItem(outcome) ||
          outcome.state === 'failed' ||
          outcome.state === 'cancelled',
      );
    },
    progress(value: Partial<ImportProgress>) {
      if (signal.aborted) return;
      const fileChanged = value.currentFile !== undefined && value.currentFile !== currentFile;
      if (value.currentFile !== undefined) currentFile = value.currentFile;
      patch = { ...patch, ...value };
      schedule(fileChanged);
    },
    source(value: SourceId) {
      sourceId = value;
      flush(true);
    },
    failRemaining(error: PublicError) {
      for (const item of outcomes.values())
        if (allowed.has(item.itemId) && !finishedImportItem(item) && !(item.state === 'failed' && item.error))
          update({ ...item, state: 'failed', error });
      flush(true);
    },
  };
}
