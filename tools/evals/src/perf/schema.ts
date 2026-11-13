// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';

const runnerSchema = z
  .object({
    id: z.string(),
    chip: z.string(),
    memoryGb: z.number(),
    macos: z.string(),
  })
  .strict();

const buildSchema = z
  .object({
    flavour: z.string(),
    version: z.string(),
  })
  .strict();

/** One nightly performance result. Append-only JSONL, one object per line. */
export const perfRowSchema = z
  .object({
    v: z.literal(1),
    suite: z.string(),
    metric: z.string(),
    unit: z.string(),
    value: z.number(),
    better: z.enum(['lower', 'higher']),
    runner: runnerSchema,
    commit: z.string(),
    date: z.string(),
    synthetic: z.boolean(),
    footage: z.enum(['device-lab', 'synthetic']),
    build: buildSchema,
    /**
     * Why a run behind this number was noisy (the indexing bench's noise check, IX-B1); absent when none was. A noisy
     * row never sets a baseline and never files a regression (IX-F3).
     */
    noisy: z.array(z.string()).min(1).optional(),
  })
  .strict();

export type PerfRow = z.infer<typeof perfRowSchema>;

export function parsePerfRow(value: unknown): PerfRow {
  return perfRowSchema.parse(value);
}
