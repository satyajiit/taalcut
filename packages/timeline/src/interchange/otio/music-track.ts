// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The music bed in OTIO (P3-V5): the user's own or generated track as one clip on a 'Music' audio track under the
 * whole video, linked like any original (otio-items' `reference`: an ExternalReference when online, a
 * MissingReference keeping its last known path when not).
 */
import { RationalTime, type Timeline } from '@taalcut/core';
import { musicBed } from '../cut-list';
import { range, reference, rt, rtAt, type ResolveMedia } from './otio-items';

/** The user's own or generated track as one clip under the whole video; none for other music paths. */
export function musicTrack(timeline: Timeline, resolve: ResolveMedia) {
  const bed = musicBed(timeline);
  const music = timeline.music;
  if (!bed || (music.path !== 'ownTrack' && music.path !== 'generated')) return [];
  const length = RationalTime.of(bed.frames, timeline.canvas.rate);
  const start = music.path === 'ownTrack' ? music.offset : RationalTime.zero(timeline.canvas.rate);
  const source = resolve(music.assetId);
  const clip = {
    OTIO_SCHEMA: 'Clip.2' as const,
    metadata: { Taalcut: { assetId: music.assetId, music: music.path, gainDb: music.gainDb } },
    name: source.name,
    source_range: range(rt(start), rtAt(length, start.rate)),
    effects: [],
    markers: [],
    enabled: true,
    color: null,
    media_references: { DEFAULT_MEDIA: reference(source, null) },
    active_media_reference_key: 'DEFAULT_MEDIA',
  };
  return [
    {
      OTIO_SCHEMA: 'Track.1' as const,
      metadata: { Taalcut: { trackId: 'music' } },
      name: 'Music',
      source_range: null,
      effects: [],
      markers: [],
      enabled: true,
      color: null,
      children: [clip],
      kind: 'Audio' as const,
    },
  ];
}
