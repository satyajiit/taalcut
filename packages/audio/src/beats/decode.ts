// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * PCM for the beat tracker. A path is media's `extractAudio` at 22.05 kHz
 * mono f32le. In-memory samples are already that rate and stay in process.
 */
import { CancelledError, err, ok, type AsyncResult, type TimeRange } from '@taalcut/core';
import { extractAudio, type MediaContext } from '@taalcut/media';
import { AUDIO_CONFIG } from '../config';
import { BeatTrackingFailed } from '../errors';
import { audioNormalisation } from '../probe-plan';
import { msTime, rangeToMs } from '../rates';
import type { BeatAudio } from './types';

const RATE = AUDIO_CONFIG.beats.sampleRate;

export interface DecodedBeatAudio {
  readonly samples: Float32Array;
  /** Milliseconds to add so beat times sit on the asset clock. */
  readonly shiftMs: number;
}

export interface DecodeOptions {
  readonly signal?: AbortSignal;
  readonly range?: TimeRange;
  readonly media?: MediaContext;
}

export async function decodeBeatAudio(
  audio: BeatAudio,
  options?: DecodeOptions,
): AsyncResult<DecodedBeatAudio> {
  if (options?.signal?.aborted) return err(CancelledError());
  if (audio instanceof Float32Array) return ok(limit(audio, RATE, options?.range));
  return decodePath(audio.path, options);
}

function limit(samples: Float32Array, sampleRate: number, range?: TimeRange): DecodedBeatAudio {
  const maxSamples = Math.round((AUDIO_CONFIG.beats.maxTrackMs * sampleRate) / 1000);
  let shiftMs = 0;
  let view = samples;
  if (range) {
    const { startMs, endMs } = rangeToMs(range);
    shiftMs = Math.max(0, startMs);
    const start = Math.max(0, Math.round((startMs * sampleRate) / 1000));
    const end = Math.max(start, Math.round((endMs * sampleRate) / 1000));
    view = samples.subarray(Math.min(start, samples.length), Math.min(end, samples.length));
  }
  if (view.length > maxSamples) view = view.subarray(0, maxSamples);
  const copy = new Float32Array(view.length);
  copy.set(view);
  return { samples: resample(copy, sampleRate, RATE), shiftMs };
}

async function decodePath(path: string, options?: DecodeOptions): AsyncResult<DecodedBeatAudio> {
  if (!options?.media) {
    return err(BeatTrackingFailed(undefined, { detail: 'a media context is required to read a file' }));
  }
  const plan = await audioNormalisation(path, options.media, options.signal);
  if (!plan.ok) {
    if (plan.error.code === 'audio.no_audio') return plan;
    return err(
      BeatTrackingFailed(undefined, { detail: (plan.error.detail ?? plan.error.code).slice(0, 500) }),
    );
  }
  const span = options.range ? rangeToMs(options.range) : undefined;
  const chunks: Buffer[] = [];
  const extracted = await extractAudio(path, plan.value, options.media, {
    sampleRate: RATE,
    format: 'f32le',
    onChunk: (chunk) => chunks.push(chunk),
    ...(span
      ? { range: { start: msTime(span.startMs), duration: msTime(Math.max(0, span.endMs - span.startMs)) } }
      : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!extracted.ok) {
    return err(
      BeatTrackingFailed(undefined, {
        detail: (extracted.error.detail ?? extracted.error.code).slice(0, 500),
      }),
    );
  }
  const shiftMs = span ? Math.max(0, span.startMs) : 0;
  return ok(cap(f32le(chunks), shiftMs));
}

function f32le(chunks: readonly Buffer[]): Float32Array {
  const bytes = Buffer.concat(chunks);
  const length = bytes.length - (bytes.length % 4);
  const copy = new ArrayBuffer(length);
  new Uint8Array(copy).set(bytes.subarray(0, length));
  return new Float32Array(copy);
}

function cap(samples: Float32Array, shiftMs: number): DecodedBeatAudio {
  const maxSamples = Math.round((AUDIO_CONFIG.beats.maxTrackMs * RATE) / 1000);
  const view = samples.length > maxSamples ? samples.subarray(0, maxSamples) : samples;
  const copy = new Float32Array(view.length);
  copy.set(view);
  return { samples: copy, shiftMs };
}

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (input.length === 0 || fromRate === toRate) return input;
  const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(outLen);
  const scale = fromRate / toRate;
  for (let i = 0; i < outLen; i++) {
    const pos = i * scale;
    const index = Math.floor(pos);
    const frac = pos - index;
    const left = input[index] ?? 0;
    const right = input[index + 1] ?? left;
    out[i] = left + (right - left) * frac;
  }
  return out;
}
