// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A per-isolate cache. Workers reuse an isolate across requests, so the worker's composition root (index.ts) makes
 * one of each and hands it to the routes; a new isolate starts empty. Nothing here is written to D1.
 */
export interface ExpiringCache<V> {
  /** The value while it is fresh. */
  get(key: string, now: number): V | undefined;
  /** The last value stored, fresh or not: what a failed refresh may fall back to. */
  last(key: string): V | undefined;
  set(key: string, value: V, expiresAtMs: number): void;
  delete(key: string): void;
}

/** Holds at most `maxEntries`; the oldest entry goes first. */
export function createExpiringCache<V>(maxEntries = 1000): ExpiringCache<V> {
  const entries = new Map<string, { value: V; expiresAtMs: number }>();
  return {
    get(key, now) {
      const entry = entries.get(key);
      return entry && now < entry.expiresAtMs ? entry.value : undefined;
    },
    last: (key) => entries.get(key)?.value,
    set(key, value, expiresAtMs) {
      entries.delete(key);
      entries.set(key, { value, expiresAtMs });
      for (const oldest of entries.keys()) {
        if (entries.size <= maxEntries) break;
        entries.delete(oldest);
      }
    },
    delete: (key) => {
      entries.delete(key);
    },
  };
}
