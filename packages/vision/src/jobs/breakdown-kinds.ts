// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The breakdown's job kinds (P2-T4, vision half): someone is waiting for a
 * reference to be analysed, so they run at high priority. Inputs and outputs
 * are plain JSON (no transforms), the same shapes the tools hand the agent.
 */
import { createHash } from 'node:crypto';
import {
  contactSheetAnnotationOptionsSchema,
  defineJobKind,
  type RetryPolicy,
} from '@taalcut/core';
import { fileFingerprint } from '@taalcut/media';
import { z } from 'zod';
import {
  cutListSchema,
  frameRatePlainSchema,
  onScreenTextPlainSchema,
  rationalTimePlainSchema,
  timeRangePlainSchema,
  type TimeRangePlain,
} from '../breakdown/types';
import { VISION_CONFIG } from '../config';

const RETRY: RetryPolicy = { maxAttempts: 2, backoff: { kind: 'fixed', delayMs: 500 } };
const MINUTE = 60_000;
/** The largest sheet a job returns (base64 grows it by a third; the queue stores outputs as JSON). */
export const SHEET_MAX_BYTES = 2 * 1024 * 1024;

/** i18n keys for JobProgress.stageKey (renderer catalogue). */
export const BREAKDOWN_JOB_STAGES = {
  detectingCuts: 'jobs.stage.detectingCuts',
  readingText: 'jobs.stage.readingText',
  makingContactSheet: 'jobs.stage.makingContactSheet',
} as const;

/**
 * `<kind>:v<config>:<sha256 of the content hash or the file fingerprint>:<options>`. The
 * fingerprint (path, size, mtime) changes when the file does, so an edited reel runs again.
 */
export function breakdownKey(
  kind: string,
  input: { readonly path: string; readonly contentHash?: string | undefined },
  options: unknown,
): string {
  const identity = createHash('sha256')
    .update(input.contentHash ?? fileFingerprint(input.path))
    .digest('hex');
  const extra = createHash('sha256')
    .update(JSON.stringify(options ?? null))
    .digest('hex')
    .slice(0, 16);
  return `${kind}:v${VISION_CONFIG.version}:${identity}:${extra}`;
}

const source = {
  path: z.string().min(1).describe('Absolute path of the video'),
  /** A content hash when the caller has one (library assets): a better idempotency key than the path. */
  contentHash: z.string().min(1).max(128).optional(),
};

export const detectCutsJobInputSchema = z.object({
  ...source,
  range: timeRangePlainSchema.optional(),
  sensitivity: z.enum(['normal', 'high']).default('normal'),
});
export type DetectCutsJobInput = z.output<typeof detectCutsJobInputSchema>;

export const visionDetectCutsJob = defineJobKind({
  kind: 'vision.detectCuts',
  input: detectCutsJobInputSchema,
  output: cutListSchema,
  // Decode-bound like vision.detectShots (scdet; confirmations go through the embedder's queue).
  resource: 'video',
  priority: 'high',
  retry: RETRY,
  timeoutMs: 10 * MINUTE,
  idempotencyKey: (input) =>
    breakdownKey('vision.detectCuts', input, {
      range: rangeKey(input.range),
      sensitivity: input.sensitivity,
    }),
});

export const OCR_LANGUAGES = ['en', 'es', 'pt-BR', 'hi'] as const;

export const readOverlaysJobInputSchema = z.object({
  ...source,
  fps: z.number().min(1).max(8).default(VISION_CONFIG.breakdown.ocrFps),
  languages: z.array(z.string().min(2).max(35)).min(1).max(8),
  /** First frames of confirmed cuts: sampled as well, since captions often change on a cut. */
  cutFrames: z.array(z.int().nonnegative()).max(2000).optional(),
  range: timeRangePlainSchema.optional(),
});
export type ReadOverlaysJobInput = z.output<typeof readOverlaysJobInputSchema>;

