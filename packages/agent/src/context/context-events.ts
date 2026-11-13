// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT1's log types: the corrective turn before a text loop ends a skill step (correction.ts), and a prompt condensed
 * to fit the model's window (compaction.ts). Composed into Phase 3's payloads like the limit events; the envelope,
 * versions and upcasters are events.ts's.
 */

export interface ContextEventPayloads {
  /**
   * A skill step's model answered in words turn after turn where a tool call was due: before the step ends, one note
   * says what the step still needs, which of its tools give it, and how to mend the last refused call. `text` is the
   * note as the model reads it, so a resumed run or a replay builds the same prompt.
   */
  'step.corrected': {
    stepId: string;
    /** The text-only turns in a row when it was written. */
    textTurns: number;
    text: string;
    /** The handoff's fields no tool of this step has returned yet. */
    missing: string[];
    /** The step's tools that return them, else every tool it offers. */
    tools: string[];
    /** The step's last refused call. */
    refusal?: { tool: string; code: string };
  };
  /**
   * AGT2: a round of the Maker's loop ended with a draft (make-rounds.ts): the note of the round as the model reads
   * it, kept in the step's turns like every Taalcut note there, so compaction keeps the loop's progress.
   */
  'step.progress': { stepId: string; round: number; text: string };
  /**
   * The prompt outgrew its share of the model's window, so older parts were condensed before the call. `window` is
   * the model's, as read for this call: replay reads it from here and condenses the same way.
   */
  'context.compacted': {
    modelCallId: string;
    window: number;
    /** Estimated tokens the prompt may take: the window less the answer's room and a margin. */
    budgetTokens: number;
    beforeTokens: number;
    afterTokens: number;
    /** Tool results the model had read, cut to a line. */
    condensedResults: number;
    /** Earlier turns of the step folded into one note (superseded refusals first). */
    droppedTurns: number;
    /** Finished steps folded into one line each. */
    summarisedSteps: number;
    /** Whether it fits now; an irreducible prompt fails before calling the model. */
    fits: boolean;
  };
}

export const CONTEXT_EVENT_VERSIONS: Readonly<Record<keyof ContextEventPayloads, number>> = {
  'step.corrected': 1,
  'step.progress': 1,
  'context.compacted': 1,
};
