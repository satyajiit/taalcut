// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A talking clip's SpeechCleanupAnalysis (core C-10, SPEC P3.7): the clip's speech decoded the way its transcript
 * was made (16 kHz mono, aligned to the video start), Silero VAD over it, then pauses, fillers, retakes and
 * emphasis. `analyseSpeech` is pure over the samples, probabilities and transcript, so the evals lane (P3-Q2)
 * can run it on a labelled clip without a job runner; `createSpeechCleanupAnalyser` adds decoding and the VAD.
 */
import {
  err,
  ok,
  speechCleanupAnalysisSchema,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type Result,
  type SpeechCleanupAnalysis,
  type Transcript,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { decodeClipSpeech } from '../pcm/decode';
import { msRange } from '../rates';
import { CLEANUP_AUDIO_CONFIG } from './config';
import { findEmphasis } from './emphasis';
import { findAmbiguous, findFillers } from './fillers';
import { lexiconFor } from './lexicon';
import { findRetakes } from './retakes';
import { pausesBetween, speechSegments, voicedIslands, type Span } from './segments';
import type { VadEngine } from './vad';
import { transcriptWords } from './words';

export interface SpeechInput {
  readonly assetId: AssetId;
  readonly contentHash: string;
  readonly transcript: Transcript;
  /** 16 kHz mono on the transcript's clock. */
  readonly samples: Float32Array;
  readonly probabilities: ArrayLike<number>;
  readonly windowMs: number;
}

const range = (span: Span) => msRange(span.startMs, span.endMs - span.startMs);

export function analyseSpeech(input: SpeechInput): Result<SpeechCleanupAnalysis> {
  const lexicon = lexiconFor(input.transcript.language);
  const words = transcriptWords(input.transcript);
  const segments = speechSegments(input.probabilities, input.windowMs);
  const islands = voicedIslands(input.probabilities, input.windowMs);
  const fillers = findFillers(words, islands, lexicon);
  const fillerWords = new Set(fillers.flatMap((f) => (f.wordIndex === null ? [] : [f.wordIndex])));
  const analysis = {
    version: 1,
    assetId: input.assetId,
    contentHash: input.contentHash,
    configVersion: CLEANUP_AUDIO_CONFIG.configVersion,
    language: input.transcript.language,
    engine: input.transcript.engine,
    words: words.map((w) => ({
      text: w.text.slice(0, 100),
      range: range(w),
      confidence: Math.min(1, Math.max(0, w.confidence)),
    })),
    speech: segments.map(range),
    fillers: fillers.map((f) => ({
      range: range(f.range),
      text: f.text?.slice(0, 40) ?? null,
      wordIndex: f.wordIndex,
      confidence: f.confidence,
    })),
    pauses: pausesBetween(segments).map((p) => ({ range: range(p) })),
    retakes: findRetakes(words, lexicon).map((r) => ({
      earlier: range(r.earlier),
      later: range(r.later),
      similarity: r.similarity,
      kind: r.kind,
    })),
    emphasis: findEmphasis({
      samples: input.samples,
      sampleRate: CLEANUP_AUDIO_CONFIG.vad.sampleRate,
      words,
      islands,
      fillerWords,
    }).map((e) => ({
      wordIndex: e.wordIndex,
      range: range(e.range),
      strength: e.strength,
    })),
    ambiguous: findAmbiguous(words, lexicon).map((a) => ({ wordIndex: a.wordIndex, range: range(a.range) })),
  };
  const parsed = speechCleanupAnalysisSchema.safeParse(analysis);
  if (!parsed.success)
    return err(
      ValidationError(
        { field: 'speechCleanup' },
        {
          detail: parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        },
      ),
    );
  return ok(parsed.data);
}

export interface SpeechCleanupAnalyser {
  analyse(request: {
    readonly path: string;
    readonly assetId: AssetId;
    readonly contentHash: string;
    readonly transcript: Transcript;
    readonly signal?: AbortSignal;
  }): AsyncResult<SpeechCleanupAnalysis>;
}

export function createSpeechCleanupAnalyser(deps: {
  readonly vad: VadEngine;
  readonly media: MediaContext;
}): SpeechCleanupAnalyser {
  return {
    async analyse(request) {
      const pcm = await decodeClipSpeech(request.path, deps.media, {
        sampleRate: CLEANUP_AUDIO_CONFIG.vad.sampleRate,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      if (!pcm.ok) return pcm;
      const samples = pcm.value.channels[0] ?? new Float32Array();
      const activity = await deps.vad.probabilities(samples, request.signal);
      if (!activity.ok) return activity;
      return analyseSpeech({
        assetId: request.assetId,
        contentHash: request.contentHash,
        transcript: request.transcript,
        samples,
        probabilities: activity.value.probabilities,
        windowMs: activity.value.windowMs,
      });
    },
  };
}
