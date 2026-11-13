// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2: the Maker's rounds. A round ends with a draft (render.draft); the step may render as many as its iteration
 * budget gives (iteration-budget.ts, by the window its route logged), and each draft is followed by a one-line note
 * of the round (`step.progress`): which draft, how QA went, and how many drafts are left. The note is a Taalcut note
 * in the step's turns, so compaction keeps it however long the loop runs (context/compaction.ts never cuts the
 * current step's notes). Pure over the logged state and the call's logged output, so a replay writes the same notes.
 */
import type { ToolResult } from '@taalcut/tools';
import { OutsideSkill } from './errors';
import { FLOW_SKILLS } from './flows';
import { iterationBudget } from './iteration-budget';
import type { EventInput } from './run-log';
import type { RunState, StepState, ToolCallState } from './run-state';

/** The tool that ends a round. */
export const DRAFT_TOOL = 'render.draft';

type Facts = Record<string, unknown>;
const record = (value: unknown): Facts =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Facts) : {};

/** Whether the step runs rounds: the Maker's. */
const roundsIn = (step: StepState | undefined): step is StepState => step?.skill === FLOW_SKILLS.maker;

/** The step's drafts so far: its completed render.draft calls. */
function draftsIn(state: RunState, step: StepState): number {
  const index = state.plan?.indexOf(step) ?? -1;
  return state.transcript.reduce((count, item) => {
    if (item.kind !== 'assistant' || item.step !== index) return count;
    const drafts = item.toolCallIds.filter((id) => {
      const call: ToolCallState | undefined = state.toolCalls[id];
      return call?.requested.tool === DRAFT_TOOL && call.outcome?.kind === 'completed';
    });
    return count + drafts.length;
  }, 0);
}

/** A draft the step's budget has no room for: refused, saying what to do instead. Undefined: it may run. */
export function draftRefusal(state: RunState, step: StepState | undefined, tool: string) {
  if (tool !== DRAFT_TOOL || !roundsIn(step)) return undefined;
  const budget = iterationBudget(step.window).drafts;
  if (draftsIn(state, step) < budget) return undefined;
  return OutsideSkill(
    { skill: step.skill ?? '', tool },
    {
      detail: `This step's ${budget} drafts are used. Call video.done with the last draft, giving a reason for each slot you couldn't fix, or hand off: the Reviewer drafts it again.`,
    },
  );
}

/** The round's note after a completed draft in the Maker's step; none for any other call or step. */
export function roundEvents(state: RunState, step: StepState | undefined, result: ToolResult): EventInput[] {
  if (result.tool !== DRAFT_TOOL || !roundsIn(step)) return [];
  const round = draftsIn(state, step) + 1;
  const left = Math.max(0, iterationBudget(step.window).drafts - round);
  const output = result.output.kind === 'inline' ? record(result.output.value) : {};
  const render = record(output.render).id;
  const revision = output.timelineRevision;
  const failing = Array.isArray(output.failing)
    ? output.failing.map((check) => record(check).id).filter((id): id is string => typeof id === 'string')
    : [];
  const draft = typeof render === 'string' ? `draft ${render}` : 'a draft';
  const of = typeof revision === 'number' ? ` of revision ${revision}` : '';
  const qa =
    output.passed === true
      ? 'QA passed'
      : failing.length > 0
        ? `QA failed: ${failing.join(', ')}`
        : 'QA did not pass';
  const next =
    left > 0
      ? `${left} draft${left === 1 ? '' : 's'} left: fix what differs and draft again, or call video.done.`
      : 'No drafts left: call video.done with it, or hand off.';
  return [
    ['step.progress', { stepId: step.id, round, text: `Round ${round}: ${draft}${of}, ${qa}. ${next}` }],
  ];
}
