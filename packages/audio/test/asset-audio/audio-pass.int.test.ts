// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The one-decode audio pass against what it replaces (IX-A1): its WAV holds exactly the samples media's
 * extractAudio wrote for whisper (so transcripts can't move), its loudness is measureLoudness's, and its silences
 * are silencedetect's, moved onto the asset clock. Real FFmpeg, fixtures made here.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FrameRate, RationalTime } from '@taalcut/core';
import { extractAudio, measureLoudness, runFfmpeg, type MediaContext } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAudioPass, silencesOnAssetClock } from '../../src/asset-audio/audio-pass';
import { readSpeechPcm } from '../../src/asset-audio/wav-file';
import { detectSilences } from '../../src/measure/silence';
import { audioNormalisation } from '../../src/probe-plan';
import { testMedia } from '../helpers/ffmpeg';

const media = await testMedia('audio pass');
const MS = FrameRate.of(1000, 1);
let dir = '';
/** Picture, and a sound that starts 0.5 s after it: bursts of tone with gaps, stereo 48 kHz AAC. */
let video = '';
let picture = '';

const BURSTS =
  'aevalsrc=0.3*sin(2*PI*330*t)*lt(mod(t\\,2)\\,1.2)|0.2*sin(2*PI*440*t)*lt(mod(t\\,2)\\,1.2):s=48000:d=7';

async function render(ctx: MediaContext, args: readonly string[]): Promise<void> {
  const made = await runFfmpeg(ctx, ['-y', ...args]);
  if (!made.ok) throw new Error(made.error.detail ?? made.error.code);
}

beforeAll(async () => {
  if (!media.ctx) return;
  dir = await mkdtemp(join(tmpdir(), 'taalcut-audio-pass-'));
  video = join(dir, 'late-sound.mp4');
  await render(media.ctx, [
    ...[
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x120:rate=30',
      '-itsoffset',
      '0.5',
      '-f',
      'lavfi',
      '-i',
      BURSTS,
    ],
    ...['-map', '0:v', '-map', '1:a', '-t', '7', '-c:v', 'mpeg4', '-c:a', 'aac', video],
  ]);
  picture = join(dir, 'no-sound.mp4');
  await render(media.ctx, [
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=160x120:rate=30',
    '-t',
    '1',
    '-c:v',
    'mpeg4',
    picture,
  ]);
}, 60_000);

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

function samples(bytes: Buffer, offset: number): Int16Array {
  const body = bytes.subarray(offset);
  return new Int16Array(body.buffer, body.byteOffset, Math.floor(body.length / 2));
}

describe.skipIf(!media.ctx)('audio pass', () => {
  it('writes the very samples extractAudio wrote, and measures what the separate passes measured', async () => {
    const ctx = media.ctx!;
    const plan = await audioNormalisation(video, ctx);
    if (!plan.ok) throw new Error(plan.error.code);
    const before = join(dir, 'extract.wav');
    const extracted = await extractAudio(video, plan.value, ctx, {
      sampleRate: 16_000,
      format: 'wav16',
      out: before,
    });
    expect(extracted.ok).toBe(true);
    const pass = await runAudioPass({ path: video, plan: plan.value, out: join(dir, 'pass.wav') }, ctx);
    if (!pass.ok) throw new Error(pass.error.detail ?? pass.error.code);

    const old = await readSpeechPcm(before);
    if (!old.ok) throw new Error(old.error.code);
    const oldSamples = samples(await readFile(before), old.value.dataOffset);
    const newSamples = samples(await readFile(pass.value.pcm.path), pass.value.pcm.dataOffset);
    expect(newSamples.length).toBe(oldSamples.length);
    expect(
      Buffer.compare(
        Buffer.from(newSamples.buffer, newSamples.byteOffset, newSamples.byteLength),
        Buffer.from(oldSamples.buffer, oldSamples.byteOffset, oldSamples.byteLength),
      ),
    ).toBe(0);

    const loudness = await measureLoudness(video, ctx);
    if (!loudness.ok) throw new Error(loudness.error.code);
    expect(pass.value.loudness.integratedLufs).toBeCloseTo(loudness.value.integratedLufs, 1);
    expect(pass.value.loudness.truePeakDbtp).toBeCloseTo(loudness.value.truePeakDbtp, 1);

    // silencedetect on the file clock (the sound's timestamps already start at 0.5 s); the pad before it is a
    // silence on the asset clock too.
    const separate = await detectSilences(ctx, video);
    if (!separate.ok) throw new Error(separate.error.code);
    // The plan's offset is the sound's start (0.5 s less the AAC encoder's priming).
    const offsetMs = Math.round(
      RationalTime.toSeconds(plan.value.audio?.offset ?? RationalTime.of(0, MS)) * 1000,
    );
    expect(offsetMs).toBeGreaterThan(450);
    const expected = [
      { startMs: 0, endMs: offsetMs },
      ...silencesOnAssetClock(separate.value.silences, 0, pass.value.pcm.durationMs),
    ];
    expect(pass.value.silences.length).toBe(expected.length);
    for (const [i, silence] of pass.value.silences.entries()) {
      expect(Math.abs(silence.startMs - (expected[i]?.startMs ?? 0))).toBeLessThanOrEqual(30);
      expect(Math.abs(silence.endMs - (expected[i]?.endMs ?? 0))).toBeLessThanOrEqual(30);
    }
    expect(pass.value.silences[0]).toEqual({ startMs: 0, endMs: offsetMs });
  });

  it('says a file without sound has no audio', async () => {
    const ctx = media.ctx!;
    const plan = await audioNormalisation(picture, ctx);
    expect(plan.ok ? 'planned' : plan.error.code).toBe('audio.no_audio');
  });
});

describe('silences on the asset clock', () => {
  it('shifts by the offset, clamps to the PCM and adds the pad before a late start', () => {
    const logged = [
      { startMs: 0, endMs: 300 },
      { startMs: 4000, endMs: 9000 },
    ];
    expect(silencesOnAssetClock(logged, 500, 6000)).toEqual([
      { startMs: 0, endMs: 500 },
      { startMs: 500, endMs: 800 },
      { startMs: 4500, endMs: 6000 },
    ]);
    expect(silencesOnAssetClock(logged, -200, 6000)).toEqual([
      { startMs: 0, endMs: 100 },
      { startMs: 3800, endMs: 6000 },
    ]);
  });
});
