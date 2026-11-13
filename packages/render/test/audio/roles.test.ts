// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Which bus each sound joins for ducking (P3-V6): by the track's role, never its id. */
import { describe, expect, it } from 'vitest';
import { FrameRate, newId, RationalTime, type AudioTrackRole } from '@taalcut/core';
import { planAudioMix } from '../../src/audio/mix-plan';
import { audioRoles, busOfSegment } from '../../src/audio/roles';
import { makeTimeline } from '../support/timeline';
import { planTimeline } from '../../src/plan/render-plan';

describe('busOfSegment', () => {
  const talk = newId<'Asset'>();
  const base = makeTimeline({
    items: [{ frames: 30, assetId: talk }, { frames: 30 }],
    audioTracks: [[{ frames: 60 }], [{ frames: 60 }]],
    music: {
      path: 'ownTrack',
      assetId: newId<'Asset'>(),
      offset: RationalTime.of(0, FrameRate.of(1000)),
      gainDb: 0,
    },
  });
  // Roles swapped from the convention on purpose: A1 carries effects, A2 the voiceover.
  const role: Record<string, AudioTrackRole> = { A1: 'sfx', A2: 'voice' };
  const timeline = {
    ...base,
    tracks: base.tracks.map((track) =>
      track.kind === 'audio' ? { ...track, role: role[track.id] ?? track.role } : track,
    ),
  };
  const plan = planTimeline(timeline);
  if (!plan.ok) throw new Error(plan.error.code);
  const mix = planAudioMix(plan.value, {
    clip: () => ({ path: 'x.wav', offset: RationalTime.of(0, FrameRate.of(48_000)) }),
    ownTrack: { path: 'music.wav' },
  });
  if (!mix.ok) throw new Error(mix.error.code);
  const trackOf = (id: string) => plan.value.audio.find((clip) => clip.id === id)?.track ?? 'music';

  it('reads roles: voice and V1 sound to the voice bus, sfx to effects, the music path to music', () => {
    const busOf = busOfSegment(plan.value, audioRoles(timeline));
    expect(mix.value.segments.map((segment) => [trackOf(segment.id), busOf(segment)])).toEqual([
      ['V1', 'voice'],
      ['V1', 'voice'],
      ['A1', 'effects'],
      ['A2', 'voice'],
      ['music', 'music'],
    ]);
  });

  it('keeps clip sound without speech out of the voice stem, as ambience', () => {
    const busOf = busOfSegment(plan.value, audioRoles(timeline), (assetId) => assetId === talk);
    expect(mix.value.segments.map((segment) => busOf(segment))).toEqual([
      'voice',
      'ambience',
      'effects',
      'voice',
      'music',
    ]);
  });
});
