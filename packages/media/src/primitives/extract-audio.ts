// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Mono audio aligned to the plan's video start. The downmix forces stereo
 * first, then averages, so a mono source survives the pan.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { fileParams, UnsupportedMedia } from '../errors';
import type { MediaContext } from '../ffmpeg';
import { appendAudio, audioOnlyArgs } from '../normalise/filters';
import { normalisationGraph, type GraphRange } from '../normalise/graph';
import type { NormalisationPlan } from '../normalise/types';
import { runFfmpeg } from '../ffmpeg';
import { runFfmpegRaw } from '../run-raw';

const DOWNMIX = 'aformat=channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1';

export interface ExtractAudioOptions {
  readonly sampleRate: number;
  readonly format: 'f32le' | 'wav16';
  readonly range?: GraphRange;
  readonly out?: string;
  readonly onChunk?: (chunk: Buffer) => void;
  readonly signal?: AbortSignal;
}

export async function extractAudio(
  path: string,
  plan: NormalisationPlan,
  ctx: MediaContext,
  options: ExtractAudioOptions,
): AsyncResult<{ readonly sampleRate: number; readonly channels: 1 }> {
  if (!plan.audio) return err(UnsupportedMedia(fileParams(path), { detail: 'no audio stream' }));
  const graph = appendAudio(
    normalisationGraph(plan, {
      route: plan.decode,
      toneMap: { method: 'none', backend: 'software' },
      ...(options.range ? { range: options.range } : {}),
    }),
    `${DOWNMIX},aresample=${Math.max(1, Math.round(options.sampleRate))}`,
  );
  const codec = options.format === 'wav16' ? ['-f', 'wav', '-acodec', 'pcm_s16le'] : ['-f', 'f32le', '-acodec', 'pcm_f32le'];
  const rate = ['-ac', '1', '-ar', String(Math.round(options.sampleRate))];
  const base = ['-y', ...audioOnlyArgs(path, plan, graph), ...codec, ...rate];
  if (options.onChunk) {
    const encoded = await runFfmpegRaw(ctx, [...base, 'pipe:1'], {
      // Sound only (both runs): no video session.
      holdsVideoSession: false,
      onStdout: options.onChunk,
      timeoutMs: 180_000,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!encoded.ok) return encoded;
  } else if (options.out) {
    const encoded = await runFfmpeg(ctx, [...base, options.out], {
      holdsVideoSession: false,
      timeoutMs: 180_000,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!encoded.ok) return encoded;
  }
  return ok({ sampleRate: Math.round(options.sampleRate), channels: 1 });
}
