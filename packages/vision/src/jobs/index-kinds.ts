// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The indexing job kinds (P2-L7, P2-L8, P2-L9): what the library's pipeline
 * enqueues through vision's index stages. All low priority (background
 * indexing); the pipeline raises one to high while someone waits.
 */
import { createHash } from 'node:crypto';
import {
  computeBackendSchema,
  defineJobKind,
  DERIVED_KEY_PATTERN,
  DESCRIPTION_SKIPPED_REASONS,
  EMBEDDING_ITEM_KINDS,
  embeddingSpaceSchema,
  frameRateSchema,
  ORIENTATIONS,
  shotAnalysisSchema,
  shotDescriptionSchema,
  timeRangeSchema,
  type RetryPolicy,
} from '@taalcut/core';
import { decodeCountSchema, normalisationPlanSchema } from '@taalcut/media';
import { z } from 'zod';
import { VISION_CONFIG } from '../config';
import { shotContextSchema } from '../describe/shot-context';

export const retry = (maxAttempts: number): RetryPolicy => ({
  maxAttempts,
  backoff: { kind: 'exponential', initialMs: 2_000, maxMs: 60_000, factor: 2, jitter: true },
});
export const MINUTE = 60_000;

/** The stage that reads on-screen text, named in analyse's output (IX-O5). */
export const TEXT_READER = 'vision.ocr';

/** i18n keys for JobProgress.stageKey (renderer catalogue). */
export const VISION_JOB_STAGES = {
  detectingShots: 'jobs.stage.detectingShots',
  analysingShots: 'jobs.stage.analysingShots',
  embedding: 'jobs.stage.embedding',
  describingShots: 'jobs.stage.describingShots',
  groupingDuplicates: 'jobs.stage.groupingDuplicates',
} as const;

/** What changes frame vectors besides the frames themselves: the embed config's version. */
function embedKeyPart(): string {
  return `embed-v${VISION_CONFIG.embed.version}`;
}

/** `<kind>:v<config>:<content hash, or sha256 of the path>:<extra>`; fits the queue's 512-character key. */
export function visionKey(
  kind: string,
  input: { readonly path: string; readonly contentHash?: string },
  extra = '',
): string {
  const identity = input.contentHash ?? createHash('sha256').update(input.path).digest('hex');
  const tail = extra ? `:${createHash('sha256').update(extra).digest('hex').slice(0, 16)}` : '';
  return `${kind}:v${VISION_CONFIG.version}:${identity}${tail}`;
}

const asset = {
  assetId: z.string().min(1).max(64),
  path: z.string().min(1),
  /** BLAKE3 from library.hash: the idempotency key; absent outside the pipeline. */
  contentHash: z.string().min(1).max(128).optional(),
};

/**
 * Jobs that read the asset's frames: normalise's plan saves a probe (IX-D3); absent, the job probes. With
 * `proxyKey` (and a plan) they decode the stored proxy instead of the original (frame-source-policy.ts).
 */
export const framed = {
  ...asset,
  plan: normalisationPlanSchema.optional(),
  proxyKey: z.string().regex(DERIVED_KEY_PATTERN).optional(),
};
/** FFmpeg and ffprobe runs and decodes the job made (IX-D6), for the bench. */
export const decodes = { decodes: decodeCountSchema.optional() };

const cutSchema = z.object({
  frame: z.int().nonnegative(),
  /** scdet's 0–100, or the model's probability 0–1 (`model`). */
  score: z.number(),
  distance: z.number().optional(),
  method: z.enum(['scdet', 'both', 'model']),
  /** The model's: a hard cut or a gradual transition, and the transition's grid frames (IX2-C4). */
  kind: z.enum(['cut', 'dissolve', 'fade']).optional(),
  span: z.object({ from: z.int().nonnegative(), to: z.int().nonnegative() }).optional(),
});

