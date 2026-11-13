// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFitScenario } from '../make/fake-fit';
import type { AreaOptionsReader } from './area-options';

/** LRN1-TPL: the fit area's fake options from `taalcut.fake`: `{ "fit": "noShots" }` or `{ "fit": "failing" }`. */
export const fitOptions: AreaOptionsReader = (stored) => {
  const fit = readFitScenario(stored['fit']);
  return fit ? { make: { areas: { fit } } } : {};
};
