// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where derived files live: the OS's cache folder, not next to the catalog (ADR 0001). macOS: ~/Library/Caches,
 * which Time Machine already skips; Linux: $XDG_CACHE_HOME (~/.cache). Each OS's rule is its platform services'
 * mediaCacheRoot (platform/cache-roots.ts), read here without the rest of the services, so every process (and the
 * e2e project, which type-checks shared/) can load this module. A test userData directory is under neither, so the
 * cache stays inside it and never touches the developer's own caches.
 */
import { MEDIA_CACHE_ROOTS } from '../platform/cache-roots';
import { hostPlatformName } from '../platform/names';

/** What this module needs of the platform services (PlatformServices.mediaCacheRoot). */
export interface MediaCachePlatform {
  mediaCacheRoot(userData: string): string;
}

const HOST: MediaCachePlatform = { mediaCacheRoot: MEDIA_CACHE_ROOTS[hostPlatformName()] };

export function mediaCacheRoot(userData: string, platform: MediaCachePlatform = HOST): string {
  return platform.mediaCacheRoot(userData);
}

/**
 * The jobs process's per-asset frame cache (media's createFrameCache): decoded frames one indexing stage
 * leaves for the next, beside the derived files, never inside them. Cleared at every start.
 */
export function frameCacheRoot(userData: string, platform: MediaCachePlatform = HOST): string {
  return `${mediaCacheRoot(userData, platform)}-frames`;
}
