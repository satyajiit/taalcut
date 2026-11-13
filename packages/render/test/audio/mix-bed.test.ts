// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the music's bed in the mix (core's MusicBed): the window it sounds over, the shift that keeps a moved
 * track's sample under each frame, its fades, mute; and a clip's own sound fades.
 */
import { FrameRate, newId, RationalTime, type MusicBed } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { planAudioMix, type AudioSourceMap } from '../../src/audio/mix-plan';
import type { RenderPlan } from '../../src/plan/types';
import { planOf } from './helpers';

const rate = FrameRate.of(30);
const t = (frames: number) => RationalTime.of(frames, rate);
const sources: AudioSourceMap = {
  clip: () => ({ path: 'clip.wav', offset: RationalTime.of(0, FrameRate.of(48000)) }),
  ownTrack: { path: 'song.m4a' },
};
const bed = (patch: Partial<MusicBed>): MusicBed => ({
  start: t(0),
  end: null,
  shift: t(0),
  fadeIn: t(0),
  fadeOut: t(0),
  muted: false,
  ...patch,
});

function musicOf(plan: RenderPlan) {
  const mix = planAudioMix(plan, sources);
  if (!mix.ok) throw new Error(mix.error.code);
  return mix.value.segments.find((segment) => segment.kind === 'music');
}

const withBed = (musicBed?: MusicBed): RenderPlan => {
  const plan = planOf({
    rate,
    items: [{ frames: 90, muted: true }],
    music: { path: 'ownTrack', assetId: newId<'Asset'>(), offset: t(30), gainDb: -6 },
  });
  return musicBed ? { ...plan, musicBed } : plan;
};

describe('the music’s bed', () => {
  it('without one, plays the whole video as before', () => {
    expect(musicOf(withBed())).toMatchObject({ startSample: 0, samples: 144_000, inSample: 48_000, fadeInSamples: 0 });
  });

  it('a moved track starts later and keeps its sample under each frame; a trimmed end stops it', () => {
    const moved = musicOf(withBed(bed({ start: t(30), shift: t(30), end: t(75) })));
    expect(moved).toMatchObject({ startSample: 48_000, samples: 72_000, inSample: 48_000 });
    const trimmed = musicOf(withBed(bed({ start: t(15) })));
    expect(trimmed).toMatchObject({ startSample: 24_000, samples: 120_000, inSample: 72_000 });
  });

  it('fades in and out within its window, and a muted bed is silent', () => {
    expect(musicOf(withBed(bed({ fadeIn: t(15), fadeOut: t(300) })))).toMatchObject({ fadeInSamples: 24_000, fadeOutSamples: 144_000 });
    expect(musicOf(withBed(bed({ muted: true })))).toBeUndefined();
  });

  it('a track moved earlier than the video starts in the song’s middle', () => {
    const early = musicOf(withBed(bed({ shift: t(-15) })));
    expect(early).toMatchObject({ startSample: 0, inSample: 72_000, samples: 144_000 });
  });
});
