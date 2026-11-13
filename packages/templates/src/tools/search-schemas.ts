// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The input and output of `templates.search` (LRN1-TPL, library-tools.ts). The output names which lists found each
 * hit (TEMPLATE_SEARCH_MATCHES) and marks the template's name as the user's text for the model.
 */
import { FORMAT_IDS, TEMPLATE_SEARCH_MATCHES, ulidSchema } from '@taalcut/core';
import { z } from 'zod';
import { plainTimeSchema } from './schemas';

export const searchInputSchema = z.object({
  text: z.string().trim().min(1).max(200).describe('What the user wants to make, in their words'),
  includeUnlisted: z.boolean().optional().describe('Also plans made for one brief (default false)'),
  formatId: z.enum(FORMAT_IDS).optional(),
  origin: z.enum(['reference', 'format', 'manual']).optional(),
  limit: z.int().min(1).max(50).optional(),
});
export type SearchToolInput = z.output<typeof searchInputSchema>;

/** A template's name is the user's, or a reference's title the user kept. */
const userText = z.string().meta({ untrusted: 'user-text' });

export const searchOutputSchema = z.object({
  hits: z.array(
    z.object({
      id: ulidSchema('Template'),
      name: userText,
      head: z.int(),
      origin: z.string(),
      platform: z.string().nullable(),
      duration: plainTimeSchema,
      slotCount: z.int(),
      score: z.number().min(0).max(1),
      matchedBy: z.array(z.enum(TEMPLATE_SEARCH_MATCHES)),
      slotId: ulidSchema('TemplateSlot').nullable(),
    }),
  ),
  degraded: z.enum(['keyword-only']).nullable(),
  fusion: z.string(),
});
