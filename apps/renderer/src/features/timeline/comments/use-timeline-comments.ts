// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: a timeline's comments, live (`comments.watch`): one watch per timeline however many parts of the page
 * show them (the dock's Comments, the bed's pins, the viewer's marker, the inspector), opened with the first and
 * closed with the last. A watch that fails keeps what it had beside the error; `retry` opens it again.
 */
import { fromRpcError, type TaalcutError, type TimelineComment, type TimelineId } from '@taalcut/core';
import { useCallback, useSyncExternalStore } from 'react';
import { useBackend } from '../../../backend/backend';
import type { Backend } from '../../../backend/contract';

export interface TimelineComments {
  readonly status: 'loading' | 'ready' | 'error';
  readonly comments: readonly TimelineComment[];
  readonly error?: TaalcutError;
}

const LOADING: TimelineComments = { status: 'loading', comments: [] };
const NONE: TimelineComments = { status: 'ready', comments: [] };

interface Watch {
  state: TimelineComments;
  readonly listeners: Set<() => void>;
  abort: AbortController | null;
}

const watches = new Map<TimelineId, Watch>();

function entry(timelineId: TimelineId): Watch {
  let watch = watches.get(timelineId);
  if (!watch) {
    watch = { state: LOADING, listeners: new Set(), abort: null };
    watches.set(timelineId, watch);
  }
  return watch;
}

function set(watch: Watch, state: TimelineComments) {
  watch.state = state;
  for (const listener of watch.listeners) listener();
}

function open(backend: Backend, timelineId: TimelineId, watch: Watch) {
  const abort = new AbortController();
  watch.abort = abort;
  void (async () => {
    try {
      const stream = await backend.comments.watch({ timelineId }, { signal: abort.signal });
      for await (const comments of stream) {
        if (abort.signal.aborted) return;
        set(watch, { status: 'ready', comments });
      }
    } catch (cause) {
      if (!abort.signal.aborted)
        set(watch, { status: 'error', comments: watch.state.comments, error: fromRpcError(cause) });
    }
  })();
}

export function useTimelineComments(
  timelineId: TimelineId | undefined,
): TimelineComments & { retry(): void } {
  const backend = useBackend();
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!timelineId) return () => {};
      const watch = entry(timelineId);
      watch.listeners.add(listener);
      if (!watch.abort) open(backend, timelineId, watch);
      return () => {
        watch.listeners.delete(listener);
        if (watch.listeners.size > 0) return;
        watch.abort?.abort();
        watches.delete(timelineId);
      };
    },
    [backend, timelineId],
  );
  const state = useSyncExternalStore(subscribe, () =>
    timelineId ? (watches.get(timelineId)?.state ?? LOADING) : NONE,
  );
  const retry = useCallback(() => {
    if (!timelineId) return;
    const watch = entry(timelineId);
    watch.abort?.abort();
    set(watch, { ...LOADING, comments: watch.state.comments });
    open(backend, timelineId, watch);
  }, [backend, timelineId]);
  return { ...state, retry };
}
