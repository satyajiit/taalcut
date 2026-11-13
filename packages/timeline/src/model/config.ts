// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { MIN_CLIP_FRAMES } from '@taalcut/core';

/** Edit and re-sync constants (SPEC, "Re-sync"). Casting's numbers live in config/casting.v1.json. */
export interface EditConfig {
  readonly version: number;
  /** A moved cut keeps both neighbours at least this long, in canvas frames. */
  readonly minClipFrames: number;
  /** How far a moved cut searches for a grid point, in beats either side. */
  readonly searchBeats: number;
}

export const EDIT_CONFIG: EditConfig = { version: 1, minClipFrames: MIN_CLIP_FRAMES, searchBeats: 2 };
