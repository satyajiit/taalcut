// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The footage sets by name. A new set is a new module listed here. */
import { FADES_V1 } from './fades-v1';
import { IX_V1 } from './ix-v1';
import type { FootageSet } from './types';

export const FOOTAGE_SETS: Readonly<Record<string, FootageSet>> = {
  [IX_V1.name]: IX_V1,
  [FADES_V1.name]: FADES_V1,
};

export function footageSet(name: string): FootageSet {
  const set = FOOTAGE_SETS[name];
  if (set === undefined) throw new Error(`no footage set '${name}': ${Object.keys(FOOTAGE_SETS).join(', ')}`);
  return set;
}
