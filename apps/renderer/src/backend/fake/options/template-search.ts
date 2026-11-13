// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readTemplateSearchScenario } from '../templates/fake-template-search';
import type { AreaOptionsReader } from './area-options';

/**
 * LRN1-TPL: the Templates page search's fake options from `taalcut.fake`: `{ "templateSearch": "ready" }` (meaning and
 * slot intents searched too) or `{ "templateSearch": "failing" }`; absent, words only, as before the model is here.
 */
export const templateSearchOptions: AreaOptionsReader = (stored) => {
  const templateSearch = readTemplateSearchScenario(stored['templateSearch']);
  return templateSearch ? { phase2: { templateSearch } } : {};
};
