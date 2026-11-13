// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Media job kinds (core's job contract, G7): plain data the jobs process
 * registers with `createMediaJobs` handlers, and callers name when they run a
 * job. Inputs and outputs are JSON: they are stored with the job.
 */
import { createHash } from 'node:crypto';
import { defineJobKind, NO_RETRY, type RetryPolicy } from '@taalcut/core';
import { z } from 'zod';
import { FALLBACK_CODES } from '../backends';
import { MEDIA_BACKENDS } from '../hw-video/types';
import { fileFingerprint } from '../input';
import { probeResultSchema } from '../probe/result-schema';
import { rationalTimeSchema } from '../tools/schemas';
import { PHASE2_STAGES, phase2JobKinds } from './phase2-kinds';

/**
 * An idempotency key that fits the queue's 512-character limit whatever the
 * path, and doesn't put the path in the job table's key column.
 */
function idempotencyKey(kind: string, ...parts: readonly (string | number)[]): string {
  return `${kind}:${createHash('sha256').update(parts.join('\n')).digest('hex')}`;
}

/** i18n keys for `JobProgress.stageKey`; the renderer catalogue needs entries for them. */
export const MEDIA_JOB_STAGES = {
  probing: 'jobs.stage.readingMediaInfo',
  extractingFrame: 'jobs.stage.extractingFrame',
  testingEncoder: 'jobs.stage.testingEncoder',
  ...PHASE2_STAGES,
} as const;

/** English notes for tool progress (developer-facing; the renderer uses the catalogue). */
export const MEDIA_STAGE_NOTES: Readonly<Record<string, string>> = {
  [MEDIA_JOB_STAGES.probing]: 'reading file headers',
  [MEDIA_JOB_STAGES.extractingFrame]: 'extracting frame',
  [MEDIA_JOB_STAGES.testingEncoder]: 'testing encoder',
  [MEDIA_JOB_STAGES.normalising]: 'planning normalisation',
  [MEDIA_JOB_STAGES.makingProxy]: 'making proxy',
  [MEDIA_JOB_STAGES.makingPreviews]: 'making previews',
  [MEDIA_JOB_STAGES.makingFilmstrip]: 'making the filmstrip',
  [MEDIA_JOB_STAGES.conforming]: 'conforming',
  [MEDIA_JOB_STAGES.enforcingCacheCap]: 'enforcing cache cap',
};

/** Only retryable errors (media.timeout on a slow volume, media.spawn_failed) are retried, once. */
const ONE_RETRY: RetryPolicy = { maxAttempts: 2, backoff: { kind: 'fixed', delayMs: 500 } };

const fallbackReasonSchema = z.object({ code: z.enum(FALLBACK_CODES), detail: z.string() });

export const probeJobInputSchema = z.object({ path: z.string().min(1) });
export type ProbeJobInput = z.output<typeof probeJobInputSchema>;

/** `media.probe`: one ffprobe run. I/O-bound, and someone is usually waiting on it. */
export const mediaProbeJob = defineJobKind({
  kind: 'media.probe',
  input: probeJobInputSchema,
  output: probeResultSchema,
  resource: 'io',
  priority: 'high',
  retry: ONE_RETRY,
  // ffprobe's own limit is 30 s and gives the typed, retryable media.timeout first.
  timeoutMs: 35_000,
  resumable: true,
  idempotencyKey: (input) => idempotencyKey('media.probe', fileFingerprint(input.path)),
});

export const extractFrameJobInputSchema = z.object({
  path: z.string().min(1),
  at: rationalTimeSchema,
  format: z.enum(['jpeg', 'png']).optional(),
  maxDimension: z.int().min(2).max(8192).optional(),
  jpegQuality: z.int().min(2).max(31).optional(),
  decode: z.enum(['auto', 'software']).optional(),
});
export type ExtractFrameJobInput = z.output<typeof extractFrameJobInputSchema>;

export const extractFrameJobOutputSchema = z.object({
  /** The encoded image, base64: job outputs are stored as JSON. */
  dataBase64: z.string().min(1),
  mimeType: z.enum(['image/jpeg', 'image/png']),
  width: z.int().positive(),
  height: z.int().positive(),
  at: rationalTimeSchema,
  backend: z.enum(MEDIA_BACKENDS),
  fallbackReason: fallbackReasonSchema.optional(),
  /** HDR sources: how the frame was mapped to SDR (libplacebo on Vulkan first). */
  toneMap: z
    .object({
      method: z.enum(['libplacebo', 'zscale', 'none']),
      backend: z.enum(['vulkan', 'software']),
      curve: z.enum(['bt.2446a', 'hable']).optional(),
      fallbackReason: fallbackReasonSchema.optional(),
    })
    .optional(),
});
export type ExtractFrameJobOutput = z.output<typeof extractFrameJobOutputSchema>;

/** Largest frame a job returns (before base64). A bigger one is media.output_too_large: ask for a smaller size. */
export const FRAME_JOB_MAX_BYTES = 8 * 1024 * 1024;

/**
 * `media.extractFrame`: one JPEG or PNG frame, decoded GPU first (ADR 0002).
 * It queues in the video class even when decode falls back to CPU: video work
 * waits for the engine rather than moving to the CPU to beat the queue.
 */
export const mediaExtractFrameJob = defineJobKind({
  kind: 'media.extractFrame',
  input: extractFrameJobInputSchema,
  output: extractFrameJobOutputSchema,
  resource: 'video',
  priority: 'high',
  retry: ONE_RETRY,
  // A probe, a hardware attempt and a software retry, each with its own limit.
  timeoutMs: 120_000,
  resumable: true,
  idempotencyKey: (input) =>
    idempotencyKey(
      'media.extractFrame',
      fileFingerprint(input.path),
      `${input.at.value}/${input.at.rate}`,
      input.format ?? 'jpeg',
      input.maxDimension ?? 'full',
      input.jpegQuality ?? 3,
      input.decode ?? 'auto',
    ),
});

export const selectEncoderJobInputSchema = z.object({ codec: z.enum(['h264', 'hevc', 'av1', 'prores']) });
export type SelectEncoderJobInput = z.output<typeof selectEncoderJobInputSchema>;

export const encoderChoiceSchema = z.object({
  codec: z.enum(['h264', 'hevc', 'av1', 'prores']),
  encoder: z.string().min(1),
  backend: z.enum(MEDIA_BACKENDS),
  fallbackReason: fallbackReasonSchema.optional(),
});

/**
 * `media.selectEncoder`: the encoder for a codec, hardware first and proven
 * by a 10-frame trial encode. No idempotency key: the answer belongs to this
 * machine as it is now (a stored success must not outlive a GPU change).
 */
export const mediaSelectEncoderJob = defineJobKind({
  kind: 'media.selectEncoder',
  input: selectEncoderJobInputSchema,
  output: encoderChoiceSchema,
  // A 10-frame trial encode on the hardware video engine.
  resource: 'video',
  priority: 'normal',
  retry: NO_RETRY,
  timeoutMs: 60_000,
  resumable: true,
});

/** Every media job kind, for the jobs process and for enqueue-only callers. */
export const mediaJobKinds = [
  mediaProbeJob,
  mediaExtractFrameJob,
  mediaSelectEncoderJob,
  ...phase2JobKinds,
] as const;