export const visionDetectShotsJob = defineJobKind({
  kind: 'vision.detectShots',
  input: z.object(framed),
  output: z.object({
    /** Which detector decided (IX2-S2); absent in results stored before. */
    detector: z.enum(['model', 'scdet']).optional(),
    /** Where the model ran when it decided (IX2-S10: `coreml`, `webgpu` or `cpu`); absent before, and for scdet. */
    backend: computeBackendSchema.optional(),
    frameRate: frameRateSchema,
    frameCount: z.int().nonnegative(),
    shots: z.array(timeRangeSchema).max(20_000),
    cuts: z.array(cutSchema).max(20_000),
    ...decodes,
  }),
  // Decode-bound (the analysis pass); TransNetV2 reads the pass's stream as it decodes. The scdet fallback's
  // cut-pair embeddings go through the embedder's own batch queue.
  resource: 'video',
  priority: 'low',
  retry: retry(2),
  timeoutMs: 30 * MINUTE,
  idempotencyKey: (input) => visionKey('vision.detectShots', input, `shots-v${VISION_CONFIG.shots.version}`),
});

export const shotRef = z.object({ shotId: z.string().min(1).max(64), range: timeRangeSchema });

export const visionAnalyzeShotsJob = defineJobKind({
  kind: 'vision.analyzeShots',
  input: z.object({
    ...framed,
    shots: z.array(shotRef).min(1).max(20_000),
  }),
  output: z.object({
    shots: z
      .array(
        z.object({
          shotId: z.string().min(1),
          /** With casting's curves and peaks in `signals`. */
          analysis: shotAnalysisSchema,
        }),
      )
      .max(20_000),
    /**
     * Who reads the shots' on-screen text: `vision.ocr` (IX-O5). Absent in outputs stored before, when the
     * analysis read it itself; `vision.ocr` then leaves that text alone.
     */
    text: z.literal(TEXT_READER).optional(),
    ...decodes,
  }),
  // Decode-bound (the analysis pass, when vision.shots didn't leave it).
  resource: 'video',
  priority: 'low',
  retry: retry(2),
  timeoutMs: 60 * MINUTE,
  idempotencyKey: (input) =>
    visionKey(
      'vision.analyzeShots',
      input,
      JSON.stringify([input.shots.map((s) => s.shotId), `profile-v${VISION_CONFIG.profile.version}`]),
    ),
});

const textItem = z.object({
  itemId: z.string().min(1).max(160),
  kind: z.enum(EMBEDDING_ITEM_KINDS),
  text: z.string().max(8192),
});

/** The item kinds a job's set replaces; absent on jobs queued before IX-E1, which now write frames only (IX-F3). */
const replaces = z.array(z.enum(EMBEDDING_ITEM_KINDS)).min(1).max(EMBEDDING_ITEM_KINDS.length).optional();

/**
 * Frame vectors and on-screen text vectors of one asset (`vision.embed`). Its frames come through the asset's frame
 * source like the other frame jobs (`plan`, `proxyKey`); neither is in the idempotency key (the frames are the same).
 */
export const visionEmbedAssetJob = defineJobKind({
  kind: 'vision.embedAsset',
  input: z.object({
    ...framed,
    sourceId: z.string().min(1).max(64),
    frames: z
      .array(z.object({ shotId: z.string().min(1), frames: z.array(z.int().nonnegative()).max(64) }))
      .max(20_000),
    texts: z.array(textItem).max(50_000),
    replaces,
  }),
  output: z.object({
    space: embeddingSpaceSchema,
    frames: z.int().nonnegative(),
    texts: z.int().nonnegative(),
    removed: z.int().nonnegative(),
    ...decodes,
  }),
  resource: 'gpu',
  lane: 'vision.embedder',
  priority: 'low',
  retry: retry(3),
  timeoutMs: 60 * MINUTE,
  idempotencyKey: (input) =>
    visionKey(
      'vision.embedAsset',
      input,
      JSON.stringify([
        input.frames,
        input.texts.map((t) => [t.itemId, t.text]),
        input.replaces ?? null,
        embedKeyPart(),
      ]),
    ),
});

