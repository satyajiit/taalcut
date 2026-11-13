// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The music pack as a library (SPEC P3.5): `find` searches the bundled CC0 tracks by tempo (±6 %, or half or
 * double that, since a 60 BPM edit cuts on every other beat of a 120 BPM track), mood words and length; `use` adds
 * a track to the library byte for byte (provenance `bundled`: pack, licence, source; the library dedupes by
 * content) and returns `music.choosePath`'s payload for path b (`ownTrack`), so the timeline re-syncs its cuts to
 * the track's beats. An empty or missing pack is `audio.music_library_empty`; no match is an empty list.
 * `candidates` (EAR1-B3) lists every matching track with its file for `music.findLibraryTrack`'s `describe`.
 */
import { readFile } from 'node:fs/promises';
import {
  err,
  ok,
  RationalTime,
  type AssetId,
  type AsyncResult,
  type BeatMap,
  type GeneratedAssetSink,
  type GeneratedMediaType,
  type MusicChoice,
  type Timeline,
} from '@taalcut/core';
import { MILLISECONDS } from '../rates';
import { MusicLibraryEmpty, MusicTrackUnknown } from './errors';
import type { MusicPack, MusicPackTrack } from './library-catalogue';

/** The installed `music-pack` component (desktop resolves its folder). */
export interface MusicPackSource {
  load(): AsyncResult<MusicPack>;
}

export interface MusicLibraryDeps {
  readonly pack: MusicPackSource;
  readonly sink: GeneratedAssetSink;
}

export const LIBRARY_SEARCH = {
  /** A track's tempo within this share of the asked tempo (or of its half or double). */
  tempoTolerance: 0.06,
  maxResults: 10,
} as const;

export interface LibraryQuery {
  readonly bpm?: number;
  /** A track matches when it has any of them; more matches rank first. */
  readonly moods?: readonly string[];
  readonly minSeconds?: number;
}

export interface LibraryChoice {
  /** `music.choosePath`'s payload. */
  readonly payload: {
    readonly projectId: Timeline['projectId'];
    readonly timelineId: Timeline['id'];
    readonly choice: Extract<MusicChoice, { path: 'ownTrack' }>;
  };
  readonly assetId: AssetId;
  readonly track: MusicPackTrack;
  /** The pack's beats for the asset, when it was built with them (the caller may cache them on the asset). */
  readonly beatMap: BeatMap | null;
  /** The library had these bytes already. */
  readonly duplicate: boolean;
}

/** Relative tempo distance to the nearest of `bpm`, its half and its double; null outside the tolerance. */
export function tempoDistance(trackBpm: number, bpm: number): number | null {
  const distance = Math.min(...[bpm, bpm / 2, bpm * 2].map((wanted) => Math.abs(trackBpm - wanted) / wanted));
  return distance <= LIBRARY_SEARCH.tempoTolerance ? distance : null;
}

const MEDIA_TYPES = {
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  wav: 'audio/wav',
} as const satisfies Record<string, GeneratedMediaType>;
type TrackExtension = keyof typeof MEDIA_TYPES;

const isTrackExtension = (extension: string): extension is TrackExtension =>
  Object.hasOwn(MEDIA_TYPES, extension);

/** The file's extension when it is one the pack may hold (MUSIC_TRACK_FILE). */
function extensionOf(file: string): TrackExtension | null {
  const extension = file.slice(file.lastIndexOf('.') + 1);
  return isTrackExtension(extension) ? extension : null;
}

interface Ranked {
  readonly track: MusicPackTrack;
  readonly moods: number;
  readonly tempo: number;
}

/** The tracks matching the query, best first: most mood words, then nearest tempo, then id. */
export function searchTracks(tracks: readonly MusicPackTrack[], query: LibraryQuery): MusicPackTrack[] {
  return matchingTracks(tracks, query).slice(0, LIBRARY_SEARCH.maxResults);
}

/** Every track matching the query, in `searchTracks`' order (EAR1-B3: what a `describe` search ranks). */
export function matchingTracks(tracks: readonly MusicPackTrack[], query: LibraryQuery): MusicPackTrack[] {
  const wanted = new Set((query.moods ?? []).map((m) => m.toLowerCase()));
  const ranked: Ranked[] = [];
  for (const track of tracks) {
    if (query.minSeconds !== undefined && track.seconds < query.minSeconds) continue;
    const tempo = query.bpm === undefined ? 0 : tempoDistance(track.bpm, query.bpm);
    if (tempo === null) continue;
    const moods = track.moods.filter((m) => wanted.has(m)).length;
    if (wanted.size > 0 && moods === 0) continue;
    ranked.push({ track, moods, tempo });
  }
  ranked.sort((a, b) => b.moods - a.moods || a.tempo - b.tempo || a.track.id.localeCompare(b.track.id));
  return ranked.map((r) => r.track);
}

export function createMusicLibrary(deps: MusicLibraryDeps) {
  return {
    async find(query: LibraryQuery): AsyncResult<MusicPackTrack[]> {
      const pack = await deps.pack.load();
      if (!pack.ok) return pack;
      return ok(searchTracks(pack.value.tracks, query));
    },

    /** EAR1-B3: every pack track matching the filters, with its file, for a `describe` search to rank. */
    async candidates(
      query: LibraryQuery,
    ): AsyncResult<Array<{ readonly track: MusicPackTrack; readonly path: string }>> {
      const pack = await deps.pack.load();
      if (!pack.ok) return pack;
      return ok(
        matchingTracks(pack.value.tracks, query).map((track) => ({ track, path: pack.value.pathOf(track) })),
      );
    },

    async use(request: {
      readonly timeline: Timeline;
      readonly trackId: string;
      readonly gainDb?: number;
      readonly signal?: AbortSignal;
    }): AsyncResult<LibraryChoice> {
      const pack = await deps.pack.load();
      if (!pack.ok) return pack;
      const track = pack.value.tracks.find((t) => t.id === request.trackId);
      if (!track) return err(MusicTrackUnknown({ trackId: request.trackId }));
      let bytes: Buffer;
      try {
        bytes = await readFile(pack.value.pathOf(track));
      } catch {
        return err(MusicLibraryEmpty(undefined, { detail: `the music pack has no ${track.file}` }));
      }
      const extension = extensionOf(track.file);
      if (!extension)
        return err(MusicLibraryEmpty(undefined, { detail: `${track.file} is not a track file` }));
      const stored = await deps.sink.put(
        {
          bytes,
          mediaType: MEDIA_TYPES[extension],
          fileName: `music-${track.id}.${extension}`,
          projectId: null,
          provenance: {
            kind: 'bundled',
            pack: 'music-pack',
            itemId: track.id,
            licence: track.licence,
            sourceUrl: track.sourceUrl,
            title: track.title,
          },
        },
        request.signal ? { signal: request.signal } : {},
      );
      if (!stored.ok) return stored;
      return ok({
        payload: {
          projectId: request.timeline.projectId,
          timelineId: request.timeline.id,
          choice: {
            path: 'ownTrack',
            assetId: stored.value.assetId,
            offset: RationalTime.of(0, MILLISECONDS),
            gainDb: request.gainDb ?? 0,
          },
        },
        assetId: stored.value.assetId,
        track,
        beatMap: track.beatMap ?? null,
        duplicate: stored.value.duplicate,
      });
    },
  };
}

export type MusicLibrary = ReturnType<typeof createMusicLibrary>;
