// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 2 job kinds. Decode and encode run on the video engine (`video`).
 * Idempotency keys are the literal strings from the SPEC, not a hash of the path.
 */
import {
  DERIVED_KEY_PATTERN,
  NO_RETRY,
  defineJobKind,
  derivedFileRefSchema,
  filmstripSchema,
  mediaFactsSchema,
  rationalTimeSchema,
  type RetryPolicy,
} from '@taalcut/core';
import { z } from 'zod';
import { decodeCountSchema } from '../decode-count/schema';
import { normalisationPlanSchema } from '../normalise/types';

const ONE_RETRY: RetryPolicy = { maxAttempts: 2, backoff: { kind: 'fixed', delayMs: 500 } };
const HASH = z.string().regex(/^[0-9a-f]{64}$/);

/** i18n keys for the Phase 2 stages. Merged into MEDIA_JOB_STAGES. */
export const PHASE2_STAGES = {
  normalising: 'jobs.stage.normalising',
  makingProxy: 'jobs.stage.makingProxy',
  makingPreviews: 'jobs.stage.makingPreviews',
  makingFilmstrip: 'jobs.stage.makingFilmstrip',
  conforming: 'jobs.stage.conforming',
  enforcingCacheCap: 'jobs.stage.enforcingCacheCap',
} as const;

const assetSchema = z.object({
  path: z.string().min(1),
  contentHash: HASH,
  sizeBytes: z.int().nonnegative(),
});

export const normaliseJobInputSchema = assetSchema;
export type NormaliseJobInput = z.output<typeof normaliseJobInputSchema>;

export const normaliseJobOutputSchema = z.object({
  plan: normalisationPlanSchema,
  facts: mediaFactsSchema,
  still: derivedFileRefSchema.optional(),
  /** What the job spawned (IX-D6). */
  decodes: decodeCountSchema.optional(),
});
export type NormaliseJobOutput = z.output<typeof normaliseJobOutputSchema>;

/**
 * `media.normalise`: the plan and the facts library stores. A still is written
 * only when the plan says the image cannot be read in place.
 */
export const mediaNormaliseJob = defineJobKind({
  kind: 'media.normalise',
  input: normaliseJobInputSchema,
  output: normaliseJobOutputSchema,
  resource: 'video',
  priority: 'low',
  retry: ONE_RETRY,
  timeoutMs: 10 * 60 * 1000,
  resumable: true,
  idempotencyKey: (input) => `normalise:v1:${input.contentHash}`,
});

export const proxyResultSchema = z.object({
  file: derivedFileRefSchema.optional(),
  reusedOriginal: z.boolean(),
  ratio: z.number().nonnegative(),
  overBudget: z.boolean(),
  warnings: z.array(z.string()),
  decodes: decodeCountSchema.optional(),
});
export type ProxyJobOutput = z.output<typeof proxyResultSchema>;

export const makeProxyJobInputSchema = assetSchema.extend({ plan: normalisationPlanSchema });
export type MakeProxyJobInput = z.output<typeof makeProxyJobInputSchema>;

/** `media.makeProxy`: short-GOP H.264 proxy, or the original when it is already preview-friendly. */
export const mediaMakeProxyJob = defineJobKind({
  kind: 'media.makeProxy',
  input: makeProxyJobInputSchema,
  output: proxyResultSchema,
  resource: 'video',
  priority: 'low',
  retry: ONE_RETRY,
  timeoutMs: 60 * 60 * 1000,
  resumable: true,
  idempotencyKey: (input) => `proxy:v1:${input.contentHash}`,
});

/** The previews and the filmstrip read the same: the asset, its plan, and the proxy when it has one. */
const fromProxySchema = z.object({
  path: z.string().min(1),
  contentHash: HASH,
  plan: normalisationPlanSchema,
  proxyKey: z.string().regex(DERIVED_KEY_PATTERN).optional(),
});

export const makePreviewsJobInputSchema = fromProxySchema;
export type MakePreviewsJobInput = z.output<typeof makePreviewsJobInputSchema>;

export const makePreviewsJobOutputSchema = z.object({
  /** Absent for a clip without sound. */
  waveform: derivedFileRefSchema.optional(),
  decodes: decodeCountSchema.optional(),
});
export type MakePreviewsJobOutput = z.output<typeof makePreviewsJobOutputSchema>;

/**
 * `media.makePreviews`: waveform peaks when the asset has sound. The thumbnail is `media.makeThumbnail` (IX-D4) and
 * the filmstrip `media.makeFilmstrip` (UX2); v2 since the filmstrip left.
 */
export const mediaMakePreviewsJob = defineJobKind({
  kind: 'media.makePreviews',
  input: makePreviewsJobInputSchema,
  output: makePreviewsJobOutputSchema,
  resource: 'video',
  priority: 'low',
  retry: ONE_RETRY,
  timeoutMs: 10 * 60 * 1000,
  resumable: true,
  idempotencyKey: (input) => `previews:v2:${input.contentHash}`,
});

export const makeFilmstripJobInputSchema = fromProxySchema;
export type MakeFilmstripJobInput = z.output<typeof makeFilmstripJobInputSchema>;

