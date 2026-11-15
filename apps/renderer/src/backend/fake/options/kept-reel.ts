// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AreaOptionsReader } from './area-options';

/**
 * KEEP1's fake option from `taalcut.fake`: `{ "keptReel": true }` seeds the video made from a reel whose last two
 * shots are the reel's own footage (make/p3/seeds/kept-reel.ts), whose chat shows the breakdown and the cast board.
 * Off by default, so the Make specs that count the seeded projects keep their numbers.
 */
export const keptReelOptions: AreaOptionsReader = (stored) =>
  stored['keptReel'] === true ? { make: { areas: { keptReel: true } } } : {};
