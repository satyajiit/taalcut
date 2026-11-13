// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Export presets and platform safe zones (P2-M10). The values live in
 * @taalcut/render; the shape is contract because the renderer's export
 * options, the preview's safe-zone layer and the QA report all name them.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { frameRateSchema } from '../time/frame-rate';

export const PLATFORMS = ['shorts', 'reels', 'tiktok'] as const;
export const platformSchema = z.enum(PLATFORMS);
export type Platform = z.infer<typeof platformSchema>;

export const EXPORT_PRESET_IDS = [
  'shorts',
  'reels',
  'tiktok',
  'device',
  'deviceHevc',
  /** P3-V2: 16:9 and 4:3 output of the same timeline, reframed. */
  'landscape',
  'standard',
  /** LNX1-AV1: AV1 in MP4, offered only where the machine has a working hardware AV1 encoder. */
  'youtubeAv1',
  'deviceAv1',
  'master4k',
  'landscape4k',
  'square',
  'portrait',
  'square2160',
  'portrait2160',
] as const;
export const exportPresetIdSchema = z.enum(EXPORT_PRESET_IDS);
export type ExportPresetId = z.infer<typeof exportPresetIdSchema>;

/** The video codecs an export can be in (LNX1-AV1 adds AV1, which only a hardware encoder writes). */
export const EXPORT_VIDEO_CODECS = ['h264', 'hevc', 'av1'] as const;
export const exportVideoCodecSchema = z.enum(EXPORT_VIDEO_CODECS);
export type ExportVideoCodec = z.infer<typeof exportVideoCodecSchema>;

/** Canvas pixels, origin top left. */
export const rectSchema = z.object({
  x: z.int().nonnegative(),
  y: z.int().nonnegative(),
  width: z.int().positive(),
  height: z.int().positive(),
});
export type Rect = z.infer<typeof rectSchema>;

/** The output canvases: portrait 9:16 (every Phase 2 preset), landscape 16:9 and standard 4:3 (P3-V2). */
export const CANVASES = [
  { width: 2160, height: 2160 },
  { width: 2160, height: 2700 },
  { width: 2160, height: 3840 },
  { width: 3840, height: 2160 },
  { width: 1080, height: 1920 },
  { width: 1920, height: 1080 },
  { width: 1440, height: 1080 },
  { width: 1080, height: 1350 },
  { width: 1080, height: 1080 },
] as const;
export type OutputCanvas = (typeof CANVASES)[number];

export function isOutputCanvas(size: { readonly width: number; readonly height: number }): boolean {
  return CANVASES.some((canvas) => canvas.width === size.width && canvas.height === size.height);
}

export const OVERLAY_KINDS = ['topBar', 'actionRail', 'bottomInfo'] as const;
export const platformOverlaySchema = z.object({ kind: z.enum(OVERLAY_KINDS), rect: rectSchema });

export const exportPresetSchema = z
  .object({
    id: exportPresetIdSchema,
    version: z.int().positive(),
    /** 'render.presets.<id>' */
    labelKey: z.string().min(1),
    platform: platformSchema.nullable(),
    /** One of CANVASES. */
    width: z.int().min(2).max(8192).multipleOf(2),
    height: z.int().min(2).max(8192).multipleOf(2),
    /** Output rates allowed; a timeline at another rate can't use the preset. */
    rates: z.array(frameRateSchema).min(1),
    video: z.object({
      /** The default codec. */
      codec: exportVideoCodecSchema,
      /**
       * LNX1-AV1: every codec the person may export this preset in, the default first (the platform presets: H.264,
       * then HEVC). Absent: `codec` only.
       */
      codecs: z.array(exportVideoCodecSchema).min(1).optional(),
      /** Average bitrate up to 30 fps, and above 30 fps. */
      bitrateKbps: z.int().positive(),
      bitrateKbpsHighRate: z.int().positive(),
    }),
    audio: z.object({
      codec: z.literal('aac'),
      sampleRate: z.literal(48_000),
      channels: z.literal(2),
      bitrateKbps: z.int().positive(),
    }),
    loudness: z.object({
      integratedLufs: z.number(),
      toleranceLu: z.number().positive(),
      truePeakDbtp: z.number(),
    }),
    duration: z.object({ minSeconds: z.int().nonnegative(), maxSeconds: z.int().positive() }),
    /** Text must sit inside this. Device presets use the intersection of the three platforms'. */
    safe: rectSchema,
    /** The platform's UI, for the preview's safe-zone layer. Empty for device presets. */
    overlays: z.array(platformOverlaySchema),
    safeZoneVersion: z.int().positive(),
    /** When the geometry was last matched to app screenshots, e.g. '2026-12-01'. */
    safeZoneCheckedOn: z.iso.date().nullable(),
    /** Where captions start, as a fraction of the height (P3-V2: lower on landscape canvases). */
    captionAnchorY: z.number().min(0).max(1),
  })
  .refine((preset) => ['device', 'deviceHevc', 'deviceAv1'].includes(preset.id) || isOutputCanvas(preset), {
    message: 'Not an output canvas',
    path: ['width'],
  });
export type ExportPreset = z.infer<typeof exportPresetSchema>;
