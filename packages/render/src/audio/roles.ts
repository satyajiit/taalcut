// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which bus each planned sound joins (P3-V6, audio SPEC P3.5). Ducking needs the dry voice apart from the
 * music and the effects: music is the music path's file (own track, generated or the reference's audio);
 * effects are clips on audio tracks of role `sfx`; the voice is the voiceover (role `voice`) and the kept
 * sound of clips that carry speech (V1 and role `clip`: a talking head's words). Clip sound without speech
 * (`speech` says which assets have it) is ambience: mixed as it is, neither ducked nor ducked under. Code
 * reads the track's role, never its id (A2 and A3 are only the convention).
 */
import type { AssetId, AudioTrackRole, Timeline } from '@taalcut/core';
import type { RenderPlan } from '../plan/types';
import type { MixBus } from './mix-graph';
import type { MixSegment } from './mix-types';

/** Each track's role by id; video tracks carry clip sound. */
export function audioRoles(timeline: Pick<Timeline, 'tracks'>): ReadonlyMap<string, AudioTrackRole> {
  return new Map(
    timeline.tracks.map((track) => [track.id, track.kind === 'audio' ? track.role : 'clip'] as const),
  );
}

/**
 * Each segment's bus. `speech` tells which assets' sound carries speech (a transcript with words); without
 * it all kept clip sound counts as voice, the safe side (the music ducks under it).
 */
export function busOfSegment(
  plan: Pick<RenderPlan, 'audio'>,
  roles: ReadonlyMap<string, AudioTrackRole>,
  speech?: (assetId: AssetId) => boolean,
): (segment: MixSegment) => MixBus {
  const clips = new Map(plan.audio.map((clip) => [clip.id, clip] as const));
  return (segment) => {
    if (segment.kind !== 'clip') return 'music';
    const clip = clips.get(segment.id);
    const role = clip ? roles.get(clip.track) : undefined;
    if (role === 'sfx') return 'effects';
    if (role === 'voice' || !clip || !speech) return 'voice';
    return speech(clip.assetId) ? 'voice' : 'ambience';
  };
}
