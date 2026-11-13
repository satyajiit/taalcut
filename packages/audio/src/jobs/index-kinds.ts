// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The indexing job kinds (P2-L8, P2-L13, IX-A1/A4): one job per index stage, each taking the original, because
 * the pipeline hands a stage the asset's path, never a WAV. Both read the asset's audio pass (one FFmpeg decode:
 * loudness, silences and the 16 kHz speech PCM, kept between the two): `audio.identifyLanguage` measures, finds
 * the voice and asks whisper for the language of one window of it; the transcript kinds transcribe the PCM,
 * one kind per engine so each waits in its own lane (whisper on the GPU, Parakeet on the Neural Engine).
 * `audio.transcribeAsset` (either engine, chosen inside the job) stays for jobs queued before IX.
 */
import { defineJobKind, SPOKEN_LANGUAGE_STATES, transcriptSchema, type RetryPolicy } from '@taalcut/core';
import { normalisationPlanSchema } from '@taalcut/media';
import { z } from 'zod';
import { audioIdempotencyKey } from '../idempotency';

const RETRY: RetryPolicy = { maxAttempts: 2, backoff: { kind: 'fixed', delayMs: 500 } };

const source = {
  path: z.string().min(1),
  /** BLAKE3 from library.hash: the idempotency key; absent outside the pipeline. */
  contentHash: z.string().min(1).optional(),
  /** normalise's stored plan, so the audio pass needs no probe; absent (older jobs), the job probes. */
  plan: normalisationPlanSchema.optional(),
};

const sliceSchema = z.object({ language: z.string().min(1), probability: z.number() });

/** LIB1-LANG: how the language was decided (speech/language-decision.ts). */
const decisionSchema = z.object({
  state: z.enum(SPOKEN_LANGUAGE_STATES),
  languages: z.array(z.string().min(1)).max(3),
  confidence: z.number().min(0).max(1).nullable(),
  source: z.enum(['chosen', 'identifier', 'whisper', 'none']),
});

const identifyInputSchema = z.object({
  ...source,
  /** Set when the user named the language (source or import session): detection is skipped. */
  language: z.string().min(1).optional(),
});

export const identifyLanguageOutputSchema = z.object({
  /** Under 1 s of non-silent audio: no language, no transcript. */
  silent: z.boolean(),
  measure: z.object({
    integratedLufs: z.number(),
    loudnessRange: z.number(),
    truePeakDbtp: z.number(),
    nonSilentRatio: z.number(),
    nonSilentMs: z.number(),
    durationMs: z.number(),
  }),
  /**
   * What the clip is filed under: `language` the decision's first language (null when unclear), `perSlice` the
   * languages it named (what the transcript routes by). Before LIB1, Whisper tiny's one guess.
   */
  detected: z.object({
    language: z.string().nullable(),
    probability: z.number().nullable(),
    perSlice: z.array(sliceSchema).max(3),
  }),
  /** LIB1-LANG: the decision; absent in outputs stored before LIB1 and for a silent clip. */
  decision: decisionSchema.optional(),
  /** LIB1-LANG: Whisper tiny's likeliest languages on the window (BCP 47). */
  whisper: z.array(sliceSchema).max(8).optional(),
  /** LIB1-LANG: the Indian-language identifier's pieces, each with its three likeliest; absent when it didn't run. */
  pieces: z
    .array(
      z.object({
        startMs: z.number(),
        endMs: z.number(),
        top: z.array(sliceSchema).max(3),
        /** Of the clip's later sound, past the voice window: counts toward a mix only. */
        later: z.literal(true).optional(),
      }),
    )
    .max(9)
    .optional(),
  /** Where the voice is (IX-A2); absent in outputs stored before IX and when the user named the language. */
  speech: z
    .object({
      /** Voice the scan found (all of it when `complete`). */
      speechMs: z.number(),
      /** The language-ID window, asset clock. */
      window: z.object({ startMs: z.number(), endMs: z.number() }).nullable(),
      /** PCM the voice scan read. */
      scannedMs: z.number(),
      complete: z.boolean(),
      /** `stretches`: Silero VAD was not installed, so the non-silent stretches stood in for voice. */
      detector: z.enum(['silero', 'stretches']),
    })
    .optional(),
});
export type IdentifyLanguageOutput = z.output<typeof identifyLanguageOutputSchema>;

export const audioIdentifyLanguageJob = defineJobKind({
  kind: 'audio.identifyLanguage',
  input: identifyInputSchema,
  output: identifyLanguageOutputSchema,
  resource: 'gpu',
  lane: 'audio.whisper',
  priority: 'low',
  retry: RETRY,
  timeoutMs: 600_000,
  resumable: true,
  idempotencyKey: (input) =>
    audioIdempotencyKey(
      'audio.identifyLanguage',
      input.contentHash ?? input.path,
      'all',
      input.language ?? '-',
    ),
});

const transcribeInputSchema = z.object({
  ...source,
  /** What language id found per slice; the route is chosen from these. */
  perSlice: z.array(sliceSchema).max(3),
  language: z.string().nullable(),
});
export type TranscribeAssetInput = z.output<typeof transcribeInputSchema>;

function transcribeKey(kind: string) {
  return (input: TranscribeAssetInput) =>
    audioIdempotencyKey(
      kind,
      input.contentHash ?? input.path,
      'all',
      input.perSlice.map((slice) => slice.language).join(',') || (input.language ?? '-'),
    );
}

/** whisper (Metal) for Hindi and every language Parakeet doesn't speak, and when Parakeet isn't installed. */
export const audioTranscribeAssetWhisperJob = defineJobKind({
  kind: 'audio.transcribeAssetWhisper',
  input: transcribeInputSchema,
  output: transcriptSchema,
  resource: 'gpu',
  lane: 'audio.whisper',
  priority: 'low',
  retry: RETRY,
  timeoutMs: 7_200_000,
  resumable: true,
  idempotencyKey: transcribeKey('audio.transcribeAssetWhisper'),
});

/** Parakeet on the Neural Engine for en, es and pt (whisper when the helper can't load it). */
export const audioTranscribeAssetParakeetJob = defineJobKind({
  kind: 'audio.transcribeAssetParakeet',
  input: transcribeInputSchema,
  output: transcriptSchema,
  resource: 'npu',
  lane: 'audio.parakeet',
  priority: 'low',
  retry: RETRY,
  timeoutMs: 7_200_000,
  resumable: true,
  idempotencyKey: transcribeKey('audio.transcribeAssetParakeet'),
});

/** Before IX: either engine, chosen in the job. Still registered so queued jobs finish; no stage enqueues it. */
export const audioTranscribeAssetJob = defineJobKind({
  kind: 'audio.transcribeAsset',
  input: transcribeInputSchema,
  output: transcriptSchema,
  // Whisper's Metal route; Parakeet on the Neural Engine shares the pool when its model is installed.
  resource: 'gpu',
  lane: 'audio.whisper',
  priority: 'low',
  retry: RETRY,
  timeoutMs: 7_200_000,
  resumable: true,
  idempotencyKey: transcribeKey('audio.transcribeAsset'),
});

export const audioIndexJobKinds = [
  audioIdentifyLanguageJob,
  audioTranscribeAssetWhisperJob,
  audioTranscribeAssetParakeetJob,
  audioTranscribeAssetJob,
] as const;
