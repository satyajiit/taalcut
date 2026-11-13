// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Variants of one request (P3-V3): what each differs in from the base video, for the `variantsCompare` card.
 * `timeline.makeVariants` is a tool over `timeline.create`; no command of its own.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { captionPresetIdSchema } from '../render/caption-presets';
import { musicChoiceSchema } from '../render/music';

export const VARIANT_AXES = ['hook', 'music', 'captions'] as const;
export type VariantAxis = (typeof VARIANT_AXES)[number];

/** The hook window: slots that start before this many seconds. */
export const HOOK_WINDOW_SECONDS = 3;

export const variantDifferenceSchema = z.object({
  timelineId: idSchema<'Timeline'>(),
  hookChanged: z.boolean(),
  /** Share of slots whose pick differs from the base's. */
  picksChanged: z.number().min(0).max(1),
  /** Null: the same as the base. */
  music: musicChoiceSchema.nullable(),
  /** Null: the same as the base. */
  captionPreset: captionPresetIdSchema.nullable(),
});
export type VariantDifference = z.output<typeof variantDifferenceSchema>;

/** Fewer variants made than asked, and on which axis the library ran out. */
export const variantsShortSchema = z.object({
  axis: z.enum(VARIANT_AXES),
  asked: z.int().min(1),
  made: z.int().min(0),
});
export type VariantsShort = z.output<typeof variantsShortSchema>;
