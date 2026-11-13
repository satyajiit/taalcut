// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What the export sections read off a timeline (Timeline v2): its assets, voice, effects, framing and music. */
import type { AssetId, Clip, Timeline, Track } from '@taalcut/core';

const isRole = (role: 'voice' | 'sfx') => (track: Track) => track.kind === 'audio' && track.role === role;

const clipsOf = (tracks: readonly Track[]): Clip[] =>
  tracks.flatMap((track) =>
    track.kind === 'text' ? [] : track.items.filter((item): item is Clip => item.type === 'clip'),
  );

/** The distinct assets the timeline shows or plays, its music included (what library.credits is asked about). */
export function timelineAssetIds(timeline: Timeline): AssetId[] {
  const ids = new Set<AssetId>(clipsOf(timeline.tracks).map((clip) => clip.media.assetId));
  if (timeline.music.path === 'ownTrack' || timeline.music.path === 'generated')
    ids.add(timeline.music.assetId);
  return [...ids];
}

/** True when someone speaks over the cut: a voiceover, or clips on the voice track. */
export function hasVoice(timeline: Timeline): boolean {
  return timeline.voiceover !== null || clipsOf(timeline.tracks.filter(isRole('voice'))).length > 0;
}

/** Sounds on the effects track (the hits on the cuts). */
export function hitCount(timeline: Timeline): number {
  return clipsOf(timeline.tracks.filter(isRole('sfx'))).length;
}

/** Video clips with a framing of their own (smart reframe, P3-V2), in timeline order. */
export function reframedClips(timeline: Timeline): Clip[] {
  return clipsOf(timeline.tracks.filter((track) => track.kind === 'video')).filter(
    (clip) => clip.media.kind === 'video' && clip.reframe !== null,
  );
}

/** Video clips on the timeline. */
export function videoClipCount(timeline: Timeline): number {
  return clipsOf(timeline.tracks.filter((track) => track.kind === 'video')).filter(
    (clip) => clip.media.kind === 'video',
  ).length;
}

/** A clip's framing follows its subject (rather than a fixed centre crop or the whole frame on a blurred pad). */
export const follows = (clip: Clip): boolean =>
  clip.reframe?.mode === 'auto' || clip.reframe?.mode === 'subject';
