// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the clip page's playhead is, in milliseconds from the clip's start, held outside React. The video moves
 * it every frame while it plays; only what draws the playhead (its line, the timecode, the played part of the
 * sound) reads it every frame. Everything else reads a value worked out from it (the shot, the line being said)
 * and re-renders only when that value changes.
 */
import { useCallback, useSyncExternalStore } from 'react';

export interface ClipClock {
  get(): number;
  set(at: number): void;
  subscribe(listener: () => void): () => void;
}

export function createClipClock(start = 0): ClipClock {
  let at = start;
  const listeners = new Set<() => void>();
  return {
    get: () => at,
    set(next) {
      if (next === at) return;
      at = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The playhead, every frame: for what draws it. */
export function useClockTime(clock: ClipClock): number {
  return useSyncExternalStore(clock.subscribe, clock.get, clock.get);
}

/**
 * Something worked out from the playhead (the shot it is in, the line being said): the component re-renders only
 * when it changes. `select` must return a primitive or a stable object for the same input.
 */
export function useClockValue<T>(clock: ClipClock, select: (at: number) => T): T {
  const read = useCallback(() => select(clock.get()), [clock, select]);
  return useSyncExternalStore(clock.subscribe, read, read);
}
