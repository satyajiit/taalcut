// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';

/** Editorial choices reference indexed evidence; only the deterministic planner resolves their timing. */
export const proposalSchema = z.object({
  title: z.string().min(1).max(200),
  reason: z.string().min(1).max(2000),
  hook: z.string().min(1).max(1000),
  context: z.string().max(2000),
  payoff: z.string().min(1).max(1000),
  speech: z.array(z.object({ first: z.int().nonnegative(), last: z.int().nonnegative() })).max(20),
  visuals: z.array(z.string().min(1).max(200)).max(30),
});

export type Proposal = z.output<typeof proposalSchema>;
