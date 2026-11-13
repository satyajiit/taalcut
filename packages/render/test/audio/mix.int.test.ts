// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * mixAudio with the bundled FFmpeg (P2-M10, SPEC section 8): sample-exact
 * placement, exact length, −14 LUFS after two passes, true peak under the
 * ceiling, the silent track, gains summed without normalising, and the mux.
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, RationalTime, type ComputeFallbackEvent } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { createAudioFallbackReporter, measureLoudness } from '../../src/audio/loudness';
import { mixAudio, muxAudio, renderMix, renormaliseAudio } from '../../src/audio/mix';
import { planAudioMix, type AudioMixPlan, type AudioSourceMap } from '../../src/audio/mix-plan';
import { ffmpeg, findTestMedia, mediaContext, probeJson, tempDir } from '../support/media';
import { bestLag, decodePcm, evalWav, onset, peak, planOf, pulseAt, rms } from './helpers';
import { FIXTURE_H264 } from '../support/host-video';

const media = await findTestMedia('render mix');
const hz = FrameRate.of(48000);
const target = { integratedLufs: -14, truePeakDbtp: -1 };
const fixed = (path: string, offset = 0): AudioSourceMap => ({
  clip: () => ({ path, offset: RationalTime.of(offset, hz) }),
});

function mixOf(plan: ReturnType<typeof planOf>, sources: AudioSourceMap): AudioMixPlan {
  const mix = planAudioMix(plan, sources);
  if (!mix.ok) throw new Error(mix.error.code);
  return mix.value;
}

