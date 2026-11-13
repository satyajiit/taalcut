// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type SoakScenario } from '../scenario';
import { importIndexScenario } from './import-index-8h';
import { rendersScenario } from './renders-50';
import { updateUnderLoadScenario } from './update-under-load';

/** One import per scenario. The runner walks this list and does not switch on id. */
export const SOAK_SCENARIOS: readonly SoakScenario[] = [
  importIndexScenario,
  rendersScenario,
  updateUnderLoadScenario,
];
