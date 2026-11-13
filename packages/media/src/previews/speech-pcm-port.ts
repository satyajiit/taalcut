// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One audio decode per asset (IX-D4, with the audio lane): the waveform's
 * peaks come from the 16 kHz mono speech PCM the audio pass writes for
 * language ID and transcription, instead of a second decode of the asset's
 * audio. Media defines the port and the peaks (it can't import audio); audio
 * implements the port with its asset audio store, which takes each video's
 * peaks when its pass runs and keeps them until the waveform asks, so the
 * PCM's own lifetime (language ID to transcript) doesn't matter; the app
 * wires it into the media service. Without a port, or when it has no peaks,
 * the waveform decodes the audio itself.
 */
import { open } from 'node:fs/promises';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { FfmpegFailed } from '../errors';
import type { MediaContext } from '../ffmpeg';
import type { NormalisationPlan } from '../normalise/types';
import { WAVEFORM_BUCKETS_PER_SEC, WAVEFORM_VERSION } from './peaks';

/** The audio pass's speech PCM: a 16 kHz mono s16le WAV on the asset clock (silence before a late audio start included). */
export interface SpeechPcmFile {
  readonly path: string;
  /** Byte offset of the first sample. */
  readonly dataOffset: number;
  readonly frames: number;
}

export interface SpeechPcmPort {
  /** The asset's waveform peaks (peaks.ts's format) from its audio pass: kept since the pass ran, or a new pass. */
  peaks(
    asset: { readonly path: string; readonly contentHash?: string; readonly plan: NormalisationPlan },
    ctx: MediaContext,
    signal?: AbortSignal,
  ): AsyncResult<Buffer>;
}

export const SPEECH_PCM_RATE = 16_000;
/** Samples read per chunk: peaks stream through the file, an hour of audio never sits in memory. */
const CHUNK_BUCKETS = 4096;

/**
 * Waveform peaks (peaks.ts's format) from the PCM's samples: min and max of
 * every 10 ms of the 16 kHz signal. The 8 kHz path resamples first, so the
 * bars match it within a few percent of full scale, not bit for bit.
 */
export async function peaksFromSpeechPcm(pcm: SpeechPcmFile): AsyncResult<Buffer> {
  const perBucket = SPEECH_PCM_RATE / WAVEFORM_BUCKETS_PER_SEC;
  const count = Math.max(1, Math.ceil(pcm.frames / perBucket));
  const body = Buffer.alloc(12 + count * 4);
  body.writeUInt32LE(WAVEFORM_VERSION, 0);
  body.writeUInt32LE(WAVEFORM_BUCKETS_PER_SEC, 4);
  body.writeUInt32LE(count, 8);
  try {
    const handle = await open(pcm.path, 'r');
    try {
      const chunk = Buffer.alloc(CHUNK_BUCKETS * perBucket * 2);
      for (let first = 0; first < count; first += CHUNK_BUCKETS) {
        const startFrame = first * perBucket;
        const frames = Math.min(CHUNK_BUCKETS * perBucket, pcm.frames - startFrame);
        const { bytesRead } = await handle.read(chunk, 0, frames * 2, pcm.dataOffset + startFrame * 2);
        const samples = Math.floor(bytesRead / 2);
        for (let bucket = 0; bucket * perBucket < samples; bucket++) {
          const from = bucket * perBucket;
          const to = Math.min(samples, from + perBucket);
          let min = chunk.readInt16LE(from * 2);
          let max = min;
          for (let i = from + 1; i < to; i++) {
            const value = chunk.readInt16LE(i * 2);
            if (value < min) min = value;
            if (value > max) max = value;
          }
          body.writeInt16LE(min, 12 + (first + bucket) * 4);
          body.writeInt16LE(max, 12 + (first + bucket) * 4 + 2);
        }
      }
    } finally {
      await handle.close();
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'speech PCM unreadable';
    return err(FfmpegFailed({ exitCode: -1 }, { detail }));
  }
  return ok(body);
}
