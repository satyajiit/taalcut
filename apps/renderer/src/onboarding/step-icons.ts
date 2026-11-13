// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { VERB_ICONS } from '@taalcut/ui';

/**
 * First run's actions and their glyphs (UX4, the icon registry). Back is the registry's own arrow, and the way on is
 * its mirror (`next`), after the words (a step forward).
 */
export const STEP_ICONS = {
  back: VERB_ICONS.back,
  next: VERB_ICONS.next,
  agree: VERB_ICONS.approve,
  retry: VERB_ICONS.retry,
  makeVideo: VERB_ICONS.makeVideo,
} as const;
