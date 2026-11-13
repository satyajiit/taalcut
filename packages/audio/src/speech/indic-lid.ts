// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Indian-language identifier (LIB1-LANG): CIIL Anuvani-LID (Apache-2.0), the `anuvani-lid` component, in its
 * accelerator format. Two graphs per piece of up to 15 s of 16 kHz voice:
 * - the front end (log-mel, masks and the pooling weights) on the CPU, as Anuvani ships it: 0.1 MB, 12–20 ms;
 * - the encoder on media's ONNX runtime, WebGPU first (40–45 ms a piece on an M5 Max, against 150 ms on the CPU
 *   and 165–195 ms on Core ML after a 12–17 s compile), the CPU as the logged fallback.
 * It names the 22 scheduled languages of India and English, with calibrated probabilities.
 */
import {
  CancelledError,
  err,
  ok,
  type AsyncResult,
  type ComputeFallbackEvent,
  type TaalcutError,
} from '@taalcut/core';
import { createOnnxRuntime, type OnnxSession } from '@taalcut/media';
import { join } from 'node:path';
import { loadOnnxRuntime } from '../beats/ort-load';
import type { Span } from '../cleanup/segments';
import { LanguageDetectFailed, ModelMissing } from '../errors';
import type { LanguageScore } from './language-decision';

export const INDIC_LID = {
  component: 'anuvani-lid',
  model: 'anuvani-lid-npu-15s-3b9caa41',
  encoder: 'anuvani_lid.npu-15s.encoder.onnx',
  frontend: 'anuvani_lid.npu-15s.frontend.onnx',
  /** The accelerator format's fixed window: 15 s at 16 kHz. */
  windowSamples: 240_000,
  /** Under 0.1 s nothing is classified (Anuvani's `min_samples`). */
  minSamples: 1600,
  /** Anuvani's long-audio policy: spans under 0.3 s dropped, gaps up to 0.6 s bridged, pieces up to 15 s. */
  minSpanMs: 300,
  mergeGapMs: 600,
  maxPieceMs: 15_000,
  /** A tail shorter than this is replaced by a full piece ending at the stretch's end. */
  minTailMs: 1000,
} as const;

/** The 23 outputs, in the model's order (its `labels`, alphabetical by English name), as BCP 47. */
export const INDIC_LID_LABELS = [
  'as', 'bn', 'brx', 'doi', 'en', 'gu', 'hi', 'kn', 'ks', 'kok', 'mai', 'ml', 'mni', 'mr', 'ne', 'or', 'pa', 'sa',
  'sat', 'sd', 'ta', 'te', 'ur',
] as const; // prettier-ignore

export const INDIC_LID_OPERATION = 'audio.identifyIndianLanguage';
const FRONTEND_ON_CPU =
  "Anuvani-LID's front end (the mel spectrogram and the masks) is built for the CPU; its encoder runs on the GPU";

export interface IndicLid {
  /** One piece of 16 kHz mono voice, at most 15 s: every label's probability, most likely first. */
  identify(samples: Float32Array, signal?: AbortSignal): AsyncResult<LanguageScore[]>;
}

/** The probabilities from the 23 logits. */
export function softmaxScores(logits: ArrayLike<number>): LanguageScore[] {
  const values = Array.from({ length: INDIC_LID_LABELS.length }, (_, i) => Number(logits[i] ?? 0));
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - max));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return INDIC_LID_LABELS.map((language, i) => ({ language, probability: (exps[i] ?? 0) / total })).sort(
    (a, b) => b.probability - a.probability,
  );
}

function clip(spans: readonly Span[], window: Span): Span[] {
  return spans
    .map((span) => ({
      startMs: Math.max(span.startMs, window.startMs),
      endMs: Math.min(span.endMs, window.endMs),
    }))
    .filter((span) => span.endMs - span.startMs >= INDIC_LID.minSpanMs);
}

/** A long stretch as pieces of at most 15 s from its start; a short tail becomes a full piece ending at its end. */
function cut(span: Span): Span[] {
  const { maxPieceMs, minTailMs } = INDIC_LID;
  if (span.endMs - span.startMs <= maxPieceMs) return [span];
  const pieces: Span[] = [];
  for (let start = span.startMs; start < span.endMs; start += maxPieceMs)
    pieces.push({ startMs: start, endMs: Math.min(span.endMs, start + maxPieceMs) });
  const last = pieces[pieces.length - 1];
  if (last && last.endMs - last.startMs < minTailMs)
    pieces[pieces.length - 1] = { startMs: span.endMs - maxPieceMs, endMs: span.endMs };
  return pieces;
}

/**
 * The voice inside the language window as the identifier's pieces (Anuvani's own policy): phrases under 0.3 s
 * dropped, phrases a short pause apart merged while they fit in 15 s, longer ones cut. With no phrases (Silero
 * isn't installed), the window itself is the voice.
 */
