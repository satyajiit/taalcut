// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The normalisation plan. Times and rates here are core's RationalTime and
 * FrameRate. Probe results stay on the integer-rate media time (see time-bridge).
 */
import {
  frameRateSchema,
  mediaFactsSchema,
  rationalTimeSchema,
  type FrameRate,
  type HdrKind,
  type MediaFacts,
  type RationalTime,
} from '@taalcut/core';
import { z } from 'zod';
import { FALLBACK_CODES, type DecodePlan, type ToneMapChoice } from '../backends';
import { HW_VIDEO_BACKEND_IDS } from '../hw-video/types';
import type { ColourInfo, HdrFormat } from '../probe/types';

export const PLAN_RECIPE = 1;

/** Still fields the plan reads. The mac-helper shape is `StillMetadata` in the sidecar. */
export interface PlanStill {
  readonly contentIdentifier?: string;
  readonly orientation?: number;
  /** EXIF DateTimeOriginal, local: '2026:03:01 12:34:56'. */
  readonly captureTime?: string;
  /** EXIF OffsetTimeOriginal (or OffsetTime): '+05:30' (LIB1-OEM). */
  readonly offsetTime?: string;
  readonly latitude?: number;
  readonly longitude?: number;
  readonly altitudeM?: number;
  readonly make?: string;
  readonly model?: string;
  readonly tiled?: boolean;
  readonly format?: string;
}

/** Fields the filter graph needs that are not part of the stored facts. */
export interface PlanSource {
  readonly width: number;
  readonly height: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly bitDepth?: number;
  readonly pixelFormat?: string;
  readonly codec?: string;
  readonly colour: ColourInfo;
  readonly hdrFormats: readonly HdrFormat[];
  readonly dolbyProfile?: number;
  readonly vfr: boolean;
}

export interface NormalisationPlan {
  readonly version: 1;
  readonly recipe: typeof PLAN_RECIPE;
  readonly kind: 'video' | 'image' | 'audio';
  readonly decode: DecodePlan;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly mirrored: boolean;
  readonly hdr: HdrKind;
  readonly toneMap: 'none' | 'required';
  readonly frameRate: { readonly output: FrameRate; readonly native?: FrameRate };
  readonly start: RationalTime;
  readonly duration: RationalTime;
  readonly frames: number;
  readonly audio?: { readonly offset: RationalTime; readonly trimToVideo: boolean };
  readonly speed: { readonly kind: MediaFacts['speed']; readonly factor: number; readonly retimedInFile: boolean };
  readonly still?: { readonly format: string; readonly tiled: boolean };
  readonly source: PlanSource;
  readonly facts: MediaFacts;
  readonly warnings: readonly string[];
}

const decodePlanSchema = z.discriminatedUnion('backend', [
  z.object({ backend: z.enum(HW_VIDEO_BACKEND_IDS), surfaceFormat: z.string() }),
  z.object({
    backend: z.literal('software'),
    fallbackReason: z.object({ code: z.enum(FALLBACK_CODES), detail: z.string() }),
  }),
]);

export const normalisationPlanSchema: z.ZodType<NormalisationPlan> = z.object({
  version: z.literal(1),
  recipe: z.literal(PLAN_RECIPE),
  kind: z.enum(['video', 'image', 'audio']),
  decode: decodePlanSchema,
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  mirrored: z.boolean(),
  hdr: z.enum(['none', 'hlg', 'pq', 'dolby-vision']),
  toneMap: z.enum(['none', 'required']),
  frameRate: z.object({ output: frameRateSchema, native: frameRateSchema.optional() }),
  start: rationalTimeSchema,
  duration: rationalTimeSchema,
  frames: z.int().nonnegative(),
  audio: z.object({ offset: rationalTimeSchema, trimToVideo: z.boolean() }).optional(),
  speed: z.object({
    kind: z.enum(['normal', 'slow-motion', 'time-lapse']),
    factor: z.number().positive().max(1000),
    retimedInFile: z.boolean(),
  }),
  still: z.object({ format: z.string(), tiled: z.boolean() }).optional(),
  source: z.object({
    width: z.int().nonnegative(),
    height: z.int().nonnegative(),
    displayWidth: z.int().nonnegative(),
    displayHeight: z.int().nonnegative(),
    bitDepth: z.int().positive().optional(),
    pixelFormat: z.string().optional(),
    codec: z.string().optional(),
    colour: z.object({
      range: z.string().optional(),
      space: z.string().optional(),
      transfer: z.string().optional(),
      primaries: z.string().optional(),
    }),
    hdrFormats: z.array(z.enum(['hlg', 'pq', 'dolby_vision'])),
    dolbyProfile: z.int().nonnegative().optional(),
    vfr: z.boolean(),
  }),
  facts: mediaFactsSchema,
  warnings: z.array(z.string()),
});

export interface PlanOptions {
  readonly still?: PlanStill;
  readonly sizeBytes?: number;
  readonly livePhoto?: MediaFacts['livePhoto'];
  readonly platform?: NodeJS.Platform;
  readonly decode?: 'auto' | 'software';
}

/** Dolby Vision profile 5 has no HLG/PQ base. The CPU curve cannot grade it. */
export function applyRouteWarnings(plan: NormalisationPlan, toneMap: ToneMapChoice): NormalisationPlan {
  if (toneMap.method === 'libplacebo') return plan;
  if (plan.source.dolbyProfile !== 5) return plan;
  const formats = plan.source.hdrFormats;
  if (formats.includes('hlg') || formats.includes('pq')) return plan;
  if (plan.warnings.includes('dv_profile_5_colours')) return plan;
  return { ...plan, warnings: [...plan.warnings, 'dv_profile_5_colours'] };
}
