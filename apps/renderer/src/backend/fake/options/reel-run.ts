// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AreaOptionsReader } from './area-options';

/**
 * FIX-DOCKCHAT's fake option from `taalcut.fake`: `{ "reelRun": true }` seeds the project a reel run left behind
 * (make/p3/seeds/reel-run.ts), whose chat shows that run's cards beside the editor; `{ "reelRun": "everyCard" }`
 * seeds it with the chat that holds every card instead. Off by default, so the Make specs that count the seeded
 * projects keep their numbers.
 */
export const reelRunOptions: AreaOptionsReader = (stored) => {
  const asked = stored['reelRun'];
  return asked === true || asked === 'everyCard' ? { make: { areas: { reelRun: asked } } } : {};
};