export function voicePieces(speech: readonly Span[] | undefined, window: Span): Span[] {
  const phrases = speech && speech.length > 0 ? clip(speech, window) : [window];
  const merged: Span[] = [];
  for (const phrase of phrases) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      phrase.startMs - previous.endMs <= INDIC_LID.mergeGapMs &&
      phrase.endMs - previous.startMs <= INDIC_LID.maxPieceMs
    )
      merged[merged.length - 1] = { startMs: previous.startMs, endMs: phrase.endMs };
    else merged.push(phrase);
  }
  return merged.flatMap(cut);
}

/**
 * Up to `count` pieces of the clip's sound after the voice window, spread over the rest of the clip: what the
 * identifier hears so a clip that changes language after its first sentences can be called mixed.
 */
export function laterPieces(
  stretches: readonly Span[],
  window: Span,
  durationMs: number,
  count: number,
): Span[] {
  const after = stretches.filter((span) => span.endMs > window.endMs);
  if (after.length === 0) return [];
  const pieces = voicePieces(after, { startMs: window.endMs, endMs: durationMs }).filter(
    (piece) => piece.endMs - piece.startMs >= INDIC_LID.minTailMs,
  );
  if (pieces.length <= count) return pieces;
  return Array.from(
    { length: count },
    (_, i) => pieces[Math.round((i * (pieces.length - 1)) / Math.max(1, count - 1))],
  ).filter((piece): piece is Span => piece !== undefined);
}

interface Sessions {
  readonly frontend: OnnxSession;
  readonly encoder: OnnxSession;
}

interface OrtModule {
  Tensor: new (
    type: string,
    data: Float32Array | BigInt64Array,
    dims: readonly number[],
  ) => {
    dispose?: () => void;
  };
}

function failed(detail: string) {
  return err(LanguageDetectFailed(undefined, { detail: detail.slice(0, 500) }));
}

export function createIndicLid(deps: {
  readonly modelDir: string;
  readonly onComputeFallback?: (event: ComputeFallbackEvent) => void;
}): IndicLid {
  const runtime = createOnnxRuntime({
    loadModule: loadOnnxRuntime,
    logSeverityLevel: 3,
    ...(deps.onComputeFallback ? { onComputeFallback: deps.onComputeFallback } : {}),
  });
  let sessions: AsyncResult<Sessions> | undefined;
  const open = async (): AsyncResult<Sessions> => {
    const frontend = await runtime.openSession(join(deps.modelDir, INDIC_LID.frontend), {
      operation: `${INDIC_LID_OPERATION}.frontend`,
      candidates: ['cpu'],
      cpuReason: { reason: 'unsupported_input', detail: FRONTEND_ON_CPU },
    });
    if (!frontend.ok) return opening(frontend.error);
    const encoder = await runtime.openSession(join(deps.modelDir, INDIC_LID.encoder), {
      operation: INDIC_LID_OPERATION,
      candidates: ['webgpu', 'cpu'],
    });
    if (!encoder.ok) return opening(encoder.error);
    return ok({ frontend: frontend.value, encoder: encoder.value });
  };
  const opened = (): AsyncResult<Sessions> => {
    sessions ??= open().then((result) => {
      // A failed open is tried again by the next piece (the component may have been repaired).
      if (!result.ok) sessions = undefined;
      return result;
    });
    return sessions;
  };
  return {
    async identify(samples, signal) {
      if (signal?.aborted) return err(CancelledError());
      if (samples.length < INDIC_LID.minSamples) return failed('under 0.1 s of voice');
      const both = await opened();
      if (!both.ok) return both;
      const disposable: { dispose?: () => void }[] = [];
      try {
        const ort = (await import('onnxruntime-node')) as unknown as OrtModule;
        const audio = new Float32Array(INDIC_LID.windowSamples);
        audio.set(samples.subarray(0, INDIC_LID.windowSamples));
        const length = BigInt(Math.min(samples.length, INDIC_LID.windowSamples));
        const feeds = {
          audio: new ort.Tensor('float32', audio, [1, INDIC_LID.windowSamples]),
          audio_length: new ort.Tensor('int64', BigInt64Array.from([length]), [1]),
        };
        disposable.push(feeds.audio, feeds.audio_length);
        const front = await both.value.frontend.run(feeds);
        if (signal?.aborted) return err(CancelledError());
        const out = await both.value.encoder.run({
          features: front['features'],
          mask: front['mask'],
          attn_bias: front['attn_bias'],
          pool_w: front['pool_w'],
        });
        const logits = (out['logits'] as { data?: ArrayLike<number> } | undefined)?.data;
        if (!logits || logits.length < INDIC_LID_LABELS.length)
          return failed('the identifier gave no logits');
        return ok(softmaxScores(logits));
      } catch (cause) {
        return failed(cause instanceof Error ? cause.message : 'the identifier failed');
      } finally {
        for (const tensor of disposable) tensor.dispose?.();
      }
    },
  };
}

function opening(error: TaalcutError) {
  if (error.code === 'media.onnx_unavailable') return err(ModelMissing({ component: 'onnxruntime' }));
  return failed(error.detail ?? error.code);
}