export const readOverlaysJobOutputSchema = z.object({
  frameRate: frameRatePlainSchema,
  overlays: z.array(onScreenTextPlainSchema).max(200),
  /** More tracks were found than the output holds; the earliest 200 are kept. */
  truncated: z.boolean(),
});
export type ReadOverlaysJobOutput = z.output<typeof readOverlaysJobOutputSchema>;

export const visionReadOverlaysJob = defineJobKind({
  kind: 'vision.readOverlays',
  input: readOverlaysJobInputSchema,
  output: readOverlaysJobOutputSchema,
  // Apple Vision's text recognition runs on the Neural Engine.
  resource: 'npu',
  priority: 'high',
  retry: RETRY,
  timeoutMs: 10 * MINUTE,
  idempotencyKey: (input) =>
    breakdownKey('vision.readOverlays', input, {
      fps: input.fps,
      languages: input.languages,
      cuts: input.cutFrames ?? [],
      range: rangeKey(input.range),
    }),
});

export const sheetLayoutSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('frames'), frames: z.array(z.int().nonnegative()).min(1).max(60) }),
  z.object({ kind: z.literal('times'), at: z.array(rationalTimePlainSchema).min(1).max(60) }),
  /** One tile per shot (its middle frame); `cuts` are the first frames of shots 2…n. */
  z.object({ kind: z.literal('shots'), cuts: z.array(z.int().positive()).max(2000) }),
  /** Contact strips for vision.confirmCuts: one row of frames −2…+2 per candidate. */
  z.object({
    kind: z.literal('strips'),
    candidates: z.array(rationalTimePlainSchema).min(1).max(VISION_CONFIG.strip.perSheet),
  }),
]);
export type SheetLayoutInput = z.output<typeof sheetLayoutSchema>;

export const contactSheetJobInputSchema = z.object({
  ...source,
  layout: sheetLayoutSchema,
  columns: z.int().min(1).max(8).optional(),
  tileLongSide: z.int().min(64).max(512).optional(),
  maxBytes: z
    .int()
    .min(32 * 1024)
    .max(SHEET_MAX_BYTES)
    .optional(),
  annotate: z.union([z.boolean(), contactSheetAnnotationOptionsSchema]).optional(),
});
export type ContactSheetJobInput = z.output<typeof contactSheetJobInputSchema>;

export const contactSheetJobOutputSchema = z.object({
  jpegBase64: z.string().max(Math.ceil(SHEET_MAX_BYTES / 3) * 4),
  width: z.int().positive(),
  height: z.int().positive(),
  columns: z.int().positive(),
  tileWidth: z.int().positive(),
  tileHeight: z.int().positive(),
  frameRate: frameRatePlainSchema,
  layout: z
    .array(
      z.object({
        tile: z.int().nonnegative(),
        frame: z.int().nonnegative(),
        at: rationalTimePlainSchema,
        row: z.int().nonnegative().optional(),
      }),
    )
    .max(60),
});
export type ContactSheetJobOutput = z.output<typeof contactSheetJobOutputSchema>;

export const visionContactSheetJob = defineJobKind({
  kind: 'vision.contactSheet',
  input: contactSheetJobInputSchema,
  output: contactSheetJobOutputSchema,
  // Frame decode and scaling on the hardware video engine.
  resource: 'video',
  priority: 'high',
  retry: RETRY,
  timeoutMs: 2 * MINUTE,
  idempotencyKey: (input) =>
    breakdownKey('vision.contactSheet', input, {
      layout: input.layout,
      columns: input.columns,
      tile: input.tileLongSide,
      max: input.maxBytes,
    }),
});

export const breakdownJobKinds = [visionDetectCutsJob, visionReadOverlaysJob, visionContactSheetJob] as const;

function rangeKey(range: TimeRangePlain | undefined): string {
  if (!range) return 'all';
  const { start, duration } = range;
  return `${start.value}@${start.rate.num}/${start.rate.den}+${duration.value}@${duration.rate.num}/${duration.rate.den}`;
}
