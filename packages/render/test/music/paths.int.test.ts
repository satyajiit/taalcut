// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The music paths export correctly (P2-M10; path c, generated, P3-V6; path d,
 * the reel's own music, REF1). Path d needs no acknowledgement: only the reel
 * the template keeps, and when that is gone the error's fix fetches it again.
 * Path a never carries reference audio. With a Style's bumpers the music plays
 * between them (P3-V10).
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FrameRate, newId, ok, RationalTime, type MusicChoice } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { mixAudio, renderMix } from '../../src/audio/mix';
import { planAudioMix, type AudioSourceMap } from '../../src/audio/mix-plan';
import { musicPreflight, musicSources, platformSoundSteps } from '../../src/music/paths';
import { NO_BUMPERS } from '../../src/plan/types';
import type { ReferenceAudioSource } from '../../src/ports';
import { decodePcm, evalWav, onset, peak, planOf, pulseAt, rms } from '../audio/helpers';
import { findTestMedia, mediaContext, tempDir } from '../support/media';

const media = await findTestMedia('render music paths');
const hz = FrameRate.of(48000);
const target = { integratedLufs: -14, truePeakDbtp: -1 };

const referenceFile = (path: string | null): ReferenceAudioSource => ({ file: vi.fn(async () => ok(path)) });

/** Path c as audio leaves it: the generated original, its warped FLAC in the cache, the grid check. */
const generatedChoice = (gainDb = 0): Extract<MusicChoice, { path: 'generated' }> => ({
  path: 'generated',
  assetId: newId<'Asset'>(),
  warpedKey: `warped/ab/${'ab'.repeat(32)}.v1.flac`,
  bpm: 120,
  grid: { maxErrorMs: 4, p95ErrorMs: 2, missed: 0 },
  gainDb,
});

describe('music preflight', () => {
  const templateId = newId<'Template'>();
  const pathD: MusicChoice = { path: 'referenceAudio', templateId, gainDb: 0 };

  it('path a needs nothing and gets no files', async () => {
    const referenceAudio = referenceFile('/tmp/reference.mp4');
    expect(await musicPreflight({ path: 'platformSound' }, { referenceAudio })).toEqual(ok({}));
    expect(referenceAudio.file).not.toHaveBeenCalled();
  });

  it('path d finds the kept reel with no acknowledgement at all', async () => {
    const referenceAudio = referenceFile('/library/templates/media/t/reference.mp4');
    expect(await musicPreflight(pathD, { referenceAudio })).toEqual(
      ok({ reference: '/library/templates/media/t/reference.mp4' }),
    );
    expect(referenceAudio.file).toHaveBeenCalledWith(templateId);
  });

  it('path d without its reel is media_missing, with "Get the reel\'s video and music" as the fix', async () => {
    const gone = await musicPreflight(pathD, { referenceAudio: referenceFile(null) });
    expect(gone.ok ? null : gone.error).toMatchObject({
      code: 'render.media_missing',
      params: { name: 'reference audio' },
      fix: { command: 'templates.fetchMedia', labelKey: 'fix.getReelMedia', payload: { id: templateId } },
    });
  });

  it('path b needs its track on disk', async () => {
    const choice: MusicChoice = {
      path: 'ownTrack',
      assetId: newId<'Asset'>(),
      offset: RationalTime.of(0, hz),
      gainDb: 0,
    };
    const deps = { referenceAudio: referenceFile(null) };
    expect(await musicPreflight(choice, { ...deps, ownTrackPath: async () => ok('/tmp/track.m4a') })).toEqual(
      ok({ ownTrack: '/tmp/track.m4a' }),
    );
    const missing = await musicPreflight(choice, { ...deps, ownTrackPath: async () => ok(null) });
    expect(missing.ok ? null : missing.error.code).toBe('render.media_missing');
  });

  it('path c needs its warped track on disk, and says when the cache lost it', async () => {
    const choice = generatedChoice();
    const deps = { referenceAudio: referenceFile(null) };
    const asked: string[] = [];
    const found = await musicPreflight(choice, {
      ...deps,
      generatedMusic: async (generated) => {
        asked.push(generated.warpedKey);
        return ok('/cache/warped.flac');
      },
    });
    expect(found).toEqual(ok({ generated: '/cache/warped.flac' }));
    expect(asked).toEqual([choice.warpedKey]);
    expect(musicSources({ generated: '/cache/warped.flac' })).toEqual({
      generated: { path: '/cache/warped.flac' },
    });
    for (const generatedMusic of [async () => ok(null), undefined]) {
      const missing = await musicPreflight(choice, {
        ...deps,
        ...(generatedMusic ? { generatedMusic } : {}),
      });
      expect(missing.ok ? null : missing.error).toMatchObject({
        code: 'render.media_missing',
        params: { name: 'generated music' },
      });
    }
  });

  it('gives "add this sound in the app" steps for each platform', () => {
    const steps = platformSoundSteps({
      referenceUrl: 'https://www.instagram.com/reel/abc/',
      soundLabel: 'Song · Artist',
    });
    expect(steps.steps.map((step) => step.platform)).toEqual(['shorts', 'reels', 'tiktok']);
    expect(steps.steps[1]!.stepKeys[0]).toBe('music.platformSound.steps.reels.1');
    expect(platformSoundSteps({ referenceUrl: null, soundLabel: 'x'.repeat(300) }).soundLabel).toHaveLength(
      200,
    );
  });
});

