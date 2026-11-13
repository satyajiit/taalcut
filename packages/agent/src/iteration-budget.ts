// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2: how many rounds the make loop may go, sized by the model's context window like the tool offer
 * (tool-offer.ts), instead of caps sized for the 8k on-device model: two Editor → Reviewer fix rounds
 * (`MAX_FIX_LOOPS`), a skill's own turn limit whatever the model. On the 4B's window the budget is today's; on the
 * owner's subscription it is generous. Read from a step's logged window, so a resumed run and a replay decide alike.
 */
import { MEDIUM_WINDOW, WHOLE_WINDOW } from './tool-offer';

export interface IterationBudget {
  /** Rounds of the make step and the Reviewer per variant after the first review (each with the review's fixes). */
  readonly fixRounds: number;
  /** Drafts (render.draft) one Maker step may render. */
  readonly drafts: number;
  /** A skill step's own turn limit is multiplied by this. */
  readonly turnScale: number;
}

/** The 4B's: today's rounds and turns, and a draft to look at and one more after a fix. */
const SMALL: IterationBudget = { fixRounds: 2, drafts: 2, turnScale: 1 };
const MEDIUM: IterationBudget = { fixRounds: 3, drafts: 4, turnScale: 1.5 };
/** Every cloud and subscription model. */
const WHOLE: IterationBudget = { fixRounds: 4, drafts: 8, turnScale: 3 };

/** The budget for a window (undefined: not known, the smallest). */
export function iterationBudget(window: number | undefined): IterationBudget {
  if (window === undefined || !Number.isFinite(window) || window < MEDIUM_WINDOW) return SMALL;
  return window >= WHOLE_WINDOW ? WHOLE : MEDIUM;
}
