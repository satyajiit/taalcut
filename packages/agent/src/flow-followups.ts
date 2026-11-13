// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a flow does after a step (SPEC sections 12 and 13), as plan events:
 * more variants after casting, the QA fix loop, asking again after a stale
 * export approval, and running later steps again once when the user changed
 * what an earlier one made, and (HFW1) the Designer's step after the Editor's
 * when it recorded design jobs. Pure functions of the folded state, so a
 * resumed run decides the same way.
 */
import { afterDesignJobs } from './design-jobs';
import { ExportKeptChanging } from './errors';
import { exportConflicts, MAX_EXPORT_RETRIES } from './export-conflicts';
import type { PlanStep } from './events';
import { flowDef, flowStep, MAKE_KEYS, nextFlowStepId, type FlowStepDef } from './flows';
import { iterationBudget } from './iteration-budget';
import type { RunState, StepState } from './run-state';
import type { SkillRegistry } from './skills';
import type { EventInput } from './run-log';

/**
 * At most this many Editor → Reviewer rounds per variant after the first review, on the smallest window. AGT2: a
 * composition that sets none gets the review's own window's (iteration-budget.ts `fixRounds`).
 */
export const MAX_FIX_LOOPS = 2;

type Facts = Record<string, unknown>;
const record = (value: unknown): Facts =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Facts) : {};

/** passed, fix (more Editor work), or user (only the user can decide). Reads either Reviewer handoff shape. */
export function reviewOutcome(output: unknown): 'passed' | 'fix' | 'user' {
  const o = record(output);
  if (o.passed === true) return 'passed';
  if (o.passed === false) return 'fix';
  if (o.next === 'user') return 'user';
  if (o.next === 'editor' || o.next === 'reexport') return 'fix';
  return 'passed';
}

function fixesOf(output: unknown): unknown[] {
  const o = record(output);
  const fixes = Array.isArray(o.fixes) ? o.fixes : Array.isArray(o.editorSteps) ? o.editorSteps : [];
  return fixes;
}

class PlanBuilder {
  readonly steps: PlanStep[] = [];
  private readonly taken = new Set<string>();
  constructor(
    private readonly state: RunState,
    private readonly skills: Pick<SkillRegistry, 'get'>,
  ) {}
  add(def: FlowStepDef | undefined, flow: PlanStep['flow']): void {
    if (!def || !flow) return;
    const id = nextFlowStepId(this.state, this.taken);
    this.taken.add(id);
    this.steps.push(flowStep(def, id, flow, this.skills));
  }
}

/** After a skill hands off: more variants (Librarian) or the fix loop (Reviewer). */
export function afterHandoff(
  state: RunState,
  step: StepState,
  output: unknown,
  skills: Pick<SkillRegistry, 'get'>,
  maxFixLoops?: number,
): EventInput[] {
  const key = step.flow?.key;
  const variant = step.flow?.variant ?? 1;
  // HFW1: the Editor's design jobs are the Designer's step, next (design-jobs.ts).
  const designs = afterDesignJobs(state, step, skills);
  if (designs.length > 0) return designs;
  if (!state.flow || !key) return [];
  if (key === 'librarian') {
    const count = Array.isArray(record(output).timelineIds)
      ? (record(output).timelineIds as unknown[]).length
      : 1;
    if (count <= 1) return [];
    const perVariant = (state.plan ?? []).filter(
      (s) => s.flow?.variant === 1 && flowDef(s.flow.key)?.perVariant,
    );
    const last = perVariant.at(-1);
    if (!last) return [];
    const plan = new PlanBuilder(state, skills);
    for (let v = 2; v <= count; v++)
      for (const s of perVariant) plan.add(flowDef(s.flow!.key), { key: s.flow!.key, variant: v });
    return [['plan.updated', { steps: plan.steps, insertAfter: last.id }]];
  }
  if (key !== 'reviewer') return [];
  const outcome = reviewOutcome(output);
  if (outcome === 'passed') return [];
  const loops = (state.plan ?? []).filter(
    (s) => MAKE_KEYS.has(s.flow?.key ?? '') && s.flow?.variant === variant && s.flow.fixes,
  ).length;
  if (outcome === 'fix' && loops < (maxFixLoops ?? iterationBudget(step.window).fixRounds)) {
    // AGT2: the fixes go back to the step that made this variant: the Maker where it ran, else the Editor.
    const key = makeKey(state, variant);
    const plan = new PlanBuilder(state, skills);
    plan.add(flowDef(key), { key, variant, fixes: fixesOf(output) });
    plan.add(flowDef('reviewer'), { key: 'reviewer', variant });
    return [['plan.updated', { steps: plan.steps, insertAfter: step.id }]];
  }
  // Out of rounds, or a decision only the user can make: nothing failing is ever offered for export.
  return exportsOf(state, variant).map(
    (s) => ['step.skipped', { stepId: s.id, reason: 'qa-failed' }] as EventInput,
  );
}

