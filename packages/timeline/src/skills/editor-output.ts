// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ulidSchema } from '@taalcut/core';
import { z } from 'zod';

export const editorOutputSchema = z.object({
  postCaption: z
    .string()
    .trim()
    .min(1)
    .max(5000)
    .optional()
    .describe(
      'When asked for an Instagram/social post caption: the actual ready-to-copy post text, repeated verbatim in your visible response. This is not a subtitle setting.',
    ),
  timelineId: ulidSchema('Timeline'),
  revision: z.int().min(1),
  notExportedReason: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .optional()
    .describe(
      'Only when a requested export was not produced: the reason, repeated verbatim in your visible message. ' +
        'Do not hand off an export request silently or claim export success without a completed render.export result.',
    ),
  notSavedCoverReason: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .optional()
    .describe(
      'Only when a requested thumbnail or cover could not be saved: explain why, repeated verbatim in your visible message. ' +
        'Otherwise call render.exportCover and inspect the saved image before handoff. A generated backdrop alone is not a saved cover.',
    ),
  notStagedReason: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .optional()
    .describe(
      'Only when a requested handoff to Instagram Edits was not completed: explain the unavailable, declined or failed staging step, repeated verbatim in your visible message. A completed video export alone does not put it in Edits.',
    ),
});
