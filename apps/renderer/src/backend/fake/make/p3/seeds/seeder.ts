// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Timeline } from '@taalcut/core';
import type { TimelinePlan } from '../../build';
import type { SeededProject } from '../../seeded-project';
import type { PoolShot } from '../../shot-pool';

/**
 * What an area's seed gets: `build` makes a timeline from a plan (and keeps its shots for the editor and
 * "Find something else"), `pool` a shot pool from the fake library, as seed.ts makes them; `areas` the
 * areas' options.
 */
export interface SeedTools {
  readonly build: (plan: TimelinePlan) => Timeline;
  readonly pool: (count: number, seed: number) => readonly PoolShot[];
  /** Each area's own scenario options (FakeMakeOptions.areas); read only your area's key. */
  readonly areas: Readonly<Record<string, unknown>>;
}

export type Seeder = (tools: SeedTools) => readonly SeededProject[];
