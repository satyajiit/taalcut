// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The preference learner's numbers (SPEC, "Learned casting preferences"), versioned like the casting config so a
 * change to any of them is a reviewed change, never an edit in the learner's code.
 */
import { z } from 'zod';

export const learnerConfigSchema = z.object({
  version: z.string().regex(/^learner\.v[1-9]\d*$/),
  /** The weights don't move until the pairs weigh at least this much (a swap's main pair weighs 1). */
  minEvidence: z.number().positive(),
  /** Pair weights: the shot swapped in over the pick it replaced; over each other alternate the board showed. */
  pairWeight: z.object({
    replaced: z.number().positive().max(1),
    shown: z.number().nonnegative().max(1),
    /** A clip removed after assembly: shared out over the cast picks the creator kept in that timeline. */
    removal: z.number().nonnegative().max(1),
  }),
  /**
   * Pull toward the starting weights, per relative change: (κ / 2) · Σ ((w − start) / default)². Larger: more pairs
   * are needed to move the same distance.
   */
  prior: z.number().positive(),
  /** Projected gradient steps; the fit is deterministic for one input. */
  steps: z.int().min(1).max(10_000),
});

export type LearnerConfig = z.output<typeof learnerConfigSchema>;

export const LEARNER_CONFIG: LearnerConfig = learnerConfigSchema.parse({
  version: 'learner.v1',
  minEvidence: 10,
  pairWeight: { replaced: 1, shown: 0.25, removal: 0.25 },
  prior: 40,
  steps: 400,
});
