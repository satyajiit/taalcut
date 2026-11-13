// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readGapsArea } from '../make/p3/gaps/gaps-area';
import type { AreaOptionsReader } from './area-options';

/** The gaps area's fake options from `taalcut.fake` (`gaps: { punch, stock }`). */
export const gapsOptions: AreaOptionsReader = (stored) => {
  const gaps = readGapsArea(stored['gaps']);
  return Object.keys(gaps).length > 0 ? { make: { areas: { gaps } } } : {};
};
