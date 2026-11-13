// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** planAudioMix: sample-exact segments, the music paths' sources, and the filter graph it implies. */
import { describe, expect, it } from 'vitest';
import { FrameRate, newId, RationalTime } from '@taalcut/core';
import { atempoChain, mixFilterGraph, planAudioMix, type AudioSourceMap } from '../../src/audio/mix-plan';
import { planOf } from './helpers';

const ntsc = FrameRate.of(30000, 1001);
const hz = FrameRate.of(48000);
const clips = (path = '/tmp/clip.wav'): AudioSourceMap => ({
  clip: () => ({ path, offset: RationalTime.of(0, hz) }),
});

describe('planAudioMix', () => {
  it('lays clips out on whole samples that tile exactly at NTSC rates', () => {
    const plan = planOf({ rate: ntsc, items: [{ frames: 37 }, { frames: 53 }, { frames: 1 }] });
    const mix = planAudioMix(plan, clips());
    if (!mix.ok) throw new Error(mix.error.code);
    expect(mix.value.totalSamples).toBe(Math.round((91 * 48000 * 1001) / 30000));
    const [a, b, c] = mix.value.segments;
    expect(a!.startSample).toBe(0);
    expect(a!.startSample + a!.samples).toBe(b!.startSample);
    expect(b!.startSample + b!.samples).toBe(c!.startSample);
    expect(c!.startSample + c!.samples).toBe(mix.value.totalSamples);
    expect(mix.value).toMatchObject({ silent: false, music: 'platformSound', referenceAudio: false });
  });

  it('reads a clip in-point from the source offset at any rate', () => {
    const plan = planOf({ items: [{ frames: 30 }] });
    const mix = planAudioMix(plan, {
      clip: () => ({ path: 'a.wav', offset: RationalTime.of(30, FrameRate.of(25)) }),
    });
    if (!mix.ok) throw new Error(mix.error.code);
    expect(mix.value.segments[0]).toMatchObject({
      inSample: 57_600,
      startSample: 0,
      samples: 48_000,
      tempo: 1,
    });
  });

  it('crossfades clips over a transition with equal-power fades', () => {
    const plan = planOf({
      items: [{ frames: 30 }, { frames: 30, transition: { kind: 'dissolve', inFrames: 3, outFrames: 3 } }],
    });
    const mix = planAudioMix(plan, clips());
    if (!mix.ok) throw new Error(mix.error.code);
    const [a, b] = mix.value.segments;
    expect(a).toMatchObject({
      startSample: 0,
      samples: 33 * 1600,
      fadeOutSamples: 6 * 1600,
      fadeInSamples: 0,
    });
    expect(b).toMatchObject({ startSample: 27 * 1600, samples: 33 * 1600, fadeInSamples: 6 * 1600 });
    const graph = mixFilterGraph(mix.value);
    expect(graph).toContain(`afade=t=out:ss=${27 * 1600}:ns=${6 * 1600}:curve=qsin`);
    expect(graph).toContain(`adelay=delays=${27 * 1600}S:all=1`);
    expect(graph).toContain('amix=inputs=2:normalize=0');
    expect(graph).toContain(`apad=whole_len=${60 * 1600},atrim=end_sample=${60 * 1600}`);
  });

  it('path a never takes the reference audio, even when a source is offered', () => {
    const plan = planOf({ items: [{ frames: 30, muted: true }] });
    const mix = planAudioMix(plan, { ...clips(), reference: { path: '/tmp/reference.m4a' } });
    if (!mix.ok) throw new Error(mix.error.code);
    expect(mix.value.segments).toEqual([]);
    expect(mix.value).toMatchObject({ silent: true, referenceAudio: false, totalSamples: 48_000 });
  });

  it('path b plays the track from its offset under the clip sound; a negative offset starts it later', () => {
    const assetId = newId<'Asset'>();
    const later = planOf({
      items: [{ frames: 60 }],
      music: { path: 'ownTrack', assetId, offset: RationalTime.of(-15, FrameRate.of(30)), gainDb: -6 },
    });
    const mix = planAudioMix(later, { ...clips(), ownTrack: { path: '/tmp/track.m4a' } });
    if (!mix.ok) throw new Error(mix.error.code);
    expect(mix.value.segments.map((segment) => segment.kind)).toEqual(['clip', 'music']);
    expect(mix.value.segments[1]).toMatchObject({
      inSample: 0,
      startSample: 24_000,
      samples: 72_000,
      gainDb: -6,
    });

    const earlier = planOf({
      items: [{ frames: 60 }],
      music: { path: 'ownTrack', assetId, offset: RationalTime.of(1500, FrameRate.of(1000)), gainDb: 0 },
    });
    const into = planAudioMix(earlier, { ...clips(), ownTrack: { path: '/tmp/track.m4a' } });
    if (!into.ok) throw new Error(into.error.code);
    expect(into.value.segments[1]).toMatchObject({ inSample: 72_000, startSample: 0, samples: 96_000 });
    expect(planAudioMix(earlier, clips()).ok).toBe(false);
  });

  it('path d lays the reference from frame 0 and needs its file', () => {
    const plan = planOf({
      items: [{ frames: 30, muted: true }],
      music: { path: 'referenceAudio', templateId: newId<'Template'>(), gainDb: -3 },
    });
    const missing = planAudioMix(plan, clips());
    expect(missing.ok ? null : missing.error.code).toBe('render.media_missing');
    const mix = planAudioMix(plan, { ...clips(), reference: { path: '/tmp/reference.m4a' } });
    if (!mix.ok) throw new Error(mix.error.code);
    expect(mix.value).toMatchObject({ silent: false, referenceAudio: true, music: 'referenceAudio' });
    expect(mix.value.segments).toEqual([
      expect.objectContaining({
        kind: 'reference',
        inSample: 0,
        startSample: 0,
        samples: 48_000,
        gainDb: -3,
      }),
    ]);
  });

  it('refuses a clip whose sound has no source', () => {
    const plan = planOf({ items: [{ frames: 30 }] });
    const mix = planAudioMix(plan, { clip: () => undefined });
    expect(mix.ok ? null : mix.error.code).toBe('render.media_missing');
  });

  it('plays a speed ramp on its curve, piece by piece, not at its mean tempo', () => {
    const rate = FrameRate.of(30);
    const speed = {
      curve: 'linear' as const,
      points: [
        { at: RationalTime.of(0, rate), speed: 0.5 },
        { at: RationalTime.of(60, rate), speed: 2 },
      ],
    };
    const plan = planOf({ items: [{ frames: 60, sourceStart: 0, speed }] });
    const mix = planAudioMix(plan, clips());
    if (!mix.ok) throw new Error(mix.error.code);
    const segment = mix.value.segments[0]!;
    const pieces = segment.pieces ?? [];
    expect(pieces.reduce((sum, piece) => sum + piece.samples, 0)).toBe(segment.samples);
    // ∫ speed over the clip: 60 frames × mean 1.25 = 75 frames of source.
    expect(pieces.reduce((sum, piece) => sum + piece.consumed, 0)).toBe(75 * 1600);
    // The first half plays 26.25 frames of source, not the mean's 37.5.
    const firstHalf = pieces.slice(0, 5).reduce((sum, piece) => sum + piece.consumed, 0);
    expect(firstHalf).toBe(Math.round(26.25 * 1600));
    const graph = mixFilterGraph(mix.value);
    expect(graph).toContain(`asplit=${pieces.length}`);
    expect(graph).toContain(`concat=n=${pieces.length}:v=0:a=1`);
    expect(new Set(graph.match(/atempo=[\d.]+/g)).size).toBeGreaterThan(5);
  });
});

describe('atempoChain', () => {
  it('chains halves below 0.5 and leaves real time alone', () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(2)).toEqual([2]);
    const slow = atempoChain(0.1);
    expect(slow.every((factor) => factor >= 0.5 && factor <= 100)).toBe(true);
    expect(slow.reduce((product, factor) => product * factor, 1)).toBeCloseTo(0.1, 6);
  });
});
