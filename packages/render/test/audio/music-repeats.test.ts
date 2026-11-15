// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: the reel's own music laid with bars played again. The owner's case: a video of 599 frames at 30 a second
 * whose music goes back 129 frames (4.3 s) at 10.095 s with a 50 ms crossfade. The bed becomes two stretches that
 * tile the video to the sample; the second reads the reel 129 frames earlier and starts the crossfade early.
 */
import { FrameRate, newId, RationalTime, type MusicBed, type MusicRepeat } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { mixFilterGraph, planAudioMix, type AudioSourceMap } from '../../src/audio/mix-plan';
import type { RenderPlan } from '../../src/plan/types';
import { planOf } from './helpers';

const rate = FrameRate.of(30);
const hz = FrameRate.of(48_000);
const t = (frames: number) => RationalTime.of(frames, rate);
const sources: AudioSourceMap = {
  clip: () => ({ path: 'clip.wav', offset: RationalTime.of(0, hz) }),
  reference: { path: 'reel.mp4' },
  ownTrack: { path: 'song.m4a' },
};
const repeat = (atSample: number, frames: number, crossfade = 2400): MusicRepeat => ({
  at: RationalTime.of(atSample, hz),
  length: t(frames),
  crossfade: RationalTime.of(crossfade, hz),
  bars: 2,
  slotId: null,
});
const OWNER = repeat(484_560, 129);

function plan(repeats: readonly MusicRepeat[], patch: Partial<RenderPlan> = {}): RenderPlan {
  const base = planOf({
    rate,
    items: [
      { frames: 432, muted: true },
      { frames: 167, muted: true },
    ],
    music: { path: 'referenceAudio', templateId: newId<'Template'>(), gainDb: -3 },
  });
  return { ...base, musicRepeats: repeats, ...patch };
}

function music(of: RenderPlan) {
  const mix = planAudioMix(of, sources);
  if (!mix.ok) throw new Error(mix.error.code);
  return mix.value;
}

const laid = (of: RenderPlan) =>
  music(of).segments.map((s) => [s.startSample, s.samples, s.inSample, s.fadeInSamples, s.fadeOutSamples]);

describe('the reel’s music with bars played again (LONG1)', () => {
  it('without a repeat is one bed from the reel’s first sample, as before', () => {
    const mix = music(plan([]));
    expect(mix.totalSamples).toBe(958_400);
    expect(laid(plan([]))).toEqual([[0, 958_400, 0, 0, 0]]);
    expect(mix.segments[0]).not.toHaveProperty('fadeOutCurve');
    expect(music({ ...plan([]), musicRepeats: undefined } as RenderPlan).segments).toEqual(mix.segments);
  });

  it('the owner’s repeat: two stretches that tile the video, the second 129 frames back, crossfaded linearly', () => {
    const mix = music(plan([OWNER]));
    // Until 10.095 s the reel as it is, fading out over the last 50 ms; from 50 ms before, the reel from
    // 10.045 − 4.3 = 5.745 s (275 760 samples), fading in: both reach the splice together.
    expect(laid(plan([OWNER]))).toEqual([
      [0, 484_560, 0, 0, 2400],
      [482_160, 476_240, 275_760, 2400, 0],
    ]);
    expect(mix.segments.map((s) => [s.kind, s.path, s.gainDb, s.fadeInCurve, s.fadeOutCurve])).toEqual([
      ['reference', 'reel.mp4', -3, undefined, 'linear'],
      ['reference', 'reel.mp4', -3, 'linear', undefined],
    ]);
    // After the splice the reel's sample under a video sample is 129 frames (206 400 samples) earlier: the film
    // shots, 129 frames later in the video, sit on the music they sat on in the reel.
    const second = mix.segments[1]!;
    expect(second.startSample - second.inSample).toBe(206_400);
    expect(second.startSample + second.samples).toBe(mix.totalSamples);
    expect(mix.referenceAudio).toBe(true);
    // The graph fades the two sides with a linear curve, and every other fade stays equal power.
    const graph = mixFilterGraph(mix);
    expect(graph).toContain('afade=t=out:ss=482160:ns=2400:curve=tri');
    expect(graph).toContain('afade=t=in:ss=0:ns=2400:curve=tri');
    expect(graph).not.toContain('curve=qsin');
  });

  it('two repeats: each stretch reads the reel further back', () => {
    // 60 frames back at 3 s, then 30 frames back at 8 s of the video (the music's clock counts the first).
    const two = [repeat(144_000, 60), repeat(384_000, 30)];
    expect(laid(plan(two))).toEqual([
      [0, 144_000, 0, 0, 2400],
      [141_600, 242_400, 141_600 - 96_000, 2400, 2400],
      [381_600, 958_400 - 381_600, 381_600 - 144_000, 2400, 0],
    ]);
  });

  it('keeps the bed’s window, fades and mute; a splice outside the window only moves the reading', () => {
    const bed = (patch: Partial<MusicBed>): MusicBed => ({
      start: t(0),
      end: null,
      shift: t(0),
      fadeIn: t(0),
      fadeOut: t(0),
      muted: false,
      ...patch,
    });
    // The bed's own fades stay on the video's two ends, equal power.
    const faded = music(plan([OWNER], { musicBed: bed({ fadeIn: t(15), fadeOut: t(30) }) }));
    expect(
      faded.segments.map((s) => [s.fadeInSamples, s.fadeInCurve, s.fadeOutSamples, s.fadeOutCurve]),
    ).toEqual([
      [24_000, undefined, 2400, 'linear'],
      [2400, 'linear', 48_000, undefined],
    ]);
    // Music that starts at 12 s, after the splice: one stretch, read 129 frames back.
    expect(laid(plan([OWNER], { musicBed: bed({ start: t(360) }) }))).toEqual([
      [576_000, 382_400, 576_000 - 206_400, 0, 0],
    ]);
    // Music that ends at 6 s, before the splice: as if there were none.
    expect(laid(plan([OWNER], { musicBed: bed({ end: t(180) }) }))).toEqual([[0, 288_000, 0, 0, 0]]);
    expect(music(plan([OWNER], { musicBed: bed({ muted: true }) })).segments).toEqual([]);
  });

  it('only the reel’s own music plays them: another track is one bed', () => {
    const own = plan([OWNER], {
      music: { path: 'ownTrack', assetId: newId<'Asset'>(), offset: t(0), gainDb: 0 },
    });
    expect(laid(own)).toEqual([[0, 958_400, 0, 0, 0]]);
    expect(music(plan([OWNER], { music: { path: 'platformSound' } })).segments).toEqual([]);
  });
});
