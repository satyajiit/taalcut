// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-MAKE (gate should-fix 7): what an earlier flow that didn't finish left, for the next run's history. After
 * the owner's make failed a step's check, "Try again" got "I already built that video…" from a model that saw
 * only "That request failed." under a list of tools that had run. The note now says which step stopped and why,
 * what each step before it made (by id and version), and that nothing was exported, so the model can't claim a
 * video that doesn't exist. Pure, from the folded log.
 */
import type { RunState, StepState } from './run-state';

/** The error's detail, in characters. */
const DETAIL_LIMIT = 300;

const VERBS: Readonly<Record<string, string>> = {
  failed: 'failed',
  cancelled: 'was stopped',
  paused: 'is waiting for an answer',
  running: 'is still running',
};

const nameOf = (step: StepState) => step.skill ?? step.tool ?? step.flow?.key ?? step.text ?? step.id;

function made(step: StepState): string {
  const refs = step.handedOff?.refs ?? [];
  if (refs.length === 0) return `${nameOf(step)} finished`;
  const things = refs.map(
    (ref) => `${ref.entity} ${ref.id}${ref.version !== undefined ? ` (version ${ref.version})` : ''}`,
  );
  return `${nameOf(step)} made ${things.join(', ')}`;
}

/** The note for an unfinished flow run; undefined for one that finished or a run that wasn't a flow. */
export function flowOutcome(state: RunState): string | undefined {
  const verb = VERBS[state.status];
  if (!state.flow || !verb) return undefined;
  const plan = state.plan ?? [];
  const stopped =
    plan.find((step) => step.status === 'failed') ??
    plan.find((step) => step.status !== 'done' && step.status !== 'skipped');
  const done = plan.filter((step) => step.status === 'done');
  const exported = done.some((step) => step.flow?.key === 'export');
  const error = state.error;
  const why = error
    ? ` (${error.code}${error.detail ? `: ${error.detail.slice(0, DETAIL_LIMIT)}` : ''})`
    : '';
  const resumeInput =
    stopped?.skill && stopped.entered?.input !== undefined
      ? JSON.stringify(stopped.entered.input)
      : undefined;
  const lines = [
    `That request ${verb}${stopped ? ` at the step ${nameOf(stopped)}` : ''}${state.status === 'failed' ? why : ''}.`,
    done.length > 0 ? `Before that: ${done.map(made).join('; ')}.` : 'No step had finished.',
    exported
      ? 'A video was exported.'
      : 'Nothing was exported: there is no finished video. Say so if asked, and offer to make it again.',
    ...(resumeInput && done.length > 0
      ? [
          `To retry or continue from where it stopped without redoing finished steps, call updatePlan with skill ${stopped!.skill} and input ${resumeInput.slice(0, DETAIL_LIMIT)}, followed by render.reviewer and a step to export with render.export.`,
        ]
      : []),
  ];
  return lines.join(' ');
}
