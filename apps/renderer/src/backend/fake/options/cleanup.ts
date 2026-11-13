// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { cleanupArea } from '../make/p3/cleanup/cleanup-area';
import type { AreaOptionsReader } from './area-options';

/**
 * The cleanup area's fake options from `taalcut.fake`: `{ "cleanup": { "talkingHead": true } }` seeds the talking
 * head. Off by default, so the Make specs that count the seeded projects keep their numbers.
 */
export const cleanupOptions: AreaOptionsReader = (stored) => {
  const area = cleanupArea(stored);
  return area.talkingHead ? { make: { areas: { cleanup: area } } } : {};
};
