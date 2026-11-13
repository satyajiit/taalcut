// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2: how many tools a step is offered, sized by the context window of the models its prompt may go to (the
 * smallest in its module's chain). One rule for every skill step, the editor's chat and a plain step. It replaces
 * the fixed numbers LRN1 sized for the 8k on-device model: the five a step loaded when it started
 * (`LOADED_PER_STEP`), the five each findTools call loaded (`FIND_LIMIT`), the sixteen a run kept loaded
 * (`MAX_LOADED_TOOLS`), and the eight named tools a skill was offered whole (`NAMED_TOOLS_OFFERED_WHOLE`, sixteen for
 * the Designer). On the owner's subscription every make step had 3–5 tools; the Editor, the step that edits, had no
 * slip, reframe or graphics tool loaded.
 *
 * The window is read when the step starts and logged in its `route.chosen`, so its turns, a resumed run and a replay
 * all offer the same tools. A window nobody knows gets the smallest offer, the one every model fits.
 */

/**
 * The smallest window a local model is given (models/local-runtime SMALLEST_LOCAL_WINDOW): today's offer, unchanged.
 * The 4B runs at 12,288 on a recommended Mac and 32,768 on a high one; 8,192 is the floor for one nothing measured.
 */
export const SMALL_WINDOW = 8_192;
/** The 9B's window, and the 4B's on a high Mac. */
export const MEDIUM_WINDOW = 32_768;
/** From here (every cloud and subscription model) a skill step is offered every tool it allows, on every turn. */
export const WHOLE_WINDOW = 131_072;

export interface ToolOffer {
  /** Every tool the step allows, on every turn: no search, and no findTools turn to widen it. */
  readonly all: boolean;
  /** Otherwise: the tools the step's route loads when it starts, and that each findTools call loads. */
  readonly search: number;
  /**
   * Otherwise: the most registry tools one turn carries. A skill that names its tools (no family) and no more than
   * this many is offered them all; a step that searches is offered the newest this many it loaded.
   */
  readonly turn: number;
  /**
   * Otherwise: the most of its tools a step's prompt lists in its catalogue (the ones nearest its route query); the
   * rest findTools finds. AGT2: the Maker's 55 lines were 1,384 of its 6,391 first-turn tokens on the 4B at 8,192.
   */
  readonly catalogue: number;
}

/** At SMALL_WINDOW, and below it: the 4B's offer as LRN1 measured it, and a catalogue of sixteen. */
const SMALL = { search: 5, turn: 16, catalogue: 16 } as const;
/**
 * At MEDIUM_WINDOW: eight searched, twice the turn's, and every catalogue line any skill has today. Eight, not twelve,
 * from the live 9B edit eval at 32,768 (67 cases, one run each, the server's own sampling): twelve passed 59 and 58 of
 * the 62 non-graphics cases with 2 edits out of target in both runs (the same "here" speed request set on another
 * clip); eight passed 60 with none out of target; five, 62 with none. Each of eight and five made one or two
 * malformed calls it mended on its next call, as five did with no window (EDT1's bar: 60, none, none).
 */
const MEDIUM = { search: 8, turn: 32, catalogue: 64 } as const;

/** The step's offer for a window (undefined: not known). Linear between the two local tiers, and on past them. */
export function toolOffer(window: number | undefined): ToolOffer {
  const known = window !== undefined && Number.isFinite(window) && window > 0 ? window : SMALL_WINDOW;
  const scale = Math.max(0, (known - SMALL_WINDOW) / (MEDIUM_WINDOW - SMALL_WINDOW));
  return {
    all: known >= WHOLE_WINDOW,
    search: Math.round(SMALL.search + (MEDIUM.search - SMALL.search) * scale),
    turn: Math.round(SMALL.turn + (MEDIUM.turn - SMALL.turn) * scale),
    catalogue: Math.round(SMALL.catalogue + (MEDIUM.catalogue - SMALL.catalogue) * scale),
  };
}
