// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { rationalTimeJsonSchema, ulidSchema } from '@taalcut/core';
import { z } from 'zod';

const box = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().positive().max(1),
  height: z.number().positive().max(1),
});
// The command validates bounds and ordered source keys; provider schemas must contain no time transforms.
export const visualLayoutToolInput = z.object({
  projectId: ulidSchema('Project'),
  timelineId: ulidSchema('Timeline'),
  revision: z.int().positive(),
  clipId: ulidSchema('TimelineItem'),
  visualLayout: z
    .object({
      regions: z
        .array(
          z.object({
            id: z.string().min(1).max(60),
            viewport: box,
            fit: z.enum(['cover', 'contain']),
            keyframes: z
              .array(z.object({ at: rationalTimeJsonSchema, crop: box }))
              .min(1)
              .max(128),
          }),
        )
        .min(1)
        .max(2),
    })
    .nullable(),
});

export const visualLayoutJsonSchema = visualLayoutToolInput.shape.visualLayout.unwrap();
