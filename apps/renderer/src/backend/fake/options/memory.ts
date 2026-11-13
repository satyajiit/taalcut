// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { FAKE_MEMORY_SCENARIOS, type FakeMemoryScenario } from '../memory/fake-memory';
import type { AreaOptionsReader } from './area-options';

/**
 * Settings → Memory's fake options from `taalcut.fake` (LRN1-MEM): `memory` is 'empty', 'slow', 'failing',
 * 'withheld' or 'local' (memory/fake-memory.ts says what each does). Anything else: the seeded items.
 */
export const memoryOptions: AreaOptionsReader = (stored) => {
  const scenario = stored['memory'];
  const known = FAKE_MEMORY_SCENARIOS.find((name): name is FakeMemoryScenario => name === scenario);
  return known ? { phase3: { memory: { scenario: known } } } : {};
};
