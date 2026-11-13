// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** listen-pick's bar, read from tools/evals/ci-paths.json (`thresholds['listen-pick']`). */
import { z } from 'zod';
import paths from '../../ci-paths.json' with { type: 'json' };

const schema = z.object({
  thresholds: z.object({ 'listen-pick': z.object({ top5FamilyRate: z.number().min(0).max(1) }) }),
});

export const PICK_BAR = schema.parse(paths).thresholds['listen-pick'];
