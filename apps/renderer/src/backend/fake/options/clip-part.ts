// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { AreaOptionsReader } from './area-options';

/**
 * TRIM1: the Trim tool's fake options from `taalcut.fake`: `{ "clipPart": "samples" }` makes Golden hour's first
 * video play the sample clips in its first scenes (make/fake-part.ts), whose files have real filmstrips and copies
 * to play. Off by default, so the Make specs keep the footage they know.
 */
export const clipPartOptions: AreaOptionsReader = (stored) =>
  stored['clipPart'] === 'samples' ? { make: { areas: { clipPart: 'samples' } } } : {};
