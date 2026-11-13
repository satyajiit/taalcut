// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The bundled music pack (`music-pack` component, SPEC P3.5): `catalogue.json` beside the track files, every
 * track a CC0-1.0 dedication with where it came from and where the dedication says so. The PO picks the tracks
 * (`tools/audio-packs/music-tracks.json`); until then no pack is built, so a missing, unreadable or empty
 * catalogue is `audio.music_library_empty` and the option stays hidden. The catalogue is a file on disk:
 * validated on every read.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beatMapSchema, err, ok, type AsyncResult } from '@taalcut/core';
import { z } from 'zod';
import { MusicLibraryEmpty } from './errors';

export const MUSIC_TRACK_FILE = /^[a-z0-9-]+\.(opus|ogg|mp3|flac|wav)$/;
/** Lowercase mood words, the same shape `music.generate` takes. */
export const moodWordSchema = z.string().regex(/^[a-z][a-z-]{0,31}$/);

export const musicPackTrackSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  title: z.string().min(1).max(120),
  /** Relative to the pack folder; no folders. Kept byte for byte from the source. */
  file: z.string().regex(MUSIC_TRACK_FILE),
  /** The tempo searched on (from the track list, or measured when the pack was built). */
  bpm: z.number().min(40).max(240),
  seconds: z.number().positive().max(1200),
  moods: z.array(moodWordSchema).max(12),
  licence: z.literal('CC0-1.0'),
  /** Where the track was taken from. */
  sourceUrl: z.url().max(500),
  /** Where its CC0 dedication can be read. */
  dedicationUrl: z.url().max(500),
  /** CC0 asks for no credit; the artist's name when the PO wants it shown anyway. */
  attribution: z.string().min(1).max(300).optional(),
  /** Beats tracked when the pack was built; absent, the timeline tracks them on first use. */
  beatMap: beatMapSchema.optional(),
});
export type MusicPackTrack = z.output<typeof musicPackTrackSchema>;

export const musicPackCatalogueSchema = z.object({
  version: z.literal(1),
  pack: z.literal('music-pack'),
  packVersion: z.string().min(1).max(40),
  tracks: z.array(musicPackTrackSchema).max(500),
});
export type MusicPackCatalogue = z.output<typeof musicPackCatalogueSchema>;

export interface MusicPack {
  readonly tracks: readonly MusicPackTrack[];
  pathOf(track: MusicPackTrack): string;
}

export async function loadMusicPack(dir: string): AsyncResult<MusicPack> {
  let raw: string;
  try {
    raw = await readFile(join(dir, 'catalogue.json'), 'utf8');
  } catch {
    return err(MusicLibraryEmpty(undefined, { detail: 'no catalogue.json in the music-pack component' }));
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return err(MusicLibraryEmpty(undefined, { detail: 'catalogue.json is not JSON' }));
  }
  const parsed = musicPackCatalogueSchema.safeParse(json);
  if (!parsed.success)
    return err(MusicLibraryEmpty(undefined, { detail: parsed.error.issues[0]?.message ?? 'bad catalogue' }));
  if (parsed.data.tracks.length === 0)
    return err(MusicLibraryEmpty(undefined, { detail: 'the music pack has no tracks yet' }));
  const ids = new Set<string>();
  for (const track of parsed.data.tracks) {
    if (ids.has(track.id))
      return err(MusicLibraryEmpty(undefined, { detail: `track '${track.id}' is in the catalogue twice` }));
    ids.add(track.id);
  }
  return ok({ tracks: parsed.data.tracks, pathOf: (track) => join(dir, track.file) });
}
