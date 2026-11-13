// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import '../basics/zod-config';
import { z } from 'zod';
import { RationalTime, rationalTimeSchema } from '../time/rational-time';

const normalizedBox = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine(
    (box) => box.x + box.width <= 1.000001 && box.y + box.height <= 1.000001,
    'Region must fit within its frame',
  );

/** Two views of the same source instant; source audio is still emitted once. */
export const clipVisualLayoutSchema = z
  .object({
    regions: z
      .array(
        z.object({
          id: z.string().min(1).max(60),
          viewport: normalizedBox,
          fit: z.enum(['cover', 'contain']),
          keyframes: z
            .array(
              z.object({
                at: rationalTimeSchema.refine((time) => time.value >= 0),
                crop: normalizedBox,
              }),
            )
            .min(1)
            .max(128)
            .refine(
              (keys) =>
                keys.every(
                  (key, index) => index === 0 || RationalTime.compare(keys[index - 1]!.at, key.at) < 0,
                ),
              'Crop keys must increase',
            ),
        }),
      )
      .min(1)
      .max(2),
  })
  .refine(
    ({ regions }) => new Set(regions.map((region) => region.id)).size === regions.length,
    'Region ids must be distinct',
  )
  .refine(({ regions }) => {
    const first = regions[0]?.viewport;
    const second = regions[1]?.viewport;
    if (!first || !second) return true;
    return (
      first.x + first.width <= second.x + 0.000001 ||
      second.x + second.width <= first.x + 0.000001 ||
      first.y + first.height <= second.y + 0.000001 ||
      second.y + second.height <= first.y + 0.000001
    );
  }, 'Native viewports must not overlap');
export type ClipVisualLayout = z.output<typeof clipVisualLayoutSchema>;
