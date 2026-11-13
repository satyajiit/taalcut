// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Vision's look jobs (P3-V17), named here so render and templates start them through core's JobRunner without
 * importing vision: measure a clip's look, and bake a grade towards a target into a LUT in the media cache.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { derivedFileRefSchema } from '../analysis/media-facts';
import { idSchema } from '../basics/ids';
import { timeRangeSchema } from '../time/time-range';
import { lookStatsSchema, lutCubeSizeSchema } from './look';

export const MEASURE_LOOK_JOB_KIND = 'vision.measureLook';
export const measureLookJobInputSchema = z.object({ assetId: idSchema<'Asset'>(), range: timeRangeSchema });
export const measureLookJobOutputSchema = z.object({ look: lookStatsSchema });

export const BAKE_GRADE_JOB_KIND = 'vision.bakeGrade';
export const bakeGradeJobInputSchema = z.object({
  assetId: idSchema<'Asset'>(),
  range: timeRangeSchema,
  target: lookStatsSchema,
  strength: z.number().min(0).max(1),
  cubeSize: lutCubeSizeSchema,
});
/** The baked cube in the media cache (DERIVED_KINDS 'gradeLut'). */
export const bakeGradeJobOutputSchema = z.object({ lut: derivedFileRefSchema });