describe.skipIf(!media.binaries)('mixAudio', () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let sine: string;
  let speech: string;

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('mix');
    sine = join(work.dir, 'sine.m4a');
    await ffmpeg(ctx, [
      '-f',
      'lavfi',
      '-i',
      'sine=f=1000:r=48000:d=12',
      '-af',
      'volume=-14dB',
      '-ac',
      '2',
      '-c:a',
      'aac',
      sine,
    ]);
    // Speech-like: pink noise with a syllable-rate envelope and pauses.
    speech = join(work.dir, 'speech.m4a');
    await ffmpeg(ctx, [
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=c=pink:a=0.25:r=48000:d=12:s=7',
      '-af',
      "volume='0.15+0.85*abs(sin(2*PI*2.5*t))*gte(sin(2*PI*0.4*t),-0.6)':eval=frame,lowpass=f=4000",
      '-ac',
      '2',
      '-c:a',
      'aac',
      speech,
    ]);
  });
  afterAll(() => work?.dispose());

  it('places each clip on its exact samples and lasts exactly the plan', async () => {
    const first = await evalWav(ctx, work.dir, 'first', pulseAt(6000), 60_000);
    const second = await evalWav(ctx, work.dir, 'second', pulseAt(20_000), 80_000);
    const plan = planOf({ items: [{ frames: 30 }, { frames: 30 }] });
    const ids = plan.audio.map((clip) => clip.id);
    const mix = mixOf(plan, {
      clip: (id) =>
        id === ids[0]
          ? { path: first, offset: RationalTime.of(0, hz) }
          : { path: second, offset: RationalTime.of(4800, hz) },
    });
    const wav = await renderMix(mix, ctx, { out: join(work.dir, 'exact.wav') });
    if (!wav.ok) throw new Error(wav.error.code);
    const pcm = await decodePcm(ctx, wav.value.path);
    expect(pcm.length).toBe(96_000);
    expect(onset(pcm, 0.25)).toBe(6000);
    // Clip two starts at sample 48000 with its file read from 4800: 48000 + 20000 − 4800.
    expect(onset(pcm, 0.25, 7000)).toBe(63_200);
  });

  it('keeps alignment and exact length through loudnorm and the AAC edit list', async () => {
    const bed = '0.03*sin(2*PI*220*n/48000)';
    const source = await evalWav(
      ctx,
      work.dir,
      'bed',
      `${pulseAt(9000, 0.08, 480, bed)}+${pulseAt(51_000, 0.08, 480, '0')}`,
      96_000,
    );
    const plan = planOf({ items: [{ frames: 60 }] });
    const mix = mixOf(plan, fixed(source));
    const reference = await renderMix(mix, ctx, { out: join(work.dir, 'bed-mix.wav') });
    const out = await mixAudio(mix, ctx, {
      out: join(work.dir, 'bed.m4a'),
      loudness: target,
      bitrateKbps: 192,
      sampleRate: 48000,
    });
    if (!reference.ok || !out.ok) throw new Error('mix failed');
    const [before, after] = await Promise.all([
      decodePcm(ctx, reference.value.path),
      decodePcm(ctx, out.value.path),
    ]);
    expect(after.length).toBe(96_000);
    expect(out.value.samples).toBe(96_000);
    const { lag, score } = bestLag(before, after, 64);
    expect(lag).toBe(0);
    expect(score).toBeGreaterThan(0.95);
  });

  it('lands a sine at −14 LUFS ± 0.5 with true peak at or under −1 dBTP', async () => {
    const plan = planOf({ items: [{ frames: 300 }] });
    const progress: number[] = [];
    const out = await mixAudio(mixOf(plan, fixed(sine)), ctx, {
      out: join(work.dir, 'sine-mix.m4a'),
      loudness: target,
      bitrateKbps: 192,
      sampleRate: 48000,
      onProgress: (fraction) => progress.push(fraction),
    });
    if (!out.ok) throw new Error(out.error.code);
    const measured = out.value.measured!;
    expect(Math.abs(measured.integratedLufs + 14)).toBeLessThanOrEqual(0.5);
    expect(measured.truePeakDbtp).toBeLessThanOrEqual(-1);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1]!)).toBe(true);
  });

  it('lands speech-like noise at −14 LUFS ± 0.5 with true peak at or under −1 dBTP', async () => {
    const plan = planOf({ items: [{ frames: 300 }] });
    const out = await mixAudio(mixOf(plan, fixed(speech)), ctx, {
      out: join(work.dir, 'speech-mix.m4a'),
      loudness: target,
      bitrateKbps: 192,
      sampleRate: 48000,
    });
    if (!out.ok) throw new Error(out.error.code);
    const measured = out.value.measured!;
    expect(Math.abs(measured.integratedLufs + 14)).toBeLessThanOrEqual(0.5);
    expect(measured.truePeakDbtp).toBeLessThanOrEqual(-1);
  });

  it('writes a silent track of exact length and skips loudness when silence is the plan', async () => {
    const plan = planOf({ rate: FrameRate.of(30000, 1001), items: [{ frames: 89, muted: true }] });
    const mix = mixOf(plan, fixed(sine));
    expect(mix.silent).toBe(true);
    const out = await mixAudio(mix, ctx, {
      out: join(work.dir, 'silent.m4a'),
      loudness: target,
      bitrateKbps: 192,
      sampleRate: 48000,
    });
    if (!out.ok) throw new Error(out.error.code);
    const pcm = await decodePcm(ctx, out.value.path);
    expect(out.value.measured).toBeNull();
    expect(pcm.length).toBe(Math.round((89 * 48000 * 1001) / 30000));
    expect(peak(pcm)).toBe(0);
  });

  it('sums overlapping sound at its gains (amix normalize=0)', async () => {
    const tone = await evalWav(ctx, work.dir, 'tone', '0.2*sin(2*PI*500*n/48000)', 60_000);
    const base = planOf({ items: [{ frames: 30 }], audioTracks: [[{ frames: 30 }]] });
    const plan = {
      ...base,
      audio: base.audio.map((clip) => (clip.track === 'A1' ? { ...clip, gainDb: -6.0206 } : clip)),
    };
    const wav = await renderMix(mixOf(plan, fixed(tone)), ctx, { out: join(work.dir, 'sum.wav') });
    if (!wav.ok) throw new Error(wav.error.code);
    const pcm = await decodePcm(ctx, wav.value.path);
    // 0.2 + 0.1 in phase; amix's default normalisation would have halved it.
    expect(peak(pcm, 1000, 47_000)).toBeCloseTo(0.3, 2);
    expect(rms(pcm, 1000, 47_000)).toBeCloseTo(0.3 / Math.SQRT2, 2);
  });

  it('renormalises a quiet track and muxes it under a picture from zero', async () => {
    const quiet = join(work.dir, 'quiet.m4a');
    await ffmpeg(ctx, ['-i', sine, '-af', 'volume=-10dB,atrim=end_sample=144000', '-c:a', 'aac', quiet]);
    const before = await measureLoudness(ctx, quiet);
    if (!before.ok) throw new Error(before.error.code);
    expect(before.value.integratedLufs).toBeLessThan(-20);
    const fixedTrack = await renormaliseAudio(quiet, ctx, {
      out: join(work.dir, 'renormalised.m4a'),
      loudness: target,
      bitrateKbps: 192,
      samples: 144_000,
    });
    if (!fixedTrack.ok) throw new Error(fixedTrack.error.code);
    expect(Math.abs(fixedTrack.value.measured!.integratedLufs + 14)).toBeLessThanOrEqual(0.5);

    const picture = join(work.dir, 'picture.mp4');
    await ffmpeg(ctx, [
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=64x64:r=30:d=3',
      '-c:v',
      FIXTURE_H264,
      '-b:v',
      '1M',
      picture,
    ]);
    const muxed = await muxAudio(picture, fixedTrack.value.path, join(work.dir, 'muxed.mp4'), ctx);
    if (!muxed.ok) throw new Error(muxed.error.code);
    const probe = (await probeJson(
      ctx,
      muxed.value.path,
      'stream=codec_type,start_time,sample_rate,channels',
    )) as {
      streams: { codec_type: string; start_time: string; sample_rate?: string; channels?: number }[];
    };
    const audio = probe.streams.find((stream) => stream.codec_type === 'audio')!;
    const video = probe.streams.find((stream) => stream.codec_type === 'video')!;
    expect(Number(audio.start_time)).toBe(0);
    expect(Number(video.start_time)).toBe(0);
    expect(audio).toMatchObject({ sample_rate: '48000', channels: 2 });
    expect((await decodePcm(ctx, muxed.value.path)).length).toBe(144_000);
  });

  it('reports the CPU audio path once per reporter', () => {
    const events: ComputeFallbackEvent[] = [];
    const report = createAudioFallbackReporter((event) => events.push(event), 'darwin');
    report();
    report();
    expect(events).toEqual([
      expect.objectContaining({ operation: 'render.audioMix', reason: 'no_accelerator', wanted: ['metal'] }),
    ]);
    const linux: ComputeFallbackEvent[] = [];
    createAudioFallbackReporter((event) => linux.push(event), 'linux')();
    expect(linux).toEqual([expect.objectContaining({ operation: 'render.audioMix', wanted: ['vulkan'] })]);
  });
});
