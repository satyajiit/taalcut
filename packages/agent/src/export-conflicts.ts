// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2: an export refused because the timeline moved past the revision it was
 * given (core.conflict) goes back through the Reviewer at the timeline's head,
 * read from the store then, and asks again; a few times at most. Something
 * that keeps moving the timeline (a person editing, a background write) would
 * otherwise send the flow round the Reviewer and the export forever, so after
 * MAX_EXPORT_RETRIES reviews the run stops and says why.
 */
import type { RunContext } from './context';
import type { AgentEvent } from './events';
import { flowFacts } from './flows';
import type { RunState, StepState } from './run-state';

/** Reviews again after an export the timeline's moving refused; the next refusal stops the run. */
export const MAX_EXPORT_RETRIES = 2;

const CONFLICT = 'core.conflict';

/** The error code a tool step's call failed with, if it did. */
export function stepFailure(state: RunState, step: StepState): string | undefined {
  const call = step.toolCallId ? state.toolCalls[step.toolCallId] : undefined;
  return call?.outcome?.kind === 'failed' ? call.outcome.payload.error.code : undefined;
}

/** This variant's exports refused because the timeline moved, this one included. */
export function exportConflicts(state: RunState, variant: number): number {
  return (state.plan ?? []).filter(
    (s) =>
      s.flow?.key === 'export' && (s.flow.variant ?? 1) === variant && stepFailure(state, s) === CONFLICT,
  ).length;
}

/**
 * The export's timeline's head as the store has it now, for the review queued after a refusal. A replay reads it
 * as that review logged it; a store that can't tell gives undefined (the review reads the last handoff's).
 */
export async function conflictHead(ctx: RunContext, step: StepState): Promise<number | undefined> {
  const state = ctx.log.state;
  if (stepFailure(state, step) !== CONFLICT) return undefined;
  const replay = ctx.phase2.replay;
  if (replay) return replay.headAfter?.(step.id);
  const timelineId = flowFacts(state, step).timelineId;
  if (typeof timelineId !== 'string' || !ctx.phase2.refs) return undefined;
  const head = await ctx.phase2.refs.version({ entity: 'timeline', id: timelineId });
  return head.ok && typeof head.value === 'number' ? head.value : undefined;
}

/** The head each refused export read, by its step's id, from the reviews logged after it (for replay). */
export function loggedHeads(events: readonly AgentEvent[]): Map<string, number> {
  const heads = new Map<string, number>();
  for (const event of events) {
    if (event.type !== 'plan.updated' || !event.payload.insertAfter) continue;
    const review = event.payload.steps.find(
      (s) => s.flow?.key === 'reviewer' && typeof s.flow.revision === 'number',
    );
    if (review?.flow?.revision !== undefined && !heads.has(event.payload.insertAfter))
      heads.set(event.payload.insertAfter, review.flow.revision);
  }
  return heads;
}
