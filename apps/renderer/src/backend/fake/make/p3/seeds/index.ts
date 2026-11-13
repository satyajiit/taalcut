// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { SeededProject } from '../../seeded-project';
import { seedCleanup } from './cleanup';
import { seedGaps } from './gaps';
import type { SeedTools } from './seeder';
import { seedVariants } from './variants';

/** Every Phase 3 area's seeded projects, after Phase 2's. */
export function seedPhase3(tools: SeedTools): SeededProject[] {
  return [...seedGaps(tools), ...seedCleanup(tools), ...seedVariants(tools)];
}