export const makeFilmstripJobOutputSchema = z.object({
  /** The sprite and its frames' times, as the asset detail carries them (core `filmstripSchema`). */
  filmstrip: filmstripSchema,
  /** Read from the proxy's keyframes (IX2-T3) or the exact frames. */
  source: z.enum(['keyframes', 'exact']),
  decodes: decodeCountSchema.optional(),
});
export type MakeFilmstripJobOutput = z.output<typeof makeFilmstripJobOutputSchema>;

/** `media.makeFilmstrip` (UX2): the scrubber's sprite of frames evenly spaced in time, from the proxy. */
export const mediaMakeFilmstripJob = defineJobKind({
  kind: 'media.makeFilmstrip',
  input: makeFilmstripJobInputSchema,
  output: makeFilmstripJobOutputSchema,
  resource: 'video',
  priority: 'low',
  retry: ONE_RETRY,
  timeoutMs: 10 * 60 * 1000,
  resumable: true,
  idempotencyKey: (input) => `filmstrip:v2:${input.contentHash}`,
});

export const makeThumbnailJobInputSchema = z.object({
  path: z.string().min(1),
  contentHash: HASH,
  plan: normalisationPlanSchema,
});
export type MakeThumbnailJobInput = z.output<typeof makeThumbnailJobInputSchema>;

export const makeThumbnailJobOutputSchema = z.object({
  thumbnail: derivedFileRefSchema,
  decodes: decodeCountSchema.optional(),
});
export type MakeThumbnailJobOutput = z.output<typeof makeThumbnailJobOutputSchema>;

/**
 * `media.makeThumbnail` (IX-D4): the asset's poster frame on its own, so a search result has a picture
 * before the filmstrip and waveform. Five seeks, not a decode of the whole file.
 */
export const mediaMakeThumbnailJob = defineJobKind({
  kind: 'media.makeThumbnail',
  input: makeThumbnailJobInputSchema,
  output: makeThumbnailJobOutputSchema,
  resource: 'video',
  priority: 'low',
  retry: ONE_RETRY,
  timeoutMs: 5 * 60 * 1000,
  idempotencyKey: (input) => `thumbnail:v1:${input.contentHash}`,
});

const rangeSchema = z.object({ start: rationalTimeSchema, duration: rationalTimeSchema.optional() });

export const conformJobInputSchema = z.object({
  path: z.string().min(1),
  contentHash: HASH,
  plan: normalisationPlanSchema,
  range: rangeSchema.optional(),
  maxLongSide: z.int().min(2).max(8192).optional(),
  codec: z.enum(['h264', 'hevc']),
});
export type ConformJobInput = z.output<typeof conformJobInputSchema>;

export const conformJobOutputSchema = z.object({
  file: derivedFileRefSchema,
  driftMs: z.number(),
});
export type ConformJobOutput = z.output<typeof conformJobOutputSchema>;

function rangeToken(range: ConformJobInput['range']): string {
  if (!range) return 'all';
  const bit = (time: { value: number; rate: { num: number; den: number } }) =>
    `${time.value}x${time.rate.num}x${time.rate.den}`;
  return range.duration ? `${bit(range.start)}-${bit(range.duration)}` : bit(range.start);
}

/** `media.conform`: a full-quality upright SDR file for a range, plus measured audio drift. */
export const mediaConformJob = defineJobKind({
  kind: 'media.conform',
  input: conformJobInputSchema,
  output: conformJobOutputSchema,
  resource: 'video',
  priority: 'normal',
  retry: ONE_RETRY,
  timeoutMs: 120 * 60 * 1000,
  resumable: true,
  idempotencyKey: (input) =>
    `conform:v1:${input.contentHash}:${rangeToken(input.range)}:${input.maxLongSide ?? 'full'}:${input.codec}`,
});

export const enforceCacheCapJobInputSchema = z.object({
  capBytes: z.int().positive(),
  offlineHashes: z.array(HASH).max(50_000),
  pinned: z.array(z.string().regex(DERIVED_KEY_PATTERN)).max(50_000),
});
export type EnforceCacheCapJobInput = z.output<typeof enforceCacheCapJobInputSchema>;

export const enforceCacheCapJobOutputSchema = z.object({
  evicted: z.array(z.string().regex(DERIVED_KEY_PATTERN)).max(1000),
  freedBytes: z.int().nonnegative(),
  usageBytes: z.int().nonnegative(),
});
export type EnforceCacheCapJobOutput = z.output<typeof enforceCacheCapJobOutputSchema>;

/** `media.enforceCacheCap`: oldest-first eviction down to 90% of the cap. No idempotency key. */
export const mediaEnforceCacheCapJob = defineJobKind({
  kind: 'media.enforceCacheCap',
  input: enforceCacheCapJobInputSchema,
  output: enforceCacheCapJobOutputSchema,
  resource: 'io',
  priority: 'low',
  retry: NO_RETRY,
  timeoutMs: 5 * 60 * 1000,
  resumable: true,
});

export const phase2JobKinds = [
  mediaNormaliseJob,
  mediaMakeProxyJob,
  mediaMakePreviewsJob,
  mediaMakeFilmstripJob,
  mediaMakeThumbnailJob,
  mediaConformJob,
  mediaEnforceCacheCapJob,
] as const;
