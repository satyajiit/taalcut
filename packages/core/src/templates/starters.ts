// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Starter templates (P3-B3, P3-L2): bundled hub documents that let a first video work without a reference.
 * They are not in the store until chosen: `template.addStarter` forks one (provenance 'starter') under an id the
 * caller made, and the chat then starts with `{ path: 'template', templateId }`. Length, slot count and tempo
 * come from `structure`.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { hubStructureSchema } from '../hub/hub-template';
import { FORMAT_IDS } from './template-parts';

/** 'weekend-trip': kebab case, fixed per starter. */
export const starterIdSchema = z
  .string()
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** The footage a starter needs, so the picker puts the best fit for the library first. */
export const STARTER_NEEDS = [
  'many-clips',
  'day-clips',
  'two-clips',
  'talking',
  'steps',
  'product',
  'conversation',
] as const;
export type StarterNeed = (typeof STARTER_NEEDS)[number];

export const starterSummarySchema = z.object({
  starterId: starterIdSchema,
  /** The renderer catalogue's key for its name (starters.<id>.name). */
  nameKey: z.string().min(1).max(100),
  formatId: z.enum(FORMAT_IDS).nullable(),
  /** Its words come from the catalogue (starters.needs.<need>). */
  needs: z.enum(STARTER_NEEDS),
  /** For the StructurePreview (D9: no frames): slots, beats, text placeholders. */
  structure: hubStructureSchema,
});
export type StarterSummary = z.output<typeof starterSummarySchema>;
