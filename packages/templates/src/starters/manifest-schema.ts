// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Shape of `starters/manifest.json` (P3-B3). Checked when the manifest module loads. */
import { APP_LOCALES, FORMAT_IDS, STARTER_NEEDS, starterIdSchema } from '@taalcut/core';
import { z } from 'zod';

export const starterEntrySchema = z.object({
  id: starterIdSchema,
  file: z.string().regex(/^[a-z0-9-]+\.json$/),
  formatId: z.enum(FORMAT_IDS),
  locales: z.union([z.literal('all'), z.array(z.enum(APP_LOCALES)).min(1).max(APP_LOCALES.length)]),
  nameKey: z.string().min(1).max(100),
  descriptionKey: z.string().min(1).max(120),
  order: z.int().nonnegative(),
  needs: z.enum(STARTER_NEEDS),
});
export type StarterEntry = z.output<typeof starterEntrySchema>;

export const starterManifestSchema = z
  .array(starterEntrySchema)
  .min(1)
  .max(30)
  .refine((entries) => new Set(entries.map((entry) => entry.id)).size === entries.length, {
    message: 'duplicate starter id',
  })
  .refine((entries) => new Set(entries.map((entry) => entry.file)).size === entries.length, {
    message: 'duplicate starter file',
  });
