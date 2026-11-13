// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * CLAP's audio encoder (EAR1-F4): log-mel windows (the GPU graph, or the f64 oracle on the CPU) into the
 * `clap-general-audio` model in batches, each window's embedding made unit length (`Clap._forward`). A segment over
 * 10 s is split as `Clap.embed_audio` splits it and averaged; `embedSource` is `vocab.embed_file`: up to 6 evenly
 * spaced 10 s windows of a source (or a range of it), their mean, unit length.
 */
import { CancelledError, err, ok, type AsyncResult } from '@taalcut/core';
import { LISTEN_CONFIG } from '../config';
import { ListenBadInput, ListenFailed } from '../errors';
import { clapLogMelOracle } from './clap-frontend.oracle';
import { CLAP_FRONT_END } from './clap-frontend';
import { frameBatch, splitFeatures } from './frontend-graph';
import { floatOutput } from './ort';
import type { ListenSessions } from './sessions';
import { clapInputWindows, clapSpans, spanSamples, type Span } from './windows';

const { frames, nMels, embedDim } = LISTEN_CONFIG.clap;

export interface ClapSourceEmbedding {
  readonly spans: readonly Span[];
  /** One unit vector per span. */
  readonly windows: readonly Float32Array[];
  /** Their mean, unit length. */
  readonly pooled: Float32Array;
}

export interface ClapAudioEncoder {
  /** `[1001, 64]` log-mel per window (each ≤ 10 s), as the model reads them. */
  features(windows: readonly Float32Array[], signal?: AbortSignal): Promise<Float32Array[]>;
  /** One unit embedding per segment (48 kHz mono). */
  embedSegments(segments: readonly Float32Array[], signal?: AbortSignal): AsyncResult<Float32Array[]>;
  /** `vocab.embed_file(path, start, end)` for a decoded source; seconds from the source's start. */
  embedSource(
    source: Float32Array,
    range?: { readonly start?: number; readonly end?: number },
    signal?: AbortSignal,
  ): AsyncResult<ClapSourceEmbedding>;
}

/** Unit length with earshot's 1e-12 guard. */
export function unit(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const v of vector) sum += v * v;
  const norm = Math.sqrt(sum) + 1e-12;
  return vector.map((v) => v / norm);
}

/** The mean of unit vectors, unit length. */
export function meanUnit(vectors: readonly Float32Array[], dim: number = embedDim): Float32Array {
  const acc = new Float64Array(dim);
  for (const v of vectors) for (let i = 0; i < dim; i++) acc[i] = (acc[i] ?? 0) + (v[i] ?? 0);
  const mean = new Float32Array(dim);
  for (let i = 0; i < dim; i++) mean[i] = (acc[i] ?? 0) / Math.max(1, vectors.length);
  return unit(mean);
}

export function createClapAudio(
  sessions: ListenSessions,
  batch: number = LISTEN_CONFIG.sessions.batch,
): ClapAudioEncoder {
  async function features(windows: readonly Float32Array[], signal?: AbortSignal): Promise<Float32Array[]> {
    const framed = frameBatch(CLAP_FRONT_END, windows);
    const gpu = await sessions.frontEnd(CLAP_FRONT_END, framed, signal);
    if (gpu) return splitFeatures(CLAP_FRONT_END, gpu, framed.valid);
    return windows.map((window) => clapLogMelOracle(window));
  }

  async function embedWindows(
    windows: readonly Float32Array[],
    signal?: AbortSignal,
  ): AsyncResult<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < windows.length; i += batch) {
      if (signal?.aborted) return err(CancelledError());
      const chunk = windows.slice(i, i + batch);
      const feats = await features(chunk, signal);
      const input = new Float32Array(chunk.length * frames * nMels);
      feats.forEach((block, j) => input.set(block, j * frames * nMels));
      const ran = await sessions.run(
        'clapAudio',
        { input_features: { type: 'float32', data: input, dims: [chunk.length, 1, frames, nMels] } },
        signal,
      );
      if (!ran.ok) return ran;
      const embeds = floatOutput(ran.value, 'audio_embeds');
      if (!embeds || embeds.length < chunk.length * embedDim) {
        return err(ListenFailed(undefined, { detail: 'CLAP audio_embeds missing' }));
      }
      for (let j = 0; j < chunk.length; j++) out.push(unit(embeds.slice(j * embedDim, (j + 1) * embedDim)));
    }
    return ok(out);
  }

  async function embedSegments(
    segments: readonly Float32Array[],
    signal?: AbortSignal,
  ): AsyncResult<Float32Array[]> {
    const windows: Float32Array[] = [];
    const owner: number[] = [];
    segments.forEach((segment, i) => {
      for (const window of clapInputWindows(segment)) {
        windows.push(window);
        owner.push(i);
      }
    });
    const embedded = await embedWindows(windows, signal);
    if (!embedded.ok) return embedded;
    return ok(segments.map((_, i) => meanUnit(embedded.value.filter((__, j) => owner[j] === i))));
  }

  return {
    features,
    embedSegments,
    async embedSource(source, range, signal) {
      const duration = source.length / LISTEN_CONFIG.sampleRate;
      const start = Math.max(0, range?.start ?? 0);
      const end = range?.end === undefined ? duration : Math.min(duration, range.end);
      if (start >= duration && duration > 0)
        return err(ListenBadInput(undefined, { detail: 'start past the end' }));
      const spans = clapSpans(start, Math.max(end, start + 0.01));
      const embedded = await embedSegments(
        spans.map((span) => spanSamples(source, span)),
        signal,
      );
      if (!embedded.ok) return embedded;
      return ok({ spans, windows: embedded.value, pooled: meanUnit(embedded.value) });
    },
  };
}
