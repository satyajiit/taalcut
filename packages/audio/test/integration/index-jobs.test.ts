// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The indexing kinds on real files: a clip of macOS `say` speech muxed into
 * a video, a silent clip and a tone nobody speaks over. Language id and
 * transcription run whisper.cpp on Metal from one audio pass the two stages
 * share (IX-A1), removed when the transcript is done. With whisper-server
 * built, the persistent path must give the CLI path's words, times included
 * (IX-A3). Needs FFmpeg, whisper-cli and the tiny and small models (the audio
 * cache, tools/whisper/dist, or the developer component cache), and Silero
 * VAD for the tone; without them those cases skip and say why. The silent
 * case needs FFmpeg only.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createDirectJobRunner, type Transcript } from '@taalcut/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  audioIdentifyLanguageJob,
  audioTranscribeAssetWhisperJob,
  createAssetAudioStore,
  createAudioIndexJobs,
  createSileroVad,
  createWhisperServerPool,
  freeLoopbackPort,
  posixServerSpawn,
  type AssetAudioStore,
  type AudioIndexJobDeps,
  type WhisperDecoder,
} from '../../src';
import { testMedia } from '../helpers/ffmpeg';
import { whisperTools } from '../helpers/whisper';

const run = promisify(execFile);

const media = await testMedia('audio index jobs');
const tools = await whisperTools();
const whisper = { binary: tools.cli, tiny: tools.tiny, small: tools.small, medium: '' };
const { server, vad: vadModel } = tools;
const live = media.ctx && whisper.binary && whisper.tiny && whisper.small;
const liveSkip = live
  ? ''
  : `audio index jobs: live cases skipped (whisper-cli, ggml-tiny or ggml-small missing)`;
if (liveSkip) console.warn(liveSkip);

let dir = '';
let speech = '';
let silent = '';
let tone = '';
let store: AssetAudioStore;

beforeAll(async () => {
  if (!media.ctx) return;
  dir = await mkdtemp(join(tmpdir(), 'taalcut-audio-index-'));
  store = createAssetAudioStore({ parent: join(dir, 'store') });
  const ffmpeg = media.ctx.binaries.ffmpeg;
  tone = join(dir, 'tone.m4a');
  await run(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:r=48000', '-t', '6', tone]);
  silent = join(dir, 'silent.mp4');
  await run(ffmpeg, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=48000:cl=mono',
    '-t',
    '4',
    '-c:a',
    'aac',
    silent,
  ]);
  if (!live) return;
  const aiff = join(dir, 'speech.aiff');
  await run('/usr/bin/say', [
    '-v',
    'Samantha',
    '-o',
    aiff,
    'The old lighthouse was still blinking over the grey water at dawn.',
  ]);
  speech = join(dir, 'speech.mp4');
  // Video plus speech whose audio stream starts two seconds after the picture: the WAV is padded to the
  // video's start and the small model's DTW times put the first word there (token offsets said 0).
  await run(ffmpeg, [
    ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-itsoffset', '2'],
    ...['-i', aiff, '-map', '0:v', '-map', '1:a', '-t', '8', '-c:v', 'mpeg4', '-c:a', 'aac', speech],
  ]);
}, 60_000);

afterAll(async () => {
  await store?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

function deps(extra: Partial<AudioIndexJobDeps> = {}): AudioIndexJobDeps {
  return {
    store,
    ...extra,
    media: media.ctx!,
    settings: { hasSpeechUploadConsent: () => false, localOnly: () => true, tier: () => 'minimum' },
    whisper,
    beats: {
      onnx: {
        openSession: async () => ({ ok: false, error: { code: 'x', messageKey: 'x', retryable: false } }),
      },
      modelDir: '',
    },
  };
}

describe.skipIf(!media.ctx)('audio indexing kinds', () => {
  it('calls a file with no sound silent, without running whisper', async () => {
    const runner = createDirectJobRunner(createAudioIndexJobs(deps()));
    const out = await runner.run(audioIdentifyLanguageJob, { path: silent });
    expect(out).toMatchObject({
      ok: true,
      value: { silent: true, detected: { language: null, perSlice: [] } },
    });
  });

  it.skipIf(!vadModel)(
    'calls a tone nobody speaks over silent, after a voice scan and no whisper',
    async () => {
      const vad = createSileroVad({ modelPath: vadModel });
      const runner = createDirectJobRunner(createAudioIndexJobs(deps({ vad })));
      const out = await runner.run(audioIdentifyLanguageJob, { path: tone });
      expect(out).toMatchObject({
        ok: true,
        value: { silent: true, detected: { language: null }, speech: { detector: 'silero', complete: true } },
      });
      if (out.ok) expect(out.value.measure.nonSilentMs).toBeGreaterThan(5000);
      expect(store.stats().entries).toBe(0);
    },
  );

  it.skipIf(!live)(
    'identifies English and transcribes it with whisper from one decode, then removes the PCM',
    async () => {
      const before = store.stats();
      const transcript = await identifyThenTranscribe(deps());
      expect(transcript).toMatchObject({ engine: 'whisper', local: true, language: 'en' });
      const text = transcript.segments
        .map((s) => s.text)
        .join(' ')
        .toLowerCase();
      expect(text).toContain('lighthouse');
      // Speech starts two seconds into the picture: so does the first word.
      const firstWord = transcript.segments[0]?.words[0];
      expect(firstWord && firstWord.range.start.value / firstWord.range.start.rate.num).toBeGreaterThan(1);
      const after = store.stats();
      expect(after.passes - before.passes).toBe(1);
      expect(after.reused - before.reused).toBe(1);
      expect(after.entries).toBe(0);
    },
    120_000,
  );

  it.skipIf(!live || !server)(
    'gives the same words and times from the persistent whisper-server as from whisper-cli',
    async () => {
      const pool = createWhisperServerPool({
        launch: { spawn: posixServerSpawn, fetch, freePort: freeLoopbackPort, workDir: dir },
        accelerator: 'metal',
      });
      try {
        const decoder: WhisperDecoder = pool.decoder(server);
        const cli = await identifyThenTranscribe(deps());
        const persistent = await identifyThenTranscribe(deps({ decoder }));
        expect(persistent.segments.flatMap((s) => s.words)).toEqual(cli.segments.flatMap((s) => s.words));
        expect(persistent.segments.map((s) => s.text)).toEqual(cli.segments.map((s) => s.text));
        // Language ID (tiny) and the transcript (small): one load each, however many calls.
        await identifyThenTranscribe(deps({ decoder }));
        expect(pool.stats()).toMatchObject({ launches: 2, requests: 4 });
      } finally {
        await pool.close();
      }
    },
    180_000,
  );
});

async function identifyThenTranscribe(jobDeps: AudioIndexJobDeps): Promise<Transcript> {
  const runner = createDirectJobRunner(createAudioIndexJobs(jobDeps));
  const identified = await runner.run(audioIdentifyLanguageJob, { path: speech });
  expect(identified).toMatchObject({ ok: true, value: { silent: false, detected: { language: 'en' } } });
  if (!identified.ok) throw new Error(identified.error.code);
  const transcript = await runner.run(audioTranscribeAssetWhisperJob, {
    path: speech,
    perSlice: identified.value.detected.perSlice,
    language: identified.value.detected.language,
  });
  if (!transcript.ok) throw new Error(`${transcript.error.code} ${transcript.error.detail ?? ''}`);
  return transcript.value;
}