/** The key of the step that made this variant: 'maker' where the Maker ran, else 'editor'. */
function makeKey(state: RunState, variant: number): string {
  const made = (state.plan ?? []).find(
    (s) => MAKE_KEYS.has(s.flow?.key ?? '') && s.flow?.variant === variant,
  );
  return made?.flow?.key ?? 'editor';
}

function exportsOf(state: RunState, variant: number): StepState[] {
  return (state.plan ?? []).filter(
    (s) => s.flow?.key === 'export' && s.flow.variant === variant && s.status === 'todo',
  );
}

/**
 * After the agent's own tool step (the export): a stale approval, or an
 * export the command refused because the timeline moved, goes back through
 * the Reviewer and asks again; a declined export is skipped. AGT2: a refused
 * one is reviewed again at `head` (export-conflicts.ts), at most
 * MAX_EXPORT_RETRIES times; the next refusal ends the run with
 * agent.export_kept_changing.
 * Undefined: the step failed for another reason (the run fails with its error).
 */
export function afterToolStep(
  state: RunState,
  step: StepState,
  skills: Pick<SkillRegistry, 'get'>,
  head?: number,
): EventInput[] | undefined {
  if (step.toolOutcome !== 'failed') return [];
  const call = step.toolCallId ? state.toolCalls[step.toolCallId] : undefined;
  const failure = call?.outcome?.kind === 'failed' ? call.outcome.payload.error : undefined;
  // core.conflict: the timeline moved past the approved revision after the grant; the command refused it.
  if (failure?.code !== 'tools.denied' && failure?.code !== 'core.conflict') return undefined;
  const approval = Object.values(state.approvals)
    .filter((a) => a.request.toolCallIds.includes(step.toolCallId ?? ''))
    .at(-1);
  if (failure.code === 'tools.denied' && approval?.deniedReason !== 'stale')
    return [['step.skipped', { stepId: step.id, reason: 'declined' }]];
  const variant = step.flow?.variant ?? 1;
  const refused = failure.code === 'core.conflict';
  if (refused && exportConflicts(state, variant) > MAX_EXPORT_RETRIES) {
    const detail = `The timeline moved past the reviewed revision before each of ${MAX_EXPORT_RETRIES + 1} exports.`;
    return [['run.failed', { error: ExportKeptChanging({ tries: MAX_EXPORT_RETRIES + 1 }, { detail }) }]];
  }
  const at = refused && head !== undefined ? { revision: head } : {};
  const plan = new PlanBuilder(state, skills);
  plan.add(flowDef('reviewer'), { key: 'reviewer', variant, ...at });
  plan.add(flowDef('export'), { key: 'export', variant, ...at });
  return [
    ['step.skipped', { stepId: step.id, reason: 'superseded' }],
    ['plan.updated', { steps: plan.steps, insertAfter: step.id }],
  ];
}

/**
 * The user changed what a finished step made (flow.inputChanged): every
 * finished skill step after the earliest changed one runs again, once, as new
 * steps right after the current one. Steps not run yet will read the new
 * state anyway; an export already done is not repeated.
 */
export function afterInputChanges(
  state: RunState,
  current: StepState,
  skills: Pick<SkillRegistry, 'get'>,
): EventInput[] {
  const pending = state.inputChanges.filter((c) => !c.applied);
  if (pending.length === 0) return [];
  const plan = state.plan ?? [];
  const indices = pending
    .flatMap((c) => c.stepIds.map((id) => plan.findIndex((s) => s.id === id)))
    .filter((i) => i >= 0);
  const currentIndex = plan.findIndex((s) => s.id === current.id);
  const from = indices.length > 0 ? Math.min(...indices) : currentIndex;
  // A step already waiting later in the plan (say a review queued after a stale export) runs once, not twice.
  const queued = new Set(
    plan
      .slice(currentIndex + 1)
      .filter((s) => s.flow && s.status === 'todo')
      .map((s) => `${s.flow!.key}:${s.flow!.variant}`),
  );
  const builder = new PlanBuilder(state, skills);
  for (const s of plan.slice(from + 1, currentIndex + 1))
    if (s.flow && s.skill && s.status === 'done' && !queued.has(`${s.flow.key}:${s.flow.variant}`)) {
      // A rerun reads the handoffs as they are then, not the head a refused export once queued it at.
      const { revision: _queuedAt, ...flow } = s.flow;
      builder.add(flowDef(flow.key), { ...flow, rerun: true });
    }
  return [
    ['plan.updated', { steps: builder.steps, insertAfter: current.id, applies: pending.map((c) => c.seq) }],
  ];
}
