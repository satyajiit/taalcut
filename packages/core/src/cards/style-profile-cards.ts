// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-STY: "What your saved reels have in common" in the chat, when the agent reads a set's style profile
 * (templates.styleProfile's result card). Data only: the view as it was then, its text shown as written.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { styleProfileViewSchema } from '../templates/style-profile';
import { base, runId } from './card-parts';

export const styleProfileCardSchema = z.object({
  type: z.literal('styleProfile'),
  ...base,
  runId,
  view: styleProfileViewSchema,
});
