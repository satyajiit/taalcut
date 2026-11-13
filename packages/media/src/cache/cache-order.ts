// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Which files an eviction takes first (media SPEC "Cap", ADR 0001 "Cache caps"). */
import { hashFromKey } from './layout';

export interface CacheEntry {
  readonly key: string;
  bytes: number;
  /** Last written or read (ms): this process's puts and touches, and the file's mtime as the disk last showed it. */
  mtime: number;
  /** The put that wrote it (0: found on disk). A rescan that started before it leaves it alone. */
  readonly seq: number;
}

/** At most this many files a run (the `media.derivedEvicted` payload's limit). */
export const EVICT_LIMIT = 1000;

/**
 * (1) conformed files; (2) proxies and waveforms; (3) thumbnails, stills, filmstrips and the rest; (4) anything of an
 * original that is offline, missing or an iCloud placeholder (its last proxy goes only after every online one).
 */
export function tierOf(key: string, offline: boolean): number {
  if (offline) return 4;
  if (key.startsWith('conformed/')) return 1;
  if (key.startsWith('proxies/') || key.startsWith('waveforms/')) return 2;
  return 3;
}

/** Tier first, then least recently used. */
export function evictionOrder(entries: Iterable<CacheEntry>, offlineHashes: readonly string[]): CacheEntry[] {
  const offline = new Set(offlineHashes);
  const tier = (entry: CacheEntry) => {
    const hash = hashFromKey(entry.key);
    return tierOf(entry.key, hash !== undefined && offline.has(hash));
  };
  return [...entries]
    .map((entry) => ({ entry, tier: tier(entry) }))
    .sort((a, b) => a.tier - b.tier || a.entry.mtime - b.entry.mtime)
    .map(({ entry }) => entry);
}
