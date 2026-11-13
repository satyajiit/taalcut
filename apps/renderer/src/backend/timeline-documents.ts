// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { fromRpcError, UnknownError, type TaalcutError, type Timeline, type TimelineId } from '@taalcut/core';
import type { Backend } from './contract';
import type { Loadable } from './use-rpc';

export interface TimelineDocument {
  snapshot(): Loadable<Timeline>;
  subscribe(changed: () => void): () => void;
  reload(): void;
}

/** One subscription per document, owned by the backend provider, shared by the editor and its cards. */
export function createTimelineDocuments(backend: Pick<Backend, 'timelines'>) {
  const documents = new Map<TimelineId, TimelineDocument>();
  return {
    get(id: TimelineId): TimelineDocument {
      let document = documents.get(id);
      if (!document) {
        document = createDocument(backend, id);
        documents.set(id, document);
      }
      return document;
    },
  };
}

export type TimelineDocuments = ReturnType<typeof createTimelineDocuments>;

/** Callback adapter for cards and lists; consumers share exactly the same document as React hooks. */
export function followTimelineDocument(
  document: TimelineDocument,
  onChange: (timeline: Timeline) => void,
  onError: (error: TaalcutError) => void,
): () => void {
  const changed = () => {
    const state = document.snapshot();
    if (state.status === 'error') onError(state.error);
    else if (state.data) onChange(state.data);
  };
  const stop = document.subscribe(changed);
  changed();
  return stop;
}

function createDocument(backend: Pick<Backend, 'timelines'>, id: TimelineId): TimelineDocument {
  let state: Loadable<Timeline> = { status: 'loading' };
  const listeners = new Set<() => void>();
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  const publish = (next: Loadable<Timeline>) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const stop = () => {
    controller?.abort();
    controller = undefined;
    clearTimeout(timer);
    timer = undefined;
  };

  async function follow(current: AbortController) {
    try {
      const stream = await backend.timelines.watch({ timelineId: id }, { signal: current.signal });
      for await (const data of stream) {
        if (current.signal.aborted) return;
        // Reconnects can replay the last revision; an older response must never rewind the document.
        if (data.id !== id || (state.data && data.revision < state.data.revision)) continue;
        failures = 0;
        if (state.status !== 'ready' || state.data.revision !== data.revision)
          publish({ status: 'ready', data });
      }
      if (current.signal.aborted) return;
      throw UnknownError(undefined, { detail: 'timeline_stream_ended' });
    } catch (cause) {
      if (current.signal.aborted) return;
      const error = fromRpcError(cause);
      publish({ status: 'error', ...(state.data ? { data: state.data } : {}), stale: true, error });
      // A deleted document needs a new choice, not an endless reconnect loop.
      if (error.code.endsWith('not_found') || !listeners.size) return;
      const delay = Math.min(5_000, 250 * 2 ** Math.min(failures++, 5));
      timer = setTimeout(start, delay);
    }
  }

  function start() {
    stop();
    if (!listeners.size) return;
    controller = new AbortController();
    void follow(controller);
  }

  return {
    snapshot: () => state,
    subscribe(changed) {
      listeners.add(changed);
      if (listeners.size === 1) {
        if (state.data) state = { status: 'loading', data: state.data, stale: true };
        start();
      }
      return () => {
        listeners.delete(changed);
        if (!listeners.size) {
          stop();
          // Documents without consumers need no retained footage or arrays in memory.
          state = { status: 'loading' };
          failures = 0;
        }
      };
    },
    reload() {
      failures = 0;
      publish({ status: 'loading', ...(state.data ? { data: state.data, stale: true } : {}) });
      start();
    },
  };
}
