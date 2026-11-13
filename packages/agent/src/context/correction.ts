// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT1: one corrective turn before a text loop ends a skill step (SPEC section 35). BRK1-MAKE's guard ended the step
 * after `maxTextTurns` answers in words; on the owner's reel the 9B gave up that way after its intents were refused
 * ("I can't build a template from it without breaking the rules"), and the breakdown was lost one call short. Before
 * the step ends, Taalcut writes one note: what the handoff still needs, which of the step's tools return it, the last
 * refused call and what it said, and the handOff to make once it is all there. If the model answers in words again,
 * the step ends as before. A step gets at most MAX_CORRECTIONS of them.
 */
import type { RunContext } from '../context';
import { HAND_OFF_TOOL } from '../meta-tools';
import type { EventInput } from '../run-log';
import type { StepState } from '../run-state';
import { handoffNeeds } from './handoff-needs';

/** Corrective notes one step may get: one per text loop, two loops at most. */
export const MAX_CORRECTIONS = 2;
/** What the note quotes of a refusal. */
const REFUSAL_CHARS = 400;
/** What the note quotes of a ready handoff. */
const HANDOFF_CHARS = 600;

/** The step.corrected event for a step whose model answered in words `textTurns` times in a row. */
export function correctionEvent(ctx: RunContext, step: StepState): EventInput {
  const { calls, required, seen, missing, tools, givers } = handoffNeeds(ctx, step);
  const named = missing.length === 0 ? [HAND_OFF_TOOL] : givers.length > 0 ? givers : tools;
  const refused = calls.findLast((call) => call.outcome?.kind === 'failed');
  const failure = refused?.outcome?.kind === 'failed' ? refused.outcome.payload.error : undefined;
  const lines = [
    `Your last ${step.textTurns ?? 0} answers called no tool, and this step only moves through its tools: words alone end it with nothing made.`,
  ];
  if (missing.length > 0)
    lines.push(
      `It still needs ${missing.join(', ')}: ${named.join(' or ')} ${named.length > 1 ? 'return' : 'returns'} them. ` +
        "If the tool's schema is not offered, load it with findTools first. Then call it.",
    );
  if (refused && failure)
    lines.push(
      `Your last refused call was ${refused.requested.tool} (${failure.code}): ${(failure.detail ?? '').slice(0, REFUSAL_CHARS)} Mend that call and send it again.`,
    );
  if (missing.length === 0) {
    const handoff = Object.fromEntries(required.map((key) => [key, seen.get(key)]));
    lines.push(
      `Everything the handoff needs is here: call handOff with ${JSON.stringify(handoff).slice(0, HANDOFF_CHARS)}.`,
    );
  } else lines.push('When the work is done, call handOff with what the tools returned.');
  return [
    'step.corrected',
    {
      stepId: step.id,
      textTurns: step.textTurns ?? 0,
      text: lines.join(' '),
      missing,
      tools: named,
      ...(refused && failure ? { refusal: { tool: refused.requested.tool, code: failure.code } } : {}),
    },
  ];
}

/** Whether a text loop gets its corrective note now (else it ends, or the model answers the note first). */
export function correctionDue(step: StepState): boolean {
  return step.correctedAt === undefined && (step.corrections ?? 0) < MAX_CORRECTIONS;
}

/** Whether the model answered the corrective note in words too: the step ends. */
export function correctionSpent(step: StepState): boolean {
  return step.correctedAt === undefined || (step.textTurns ?? 0) > step.correctedAt;
}
