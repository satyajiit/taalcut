// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Decoding to PCM with the bundled FFmpeg. `decodeAudioFile` reads an audio file as it is (generated voice
 * lines and music, stems render wrote): no video clock to align to. `decodeClipSpeech` reads a clip's sound
 * the way transcripts were made (media's extractAudio after the normalisation plan, mono, aligned to the
 * video start), so word times and voice activity share one clock.
 */
import { CancelledError, err, ok, type AsyncResult } from '@taalcut/core';
import { extractAudio, runFfmpeg, type MediaContext } from '@taalcut/media';
import { audioNormalisation } from '../probe-plan';
import { fromInterleaved, type Pcm } from './pcm';

/** Generous: ten minutes of 48 kHz stereo float. */
const MAX_PCM_BYTES = 10 * 60 * 48_000 * 2 * 4;

export interface DecodeAudioOptions {
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  readonly signal?: AbortSignal;
}

export async function decodeAudioFile(
  path: string,
  media: MediaContext,
  options: DecodeAudioOptions,
): AsyncResult<Pcm> {
  if (options.signal?.aborted) return err(CancelledError());
  const args = [
    '-nostdin',
    '-i',
    path,
    '-vn',
    '-ac',
    String(options.channels),
    '-ar',
    String(options.sampleRate),
    '-f',
    'f32le',
    '-acodec',
    'pcm_f32le',
    'pipe:1',
  ];
  const run = await runFfmpeg(media, args, {
    // Audio only: a stop keeps SIGTERM then SIGKILL (IX3-K2).
    holdsVideoSession: false,
    maxStdoutBytes: MAX_PCM_BYTES,
    timeoutMs: 180_000,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!run.ok) return run;
  return ok(fromInterleaved(run.value.stdout, options.channels, options.sampleRate));
}

export async function decodeClipSpeech(
  path: string,
  media: MediaContext,
  options: { readonly sampleRate: number; readonly signal?: AbortSignal },
): AsyncResult<Pcm> {
  const plan = await audioNormalisation(path, media, options.signal);
  if (!plan.ok) return plan;
  const chunks: Buffer[] = [];
  const extracted = await extractAudio(path, plan.value, media, {
    sampleRate: options.sampleRate,
    format: 'f32le',
    onChunk: (chunk) => chunks.push(chunk),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!extracted.ok) return extracted;
  return ok(fromInterleaved(Buffer.concat(chunks), 1, options.sampleRate));
}
