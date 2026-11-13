// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * 8 kHz mono peaks. No picture: the renderer draws the bars. A clip with no
 * audio writes nothing and reports an empty header. With the speech PCM port
 * (speech-pcm-port.ts) the peaks come from the audio pass's 16 kHz PCM, and
 * the asset's audio isn't decoded again.
 */
import { writeFile } from 'node:fs/promises';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { FfmpegFailed } from '../errors';
import type { MediaContext } from '../ffmpeg';
import { appendAudio, audioOnlyArgs } from '../normalise/filters';
import { normalisationGraph } from '../normalise/graph';
import type { NormalisationPlan } from '../normalise/types';
import { runFfmpegRaw } from '../run-raw';
import { WAVEFORM_BUCKETS_PER_SEC, encodeWaveformPeaks } from './peaks';
import type { SpeechPcmPort } from './speech-pcm-port';

const DOWNMIX = 'aformat=channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1,aresample=8000';

export interface WaveformResult {
  readonly bytes: number;
  readonly bucketsPerSec: number;
  readonly count: number;
}

export interface WaveformOptions {
  readonly signal?: AbortSignal;
  /** Peaks from the asset's audio pass (its own file and plan, even when `path` is the proxy). */
  readonly pcm?: {
    readonly port: SpeechPcmPort;
    readonly asset: {
      readonly path: string;
      readonly contentHash?: string;
      readonly plan: NormalisationPlan;
    };
  };
}

async function written(body: Buffer, out: string | undefined): AsyncResult<WaveformResult> {
  if (out) {
    try {
      await writeFile(out, body);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'waveform write failed';
      return err(FfmpegFailed({ exitCode: -1 }, { detail }));
    }
  }
  return ok({ bytes: body.length, bucketsPerSec: WAVEFORM_BUCKETS_PER_SEC, count: body.readUInt32LE(8) });
}

export async function makeWaveform(
  path: string,
  plan: NormalisationPlan,
  ctx: MediaContext,
  out: string | undefined,
  options: WaveformOptions = {},
): AsyncResult<WaveformResult> {
  const { signal } = options;
  if (!plan.audio || plan.kind === 'image') {
    return ok({ bytes: 0, bucketsPerSec: WAVEFORM_BUCKETS_PER_SEC, count: 0 });
  }
  if (options.pcm) {
    const peaks = await options.pcm.port.peaks(options.pcm.asset, ctx, signal);
    if (peaks.ok) return written(peaks.value, out);
    // No peaks (the pass failed or its file went): decode the audio here, as without a port.
  }
  const graph = appendAudio(
    normalisationGraph(plan, { route: plan.decode, toneMap: { method: 'none', backend: 'software' } }),
    DOWNMIX,
  );
  const chunks: Buffer[] = [];
  const encoded = await runFfmpegRaw(
    ctx,
    [
      '-y',
      ...audioOnlyArgs(path, plan, graph),
      '-f',
      's16le',
      '-acodec',
      'pcm_s16le',
      '-ar',
      '8000',
      '-ac',
      '1',
      'pipe:1',
    ],
    {
      // Sound only: no video session.
      holdsVideoSession: false,
      onStdout: (chunk) => chunks.push(chunk),
      timeoutMs: 120_000,
      ...(signal ? { signal } : {}),
    },
  );
  if (!encoded.ok) return encoded;
  const pcm = Buffer.concat(chunks);
  const even = pcm.subarray(0, pcm.length - (pcm.length % 2));
  const samples = new Int16Array(even.buffer, even.byteOffset, even.length / 2);
  return written(encodeWaveformPeaks(samples, 8000, WAVEFORM_BUCKETS_PER_SEC), out);
}
