// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1: what a graphic item draws with when the AI designed it as a HyperFrames composition: the composition (by id
 * and content hash, from the timeline's copies) and the values of its variables (its words, its colours). Apart
 * from the composition record (composition.ts) so the timeline's graphics can name one without a cycle, as
 * graphic-params.ts does for DSG1's components.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type Id } from '../basics/ids';
import { graphicParamValuesSchema } from '../templates/graphic-params';
import { sha256Schema } from '../templates/template-parts';

export type GraphicCompositionId = Id<'GraphicComposition'>;

export const graphicCompositionRefSchema = z.object({
  id: idSchema<'GraphicComposition'>(),
  /** The composition's `hash` (composition.ts): exactly the files it was placed with. */
  hash: sha256Schema,
  /** Values for its variables, by name; absent ones take the variable's default (a text's sample). */
  params: graphicParamValuesSchema,
});
export type GraphicCompositionRef = z.output<typeof graphicCompositionRefSchema>;