describe.skipIf(!media.binaries)('music paths export', () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let voice: string;

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('music');
    voice = await evalWav(ctx, work.dir, 'voice', '0.2*sin(2*PI*300*n/48000)', 200_000);
  });
  afterAll(() => work?.dispose());

  const clipSources = (): AudioSourceMap => ({
    clip: () => ({ path: voice, offset: RationalTime.of(0, hz) }),
  });

  it('a: a silent track of exact length, and no reference source in the plan', async () => {
    const plan = planOf({
      rate: FrameRate.of(24),
      items: [
        { frames: 40, muted: true },
        { frames: 33, muted: true },
      ],
    });
    const mix = planAudioMix(plan, { ...clipSources(), reference: { path: voice } });
    if (!mix.ok) throw new Error(mix.error.code);
    expect(mix.value.segments.filter((segment) => segment.kind === 'reference')).toEqual([]);
    expect(mix.value).toMatchObject({ silent: true, referenceAudio: false });
    const out = await mixAudio(mix.value, ctx, {
      out: join(work.dir, 'a.m4a'),
      loudness: target,
      bitrateKbps: 192,
      sampleRate: 48000,
    });
    if (!out.ok) throw new Error(out.error.code);
    const pcm = await decodePcm(ctx, out.value.path);
    expect(pcm.length).toBe(73 * 2000);
    expect(peak(pcm)).toBe(0);
  });

  it('a: clip sound only where the timeline keeps it', async () => {
    const plan = planOf({ items: [{ frames: 30 }, { frames: 30, muted: true }] });
    const mix = planAudioMix(plan, { ...clipSources(), reference: { path: voice } });
    if (!mix.ok) throw new Error(mix.error.code);
    expect(mix.value.segments.map((segment) => segment.kind)).toEqual(['clip']);
    const wav = await renderMix(mix.value, ctx, { out: join(work.dir, 'a-kept.wav') });
    if (!wav.ok) throw new Error(wav.error.code);
    const pcm = await decodePcm(ctx, wav.value.path);
    expect(rms(pcm, 0, 48_000)).toBeGreaterThan(0.1);
    expect(peak(pcm, 48_000)).toBe(0);
  });

  it('b: the track lands at its offset under the clip sound', async () => {
    const track = await evalWav(ctx, work.dir, 'track', pulseAt(96_000, 0.6), 300_000);
    const plan = planOf({
      items: [{ frames: 90, muted: true }],
      music: {
        path: 'ownTrack',
        assetId: newId<'Asset'>(),
        offset: RationalTime.of(1500, FrameRate.of(1000)),
        gainDb: 0,
      },
    });
    const mix = planAudioMix(plan, { ...clipSources(), ownTrack: { path: track } });
    if (!mix.ok) throw new Error(mix.error.code);
    const wav = await renderMix(mix.value, ctx, { out: join(work.dir, 'b.wav') });
    if (!wav.ok) throw new Error(wav.error.code);
    // The pulse at 2.0 s in the track, read from 1.5 s, sounds 0.5 s into the render.
    expect(onset(await decodePcm(ctx, wav.value.path), 0.3)).toBe(24_000);
  });

  it('d: the reel is mixed at its gain, read from its first sample', async () => {
    const reference = await evalWav(ctx, work.dir, 'reference', '0.25*sin(2*PI*440*n/48000)', 200_000);
    const choice: MusicChoice = { path: 'referenceAudio', templateId: newId<'Template'>(), gainDb: -6.0206 };
    const plan = planOf({ items: [{ frames: 60, muted: true }], music: choice });
    const files = await musicPreflight(choice, { referenceAudio: referenceFile(reference) });
    if (!files.ok) throw new Error(files.error.code);
    const mix = planAudioMix(plan, { ...clipSources(), ...musicSources(files.value) });
    if (!mix.ok) throw new Error(mix.error.code);
    expect(mix.value.referenceAudio).toBe(true);
    expect(mix.value.segments).toMatchObject([{ kind: 'reference', inSample: 0, startSample: 0 }]);
    const wav = await renderMix(mix.value, ctx, { out: join(work.dir, 'd.wav') });
    if (!wav.ok) throw new Error(wav.error.code);
    expect(peak(await decodePcm(ctx, wav.value.path))).toBeCloseTo(0.125, 2);
    const out = await mixAudio(mix.value, ctx, {
      out: join(work.dir, 'd.m4a'),
      loudness: target,
      bitrateKbps: 192,
      sampleRate: 48000,
    });
    if (!out.ok) throw new Error(out.error.code);
    expect(Math.abs(out.value.measured!.integratedLufs + 14)).toBeLessThanOrEqual(0.5);
  });

  it('c: the warped track from the first timeline frame at its gain, between the bumpers', async () => {
    // A pulse at the track's first sample over a quiet bed: where the music starts is exact.
    const warped = await evalWav(ctx, work.dir, 'warped', pulseAt(0, 0.8, 48, '0.2'), 300_000);
    const choice = generatedChoice(-6.0206);
    const files = await musicPreflight(choice, {
      referenceAudio: referenceFile(null),
      generatedMusic: async () => ok(warped),
    });
    if (!files.ok) throw new Error(files.error.code);
    const plain = planOf({ items: [{ frames: 90, muted: true }], music: choice });
    // A 0.5 s intro and a 0.5 s outro bumper (P3-V10): the timeline runs on frames 15 to 75.
    const plan = {
      ...plain,
      bumpers: { ...NO_BUMPERS, intro: { start: 0, end: 15 }, outro: { start: 75, end: 90 } },
    };
    const mix = planAudioMix(plan, { ...clipSources(), ...musicSources(files.value) });
    if (!mix.ok) throw new Error(mix.error.code);
    expect(mix.value.segments).toMatchObject([
      { kind: 'music', startSample: 24_000, samples: 96_000, inSample: 0 },
    ]);
    const wav = await renderMix(mix.value, ctx, { out: join(work.dir, 'c.wav') });
    if (!wav.ok) throw new Error(wav.error.code);
    const pcm = await decodePcm(ctx, wav.value.path);
    expect(pcm.length).toBe(144_000);
    // Silent through the intro, the pulse on the timeline's first sample, at the choice's gain (−6 dB).
    expect(peak(pcm, 0, 24_000)).toBe(0);
    expect(onset(pcm, 0.05)).toBe(24_000);
    expect(pcm[24_010]!).toBeCloseTo(0.5, 3);
    expect(pcm[60_000]!).toBeCloseTo(0.1, 3);
    // And gone where the outro starts.
    expect(peak(pcm, 120_000)).toBe(0);
  });
});
