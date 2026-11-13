// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * OpenCV-style visual QA agent tools:
 * - `vision.inspectCaptionZones`: Evaluates Sobel edge clutter, WCAG luminance contrast, and face/OCR
 *   obstruction overlap across `top`, `middle`, and `bottom` caption bands at a video timestamp.
 * - `vision.checkFrameQuality`: Evaluates Laplacian sharpness, exposure clipping, horizon tilt angle,
 *   and skin-tone locus share. Temporal flash risk is unmeasured for a single frame.
 */
import {
  CAPTION_ANCHOR_ZONES,
  captionPlacementAdviceSchema,
  defineTool,
  err,
  frameVisualQaReportSchema,
  ok,
  ValidationError,
  type AsyncResult,
  type CaptionPlacementAdvice,
  type FrameVisualQaReport,
} from '@taalcut/core';
import { fileFingerprint, type MediaContext } from '@taalcut/media';
import { z } from 'zod';
import { fitLongSide, probeSource, sampleFrames } from '../media/frames';
import { analyseCaptionZones } from '../quality/caption-clutter';
import { reportVisualQaFallback } from '../quality/compute-fallback';
import { evaluateFrameVisualQa } from '../quality/visual-qa';

export const VISUAL_QA_TIMEOUT_MS = 60_000;
const RETRY = { maxAttempts: 2, initialDelayMs: 1000 };
const READ_FILES = { read: ['library', 'user-selected', 'scratch'] } as const;

const obstructionBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

export const inspectCaptionZonesInputSchema = z.object({
  path: z.string().min(1).describe('Absolute path of the video or image file'),
  seconds: z.number().min(0).default(0).describe('Timestamp in seconds to inspect'),
  preferredZone: z.enum(CAPTION_ANCHOR_ZONES).default('bottom'),
  obstructions: z
    .array(obstructionBoxSchema)
    .max(32)
    .optional()
    .describe('Optional normalized [0..1] face, subject, or baked-in subtitle boxes to avoid'),
});
export type InspectCaptionZonesInput = z.output<typeof inspectCaptionZonesInputSchema>;

export const checkFrameQualityInputSchema = z.object({
  path: z.string().min(1).describe('Absolute path of the video or image file'),
  seconds: z.number().min(0).default(0).describe('Timestamp in seconds to inspect'),
});
export type CheckFrameQualityInput = z.output<typeof checkFrameQualityInputSchema>;

export interface VisualQaToolDeps {
  readonly media: MediaContext;
}

async function decodeRgbAtSeconds(
  media: MediaContext,
  path: string,
  seconds: number,
  signal: AbortSignal,
): AsyncResult<{ readonly width: number; readonly height: number; readonly data: Uint8Array }> {
  const source = await probeSource(media, path, signal);
  if (!source.ok) return source;
  const { rate, frameCount } = source.value;
  const maxFrame = Math.max(0, (frameCount ?? 1) - 1);
  const frameIndex = Math.min(maxFrame, Math.max(0, Math.round((seconds * rate.num) / Math.max(1, rate.den))));
  const size = fitLongSide(source.value.width, source.value.height, 320);
  const sampled = await sampleFrames(media, source.value, {
    size,
    format: 'rgb24',
    frames: [frameIndex],
    signal,
  });
  if (!sampled.ok) return sampled;
  const first = sampled.value[0];
  if (!first) return err(ValidationError({ field: 'seconds' }, { detail: 'No frame decoded at timestamp' }));
  return ok(first);
}

export function createInspectCaptionZonesTool(deps: VisualQaToolDeps) {
  return defineTool({
    name: 'vision.inspectCaptionZones',
    version: '1.0.0',
    description:
      'Evaluates caption readability across top, middle, and bottom safe bands of a frame using Sobel edge ' +
      'clutter, WCAG luminance contrast, and overlap with faces or baked-in text. Recommends the cleanest ' +
      'anchorY and whether a translucent backdrop pill is needed.',
    summary: 'Finds the cleanest vertical caption zone and whether a backdrop pill is needed.',
    tags: ['caption', 'clutter', 'contrast', 'readability', 'placement', 'qa', 'vision'],
    input: inspectCaptionZonesInputSchema,
    output: captionPlacementAdviceSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: VISUAL_QA_TIMEOUT_MS,
    retry: RETRY,
    permission: { filesystem: READ_FILES, network: 'none' },
    idempotencyKey: (input) =>
      `${fileFingerprint(input.path)}:${input.seconds}:${input.preferredZone}:${JSON.stringify(input.obstructions ?? [])}`,
    run: async (input, ctx): AsyncResult<CaptionPlacementAdvice> => {
      const frame = await decodeRgbAtSeconds(deps.media, input.path, input.seconds, ctx.signal);
      if (!frame.ok) return frame;
      reportVisualQaFallback(deps.media, 'vision.inspectCaptionZones');
      return ok(
        analyseCaptionZones(frame.value.data, frame.value.width, frame.value.height, {
          preferredZone: input.preferredZone,
          ...(input.obstructions ? { obstructions: input.obstructions } : {}),
        }),
      );
    },
  });
}

export function createCheckFrameQualityTool(deps: VisualQaToolDeps) {
  return defineTool({
    name: 'vision.checkFrameQuality',
    version: '1.0.0',
    description:
      'Runs OpenCV-style visual QA on a frame: Laplacian sharpness, dark/bright exposure clipping, horizon ' +
      'roll/tilt angle in degrees and human skin-tone locus share. Flash risk is null (not measured): ' +
      'a single frame cannot establish temporal flash risk.',
    summary: 'Checks sharpness, exposure clipping, horizon tilt, and skin-tone share of a frame.',
    tags: ['quality', 'qa', 'sharpness', 'horizon', 'tilt', 'skin-tone', 'exposure', 'vision'],
    input: checkFrameQualityInputSchema,
    output: frameVisualQaReportSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: VISUAL_QA_TIMEOUT_MS,
    retry: RETRY,
    permission: { filesystem: READ_FILES, network: 'none' },
    idempotencyKey: (input) => `${fileFingerprint(input.path)}:${input.seconds}`,
    run: async (input, ctx): AsyncResult<FrameVisualQaReport> => {
      const frame = await decodeRgbAtSeconds(deps.media, input.path, input.seconds, ctx.signal);
      if (!frame.ok) return frame;
      reportVisualQaFallback(deps.media, 'vision.checkFrameQuality');
      return ok(evaluateFrameVisualQa(frame.value.data, frame.value.width, frame.value.height));
    },
  });
}

export function visualQaTools(deps: VisualQaToolDeps) {
  return [createInspectCaptionZonesTool(deps), createCheckFrameQualityTool(deps)] as const;
}
