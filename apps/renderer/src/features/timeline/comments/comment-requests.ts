// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: what the editor's comment controls ask of each other across the page. Each is a tick a consumer claims
 * once: "comment on this" (the composer opens), "show this comment" (the dock opens on Comments and points at it),
 * "go to this comment" (the editor puts the playhead on it), and "send these to Taalcut" (the project's chat sends
 * one message with them, once it isn't busy). A request made before its consumer mounts waits for it.
 */
import type { EditTarget, TimelineComment, TimelineCommentId } from '@taalcut/core';
import { useEffect, useRef, useSyncExternalStore } from 'react';

interface Ticked<T> {
  readonly tick: number;
  readonly value: T;
}

export interface TickStore<T> {
  push(value: T): void;
  latest(): Ticked<T> | null;
  /** True once per tick: the first claimer handles it. */
  claim(tick: number): boolean;
  subscribe(listener: () => void): () => void;
}

export function createTickStore<T>(): TickStore<T> {
  let latest: Ticked<T> | null = null;
  let claimed = 0;
  const listeners = new Set<() => void>();
  return {
    push(value) {
      latest = { tick: (latest?.tick ?? 0) + 1, value };
      for (const listener of listeners) listener();
    },
    latest: () => latest,
    claim(tick) {
      if (tick <= claimed) return false;
      claimed = tick;
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Runs `handle` for each new request; `when` false keeps it waiting (a busy chat). */
export function useClaim<T>(store: TickStore<T>, handle: (value: T) => void, when = true): void {
  const latest = useSyncExternalStore(store.subscribe, store.latest);
  const handler = useRef(handle);
  handler.current = handle;
  useEffect(() => {
    if (latest && when && store.claim(latest.tick)) handler.current(latest.value);
  }, [latest, when, store]);
}

/** The latest request, for a consumer that only reads it (which comment the dock points at). */
export function useLatest<T>(store: TickStore<T>): Ticked<T> | null {
  return useSyncExternalStore(store.subscribe, store.latest);
}

export interface CommentOn {
  readonly target: EditTarget;
  /** Frames from the target's start that the comment points at. */
  readonly at?: number;
}

export interface CommentSend {
  readonly ids: readonly TimelineCommentId[];
  readonly text: string;
}

export const commentOnRequests = createTickStore<CommentOn>();
export const showCommentRequests = createTickStore<{ readonly commentId: TimelineCommentId }>();
export const goToCommentRequests = createTickStore<TimelineComment>();
export const commentSendRequests = createTickStore<CommentSend>();

/** Opens the composer for a new comment on `target`. */
export const commentOn = (request: CommentOn): void => commentOnRequests.push(request);
/** Opens the dock on Comments, pointing at one. */
export const showComment = (commentId: TimelineCommentId): void => showCommentRequests.push({ commentId });
/** Puts the editor on a comment's target. */
export const goToComment = (comment: TimelineComment): void => goToCommentRequests.push(comment);
/** Sends comments to Taalcut through the project's chat. */
export const sendComments = (request: CommentSend): void => commentSendRequests.push(request);
