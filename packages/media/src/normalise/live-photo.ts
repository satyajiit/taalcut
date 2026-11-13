// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pairs a Live Photo still with its movie. The still is the primary asset.
 * Ambiguous matches stay unpaired: library must not guess which movie.
 */

const MAX_MOVIE_SEC = 3.5;
const MAX_DELTA_MS = 2_000;

export interface LivePhotoCandidate {
  readonly id: string;
  readonly kind: 'still' | 'movie';
  /** File name without the extension, compared case-sensitively. */
  readonly baseName: string;
  readonly contentId?: string;
  /** Source folder or import session. Name-and-time pairing requires the same one. */
  readonly session?: string;
  readonly captureTimeMs?: number;
  /** Known movie length. Longer than 3.5 s is not a Live Photo. */
  readonly durationSec?: number;
}

export interface LivePhotoPair {
  readonly stillId: string;
  readonly movieId: string;
  readonly contentId: string;
  readonly pairedBy: 'content-id' | 'name-and-time';
}

function isShortMovie(item: LivePhotoCandidate): boolean {
  return item.kind === 'movie' && (item.durationSec === undefined || item.durationSec <= MAX_MOVIE_SEC);
}

export function pairLivePhotos(items: readonly LivePhotoCandidate[]): LivePhotoPair[] {
  const used = new Set<string>();
  const pairs: LivePhotoPair[] = [];
  const stills = items.filter((item) => item.kind === 'still');
  const movies = items.filter(isShortMovie);

  const byId = new Map<string, LivePhotoCandidate[]>();
  for (const item of [...stills, ...movies]) {
    if (!item.contentId) continue;
    const group = byId.get(item.contentId) ?? [];
    group.push(item);
    byId.set(item.contentId, group);
  }
  for (const [contentId, group] of byId) {
    const groupStills = group.filter((item) => item.kind === 'still');
    const groupMovies = group.filter((item) => item.kind === 'movie');
    if (groupStills.length !== 1 || groupMovies.length !== 1) continue;
    const still = groupStills[0];
    const movie = groupMovies[0];
    if (!still || !movie) continue;
    pairs.push({ stillId: still.id, movieId: movie.id, contentId, pairedBy: 'content-id' });
    used.add(still.id);
    used.add(movie.id);
  }

  const freeMovies = movies.filter((movie) => !used.has(movie.id));
  for (const still of stills) {
    if (used.has(still.id) || still.captureTimeMs === undefined) continue;
    const matches = freeMovies.filter((movie) => {
      if (movie.baseName !== still.baseName || movie.session !== still.session) return false;
      if (movie.captureTimeMs === undefined) return false;
      return Math.abs(movie.captureTimeMs - still.captureTimeMs!) <= MAX_DELTA_MS;
    });
    if (matches.length !== 1) continue;
    const movie = matches[0];
    if (!movie) continue;
    pairs.push({
      stillId: still.id,
      movieId: movie.id,
      contentId: still.contentId ?? movie.contentId ?? still.baseName,
      pairedBy: 'name-and-time',
    });
    used.add(still.id);
    used.add(movie.id);
  }
  return pairs;
}
