// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Contact sheet Set-of-Mark (SoM) annotations and OpenCV-style caption clutter & visual QA reports.
 */
import '../basics/zod-config';
import { z } from 'zod';

export const ANNOTATION_BOX_KINDS = ['face', 'person', 'subject', 'text', 'safeZone'] as const;
export type AnnotationBoxKind = (typeof ANNOTATION_BOX_KINDS)[number];

/** Normalized [0, 1] box with a semantic kind and optional short tag (`F1`, `T1`, `SAFE`). */
export const annotatedBoxSchema = z.object({
  kind: z.enum(ANNOTATION_BOX_KINDS),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
  label: z.string().max(24).optional(),
});
export type AnnotatedBox = z.output<typeof annotatedBoxSchema>;

/** Per-tile visual overlay instructions for Set-of-Mark contact sheets and cut-confirmation strips. */
export const tileAnnotationSchema = z.object({
  /** Top-left badge text, e.g. `#1 · 00:01.20` or `R1 · 0f`. */
  badge: z.string().max(32).optional(),
  /** Top-right secondary badge, e.g. `CUT?` or `REEL`. */
  cornerTag: z.string().max(16).optional(),
  /** Draw a 2 px highlight border around the entire tile (e.g. candidate cut frame in a strip). */
  highlight: z.boolean().default(false),
  /** Normalized bounding boxes to draw inside the tile. */
  boxes: z.array(annotatedBoxSchema).max(16).default([]),
  /** Optional normalized [0, 1] audio envelope bars drawn along the bottom edge of the tile. */
  waveformBars: z.array(z.number().min(0).max(1)).max(64).optional(),
});
export type TileAnnotation = z.output<typeof tileAnnotationSchema>;

export const contactSheetAnnotationOptionsSchema = z.object({
  /** Burn tile numbers and timestamps (`#1 · 00:01.24`) into each tile's top-left corner. */
  badges: z.boolean().default(true),
  /** Optional platform safe-zone rectangle (normalized 0..1) drawn as a dashed guide on each tile. */
  safeZone: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().min(0).max(1),
      height: z.number().min(0).max(1),
    })
    .optional(),
});
export type ContactSheetAnnotationOptions = z.output<typeof contactSheetAnnotationOptionsSchema>;

export const CAPTION_ANCHOR_ZONES = ['top', 'middle', 'bottom'] as const;
export type CaptionAnchorZone = (typeof CAPTION_ANCHOR_ZONES)[number];

export const captionZoneStatsSchema = z.object({
  zone: z.enum(CAPTION_ANCHOR_ZONES),
  anchorY: z.number().min(0.05).max(0.95),
  /** Normalized Sobel gradient edge energy in [0, 1]; > 0.28 indicates busy visual texture. */
  edgeClutter: z.number().min(0).max(1),
  /** Mean relative luminance (0..255) under the caption band. */
  lumaMean: z.number().min(0).max(255),
  /** Luminance standard deviation (0..128) under the caption band. */
  lumaStd: z.number().min(0).max(255),
  /** WCAG contrast ratio (1..21) between candidate text fill colour and the background patch. */
  contrastRatio: z.number().min(1).max(21),
  /** Share of the caption band overlapping tracked faces or baked-in text [0..1]. */
  obstructionOverlap: z.number().min(0).max(1),
  /** True when bare text (without a translucent pill backdrop) would be hard to read. */
  needsBackdropPill: z.boolean(),
  /** Overall suitability score in [0, 1] (higher is cleaner). */
  score: z.number().min(0).max(1),
});
export type CaptionZoneStats = z.output<typeof captionZoneStatsSchema>;

export const captionPlacementAdviceSchema = z.object({
  recommendedZone: z.enum(CAPTION_ANCHOR_ZONES),
  recommendedAnchorY: z.number().min(0.05).max(0.95),
  needsBackdropPill: z.boolean(),
  recommendedBackdropOpacity: z.number().min(0).max(0.9),
  zones: z.array(captionZoneStatsSchema).length(3),
});
export type CaptionPlacementAdvice = z.output<typeof captionPlacementAdviceSchema>;

export const frameVisualQaReportSchema = z.object({
  laplacianSharpness: z.number().nonnegative(),
  lumaMean: z.number().min(0).max(255),
  darkClippedShare: z.number().min(0).max(1),
  brightClippedShare: z.number().min(0).max(1),
  /** Estimated horizon roll/tilt in degrees [-15, 15] from dominant near-horizontal gradients. */
  horizonTiltDegrees: z.number().min(-45).max(45),
  horizonConfidence: z.number().min(0).max(1),
  /** Share of pixels falling inside the human skin-tone locus [0, 1]. */
  skinToneShare: z.number().min(0).max(1),
  /** Luminance-transition heuristic across a sequence; null means not measured, never a safety clearance. */
  pseFlashRisk: z.boolean().nullable(),
  maxFlashesPerSecond: z.number().nonnegative().nullable(),
});
export type FrameVisualQaReport = z.output<typeof frameVisualQaReportSchema>;
