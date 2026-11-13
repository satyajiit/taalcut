// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Audio job kinds. Priority on the kind is `low`; a reference passes `high`
 * on JobRunOptions. Parakeet takes the Neural Engine (`npu`).
 */
import {
  beatMapSchema,
  defineJobKind,
  frameRateSchema,
  rationalTimeSchema,
  timeRangeSchema,
  transcriptSchema,
  type JobContext,
  type RetryPolicy,
  type TimeRange,
} from '@taalcut/core';
import { z } from 'zod';
import { audioIdempotencyKey, rangeKey } from '../idempotency';
import { rangeToMs } from '../rates';

const RETRY: RetryPolicy = { maxAttempts: 2, backoff: { kind: 'fixed', delayMs: 500 } };
const CLOUD_RETRY: RetryPolicy = { maxAttempts: 1, backoff: { kind: 'fixed', delayMs: 0 } };

/** i18n keys for JobProgress.stageKey. */
export const AUDIO_JOB_STAGES = {
  measuring: 'jobs.stage.measuringAudio',
  detecting: 'jobs.stage.detectingLanguage',
  transcribing: 'jobs.stage.transcribing',
  tracking: 'jobs.stage.trackingBeats',
} as const;

/** A job's progress at one of the stages above, the fraction kept within [0, 1]. */
export function reportStage(context: JobContext, fraction: number, stageKey: string): void {
  context.progress({ fraction: Math.min(1, Math.max(0, fraction)), stageKey });
}

const planSchema = z.object({ audioStart: rationalTimeSchema.optional() });

const sourceSchema = {
  path: z.string().min(1),
  contentHash: z.string().min(1).optional(),
  plan: planSchema.optional(),
};

const beatFlagSchema = z.enum(['low_confidence', 'tempo_disagrees', 'few_downbeats']);

function jobKey(
  kind: string,
  input: {
    readonly path: string;
    readonly contentHash?: string;
    readonly range?: TimeRange;
    readonly language?: string;
  },
): string {
  return audioIdempotencyKey(
    kind,
    input.contentHash ?? input.path,
    rangeKey(input.range ? rangeToMs(input.range) : undefined),
    input.language ?? '-',
  );
}

const measureInputSchema = z.object({ ...sourceSchema, range: timeRangeSchema.optional() });

const measureOutputSchema = z.object({
  integratedLufs: z.number(),
  loudnessRange: z.number(),
  truePeakDbtp: z.number(),
  nonSilentRatio: z.number(),
  nonSilentMs: z.number(),
  durationMs: z.number(),
  stretches: z.array(timeRangeSchema),
  slices: z.array(timeRangeSchema).max(3),
});

export const audioMeasureJob = defineJobKind({
  kind: 'audio.measure',
  input: measureInputSchema,
  output: measureOutputSchema,
  resource: 'cpu',
  priority: 'low',
  retry: RETRY,
  timeoutMs: 600_000,
  resumable: true,
  idempotencyKey: (input) => jobKey('audio.measure', input),
});

const detectInputSchema = z.object({
  ...sourceSchema,
  slices: z.array(z.object({ path: z.string().min(1) })).max(3),
});

const detectOutputSchema = z.object({
  language: z.string().nullable(),
  probability: z.number().nullable(),
  perSlice: z.array(z.object({ language: z.string(), probability: z.number() })),
});

export const audioDetectLanguageJob = defineJobKind({
  kind: 'audio.detectLanguage',
  input: detectInputSchema,
  output: detectOutputSchema,
  resource: 'gpu',
  lane: 'audio.whisper',
  priority: 'low',
  retry: RETRY,
  timeoutMs: 300_000,
  resumable: true,
  idempotencyKey: (input) => jobKey('audio.detectLanguage', input),
});

const parakeetInputSchema = z.object({
  ...sourceSchema,
  language: z.string().min(1),
  range: timeRangeSchema.optional(),
});

export const audioTranscribeParakeetJob = defineJobKind({
  kind: 'audio.transcribeParakeet',
  input: parakeetInputSchema,
  output: transcriptSchema,
  resource: 'npu',
  lane: 'audio.parakeet',
  priority: 'low',
  retry: RETRY,
  timeoutMs: 3_600_000,
  resumable: true,
  idempotencyKey: (input) => jobKey('audio.transcribeParakeet', input),
});

const whisperInputSchema = z.object({
  ...sourceSchema,
  language: z.string().min(1),
  model: z.enum(['small', 'medium']),
  range: timeRangeSchema.optional(),
});

export const audioTranscribeWhisperJob = defineJobKind({
  kind: 'audio.transcribeWhisper',
  input: whisperInputSchema,
  output: transcriptSchema,
  resource: 'gpu',
  lane: 'audio.whisper',
  priority: 'low',
  retry: RETRY,
  timeoutMs: 7_200_000,
  resumable: true,
  idempotencyKey: (input) => jobKey('audio.transcribeWhisper', input),
});

const cloudInputSchema = z.object({
  ...sourceSchema,
  language: z.string().min(1).optional(),
  range: timeRangeSchema.optional(),
});

const cloudOutputSchema = z.union([transcriptSchema, z.object({ skipped: z.literal('no_consent') })]);

export const audioTranscribeCloudJob = defineJobKind({
  kind: 'audio.transcribeCloud',
  input: cloudInputSchema,
  output: cloudOutputSchema,
  resource: 'network',
  priority: 'low',
  retry: CLOUD_RETRY,
  timeoutMs: 3_600_000,
  resumable: true,
  idempotencyKey: (input) => jobKey('audio.transcribeCloud', input),
});

const trackInputSchema = z.object({
  ...sourceSchema,
  range: timeRangeSchema.optional(),
});

const trackOutputSchema = z.object({
  beatMap: beatMapSchema,
  downbeatSource: z.enum(['model', 'inferred']),
  flags: z.array(beatFlagSchema),
  envelope: z.object({
    rate: frameRateSchema,
    peaks: z.array(z.number()).max(200_000),
  }),
  model: z.string().min(1),
});

export const audioTrackBeatsJob = defineJobKind({
  kind: 'audio.trackBeats',
  input: trackInputSchema,
  output: trackOutputSchema,
  resource: 'gpu',
  lane: 'audio.beats',
  priority: 'low',
  retry: RETRY,
  timeoutMs: 600_000,
  resumable: true,
  idempotencyKey: (input) => jobKey('audio.trackBeats', input),
});