/** Transcript vectors of one asset (`vision.embedText`, IX-E1): text only, no decode. */
export const visionEmbedTextsJob = defineJobKind({
  kind: 'vision.embedTexts',
  input: z.object({
    ...asset,
    sourceId: z.string().min(1).max(64),
    texts: z.array(textItem).max(50_000),
    replaces: z.array(z.enum(EMBEDDING_ITEM_KINDS)).min(1).max(EMBEDDING_ITEM_KINDS.length),
  }),
  output: z.object({
    space: embeddingSpaceSchema,
    texts: z.int().nonnegative(),
    removed: z.int().nonnegative(),
  }),
  resource: 'gpu',
  lane: 'vision.embedder',
  priority: 'low',
  retry: retry(3),
  timeoutMs: 30 * MINUTE,
  idempotencyKey: (input) =>
    visionKey(
      'vision.embedTexts',
      input,
      JSON.stringify([input.texts.map((t) => [t.itemId, t.text]), input.replaces]),
    ),
});

const describeInput = z.object({
  ...framed,
  rate: frameRateSchema,
  /** Each shot's best frame (and optional chronological frames across the shot), as grid indices of the asset, and what is said and shown around it (LRN1-CTX). */
  shots: z
    .array(
      z.object({
        shotId: z.string().min(1),
        frame: z.int().nonnegative(),
        frames: z.array(z.int().nonnegative()).min(1).max(8).optional(),
        context: shotContextSchema.optional(),
      }),
    )
    .max(20_000),
});

const describeOutput = z.object({
  descriptions: z.array(z.object({ shotId: z.string().min(1), description: shotDescriptionSchema })),
  model: z.object({ provider: z.string(), model: z.string(), local: z.boolean() }).optional(),
  uploadedTo: z.array(z.string()),
  /** `not_yet`: this process has neither the agent's BackgroundModels nor a model client. */
  skipped: z.enum(DESCRIPTION_SKIPPED_REASONS).optional(),
  ...decodes,
});

export type DescribeJobInput = z.output<typeof describeInput>;
export type DescribeJobOutput = z.output<typeof describeOutput>;

export const visionDescribeShotsJob = defineJobKind({
  kind: 'vision.describeShots',
  input: describeInput,
  output: describeOutput,
  // The embedded llama.cpp server on Metal: one slot while video work runs (spike 08).
  resource: 'gpu',
  lane: 'models.llm',
  priority: 'low',
  retry: retry(2),
  timeoutMs: 60 * MINUTE,
  idempotencyKey: (input) => visionKey('vision.describeShots', input, JSON.stringify(input.shots)),
});

export const visionDescribeShotsCloudJob = defineJobKind({
  kind: 'vision.describeShotsCloud',
  input: describeInput,
  output: describeOutput,
  resource: 'network',
  priority: 'low',
  retry: retry(2),
  timeoutMs: 60 * MINUTE,
  idempotencyKey: (input) => visionKey('vision.describeShotsCloud', input, JSON.stringify(input.shots)),
});

export const visionGroupDuplicatesJob = defineJobKind({
  kind: 'vision.groupDuplicates',
  input: z.object({
    shots: z
      .array(
        z.object({
          shotId: z.string().min(1),
          assetId: z.string().min(1),
          sourceId: z.string().min(1),
          capturedAt: z.number().nullable(),
          durationMs: z.number().nonnegative(),
          overall: z.number().min(0).max(1),
          dHash: z.string().regex(/^[0-9a-f]{16}$/),
          orientation: z.enum(ORIENTATIONS),
        }),
      )
      .max(200_000),
  }),
  output: z.object({
    groups: z.array(
      z.object({ groupId: z.string(), shotIds: z.array(z.string()).min(2), bestShotId: z.string() }),
    ),
  }),
  // Vector reads are sqlite-vec on the CPU: ADR 0002's accepted exception.
  resource: 'cpu',
  priority: 'low',
  retry: retry(2),
  timeoutMs: 10 * MINUTE,
});

export const indexJobKinds = [
  visionDetectShotsJob,
  visionAnalyzeShotsJob,
  visionEmbedAssetJob,
  visionEmbedTextsJob,
  visionDescribeShotsJob,
  visionDescribeShotsCloudJob,
  visionGroupDuplicatesJob,
] as const;
