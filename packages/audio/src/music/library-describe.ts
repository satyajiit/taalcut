// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `music.findLibraryTrack`'s `describe` (EAR1-B3): the music pack's tracks that pass the tempo, mood and length
 * filters, and the user's own music in the library, ranked by how they sound against a description ("calm lo-fi
 * with soft piano"): earshot's calibrated CLAP match and the track's name (listen/search), each track embedded once
 * in the jobs process and kept in the derived cache. Every track also gets its best three genre and mood terms:
 * hints (earshot judges genre and mood unreliable), never verdicts.
 */
import { ok, type AssetId, type AsyncResult, type ListenVerdict } from '@taalcut/core';
import { fileContentHash } from '../listen/analysis/cache';
import type { EmbeddableSound } from '../listen/search/embedding-cache';
import type { SoundSearcher } from '../listen/search/sound-search';
import { LIBRARY_SEARCH, tempoDistance, type LibraryQuery } from './library-service';
import type { MusicPackTrack } from './library-catalogue';

/** A music file of the user's in the library (the desktop decides which assets count). */
export interface LibraryMusic {
  readonly assetId: AssetId;
  readonly title: string;
  readonly path: string;
  readonly contentHash: string;
  readonly seconds?: number;
  readonly bpm?: number;
}

export interface MusicDescribeDeps {
  readonly searcher: SoundSearcher;
  /** The user's music; absent or failing: the pack only. */
  readonly library?: (signal: AbortSignal) => AsyncResult<readonly LibraryMusic[]>;
}

export interface DescribedTrack {
  readonly source: 'pack' | 'library';
  readonly track?: MusicPackTrack;
  readonly music?: LibraryMusic;
  readonly z: number;
  readonly verdict: ListenVerdict | null;
  readonly borderline: boolean;
  /** Up to 3 terms each, best first: hints. */
  readonly hints: { readonly genre: readonly string[]; readonly mood: readonly string[] };
}

/** The library's music that passes the query's tempo and length filters (moods filter the pack; CLAP ranks user music). */
export function libraryMusicFor(music: readonly LibraryMusic[], query: LibraryQuery): LibraryMusic[] {
  return music.filter((m) => {
    if (query.minSeconds !== undefined && (m.seconds === undefined || m.seconds < query.minSeconds))
      return false;
    if (query.bpm !== undefined && (m.bpm === undefined || tempoDistance(m.bpm, query.bpm) === null))
      return false;
    return true;
  });
}

export async function describeTracks(
  deps: MusicDescribeDeps,
  pack: ReadonlyArray<{ readonly track: MusicPackTrack; readonly path: string }>,
  query: LibraryQuery,
  describe: string,
  signal: AbortSignal,
): AsyncResult<DescribedTrack[]> {
  const library = deps.library ? await deps.library(signal) : undefined;
  const music = library?.ok ? libraryMusicFor(library.value, query) : [];
  const byId = new Map<string, Pick<DescribedTrack, 'source' | 'track' | 'music'>>();
  const sounds: EmbeddableSound[] = [];
  for (const { track, path } of pack) {
    // EAR1-R2: keyed by the file's sha256 (as the SFX pack's sounds are), so a new pack version with a changed
    // file is embedded again; a track whose file can't be read is left out.
    const content = await fileContentHash(path, signal);
    if (!content.ok) continue;
    const id = `pack:${track.id}`;
    byId.set(id, { source: 'pack', track });
    sounds.push({ id, path, content: content.value, name: track.title });
  }
  for (const m of music) {
    const id = `asset:${m.assetId}`;
    byId.set(id, { source: 'library', music: m });
    sounds.push({ id, path: m.path, content: m.contentHash, name: m.title });
  }
  if (sounds.length === 0) return ok([]);
  const found = await deps.searcher.search({
    query: describe,
    top: LIBRARY_SEARCH.maxResults,
    sounds,
    hints: ['music_genre', 'music_mood'],
    signal,
  });
  if (!found.ok) return found;
  const out: DescribedTrack[] = [];
  for (const hit of found.value.hits) {
    const known = byId.get(hit.id);
    if (!known) continue;
    out.push({
      ...known,
      z: hit.z,
      verdict: hit.verdict,
      borderline: hit.borderline,
      hints: {
        genre: (hit.hints?.music_genre ?? []).map((h) => h.term),
        mood: (hit.hints?.music_mood ?? []).map((h) => h.term),
      },
    });
  }
  return ok(out);
}
