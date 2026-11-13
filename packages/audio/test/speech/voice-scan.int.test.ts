// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The voice scan with the real Silero VAD (IX-A2): speech under a music bed is still heard as speech (so its
 * language ID and transcript run), and a music bed alone holds less voice than LANGUAGE_WINDOW.minSpeechMs
 * (so the asset is silent and whisper never hallucinates words into it). Needs FFmpeg, `say` and the silero-vad
 * model; skips and says why without them.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFfmpeg } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readSpeechPcm, type SpeechPcm } from '../../src/asset-audio/wav-file';
import { createSileroVad, type VadEngine } from '../../src/cleanup/vad';
import { LANGUAGE_WINDOW } from '../../src/config';
import { scanSpeech } from '../../src/speech/speech-scan';
import { testMedia } from '../helpers/ffmpeg';
import { chordPad, sayToWav } from '../helpers/speech';
import { whisperTools } from '../helpers/whisper';

const media = await testMedia('voice scan');
const { vad: model } = await whisperTools();
const skip = !media.ctx || !model ? 'voice scan: skipped (FFmpeg or silero_vad.onnx missing)' : '';
if (skip) console.warn(skip);

let dir = '';
let vad: VadEngine;

beforeAll(async () => {
  if (skip) return;
  dir = await mkdtemp(join(tmpdir(), 'taalcut-voice-scan-'));
  vad = createSileroVad({ modelPath: model });
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** The inputs mixed (each at its gain) into the 16 kHz mono speech PCM the audio pass writes. */
async function speechPcm(
  name: string,
  inputs: readonly { path: string; gain: number }[],
): Promise<SpeechPcm> {
  const ctx = media.ctx;
  if (!ctx) throw new Error('no FFmpeg');
  const out = join(dir, `${name}.wav`);
  const gains = inputs.map((input, i) => `[${i}:a]volume=${input.gain}[g${i}]`).join(';');
  const mix = `${inputs.map((_, i) => `[g${i}]`).join('')}amix=inputs=${inputs.length}:duration=longest:normalize=0`;
  const made = await runFfmpeg(ctx, [
    '-nostdin',
    '-y',
    ...inputs.flatMap((input) => ['-i', input.path]),
    '-filter_complex',
    `${gains};${mix}`,
    ...['-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out],
  ]);
  if (!made.ok) throw new Error(`mix failed: ${made.error.detail ?? ''}`);
  const pcm = await readSpeechPcm(out);
  if (!pcm.ok) throw new Error(pcm.error.code);
  return pcm.value;
}

function scanAll(pcm: SpeechPcm) {
  const { windowMs, enoughSpeechMs, padMs } = LANGUAGE_WINDOW;
  return scanSpeech(pcm, vad, {
    regions: [{ startMs: 0, endMs: pcm.durationMs }],
    windowMs,
    enoughSpeechMs,
    padMs,
  });
}

describe.skipIf(Boolean(skip))('voice scan with Silero', () => {
  it('hears speech under a music bed, and no one in the bed alone', async () => {
    const ctx = media.ctx;
    if (!ctx) return;
    const speech = await sayToWav(
      ctx,
      dir,
      'speech',
      'Welcome back to the workshop. Today we are going to sand the table top, oil it twice, and leave it to dry overnight before the legs go on.',
      { voice: 'Samantha', leadMs: 1500 },
    );
    const pad = await chordPad(ctx, dir, 12);

    const voiceOverMusic = await scanAll(
      await speechPcm('voice-over-music', [
        { path: speech, gain: 1 },
        { path: pad, gain: 0.35 },
      ]),
    );
    const music = await scanAll(await speechPcm('music', [{ path: pad, gain: 1 }]));

    if (!voiceOverMusic.ok || !music.ok) throw new Error('scan failed');
    expect(voiceOverMusic.value.speechMs).toBeGreaterThan(4 * LANGUAGE_WINDOW.minSpeechMs);
    expect(voiceOverMusic.value.window?.startMs).toBeGreaterThanOrEqual(1000);
    expect(music.value).toMatchObject({ complete: true, window: null });
    expect(music.value.speechMs).toBeLessThan(LANGUAGE_WINDOW.minSpeechMs);
  }, 120_000);
});
