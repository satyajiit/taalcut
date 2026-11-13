// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Who made a designed graphic and from what, and how a check came out (DSG1, HFW1). Apart from
 * graphic-components.ts so compositions (workspace/composition.ts) share them without a cycle; graphic-components.ts
 * re-exports them. HFW1 retire: DSG1's design-loop `match` is gone.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { graphicBriefSchema } from './graphic-brief';

/** How one check came out. */
export const GRAPHIC_CHECK_STATUSES = ['pass', 'repaired', 'fail', 'skipped'] as const;

/** Who made a composition and from what. */
export const graphicProvenanceSchema = z.object({
  /** The model that wrote it; null for one a person or Taalcut's own code wrote. */
  model: z
    .object({
      id: z.string().min(1).max(120),
      onDevice: z.boolean(),
    })
    .nullable(),
  /** The template overlays whose crops it was designed from. */
  overlays: z.array(idSchema<'TextOverlay'>()).max(100),
  /** A snapshot of the brief (DSG1-READ, graphic-brief.ts) it was designed from; null without one. */
  brief: graphicBriefSchema.nullable(),
  /** The person's words when it was restyled in chat ("make the bubbles blue"). Untrusted text. */
  request: z.string().max(500).optional(),
  createdAt: z.int().nonnegative(),
});
export type GraphicProvenance = z.output<typeof graphicProvenanceSchema>;
