// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * When the hub last said "that was a lot in a short time" (hub.rate_limited) and until when, so the hub's list can
 * say so too, not only the rating, report or share that met it (UX1: the rate-limited state is visible on the
 * list). The window keeps it while it is open; hub.status doesn't carry it yet (specs/core-requests-templates.md).
 * Like share-requests.ts, a small store the pages subscribe to.
 */
import type { TaalcutError } from '@taalcut/core';
import { useEffect, useReducer, useSyncExternalStore } from 'react';

let until: number | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

/** How long the hub asked us to wait, from the error's params; null when it isn't a rate limit. */
export function retryAfterSeconds(error: TaalcutError): number | null {
  if (error.code !== 'hub.rate_limited') return null;
  const seconds = Number(error.params?.retryAfterSeconds);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** Notes a hub refusal: a rate limit holds until its retry time. Other errors pass. */
export function noteHubRefusal(error: TaalcutError, now: number = Date.now()): void {
  const seconds = retryAfterSeconds(error);
  if (seconds === null) return;
  until = Math.max(until ?? 0, now + seconds * 1000);
  emit();
}

/** Forgets the limit (tests, and a new session). */
export function clearHubLimit(): void {
  until = null;
  emit();
}

/** When the hub's limit ends, while it holds; null otherwise. Re-renders when it ends. */
export function useHubLimit(now: () => number = Date.now): number | null {
  const held = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => until,
  );
  const [, ended] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (held === null) return;
    const left = held - now();
    if (left <= 0) return;
    const timer = setTimeout(ended, left);
    return () => clearTimeout(timer);
  }, [held, now]);
  return held !== null && held > now() ? held : null;
}
