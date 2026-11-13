// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1: the Editor's design jobs (SPEC "The Designer's step"). Every new graphic and every change to a graphic's
 * look is a job the Editor records with `graphics.design`; when the Editor's step hands off, the jobs its completed
 * calls recorded become one Designer step (render's `render.designer`) right after it, on the jobs' timeline. A
 * comment handed over that way is the Designer's to answer: the Editor's check leaves it out, the Designer's counts
 * it. Pure functions of the folded state, so a resumed run and a replay decide the same.
 */
import type { PlanStep } from './events';
import { FLOW_SKILLS, nextFlowStepId } from './flows';
import type { EventInput } from './run-log';
import type { RunState, StepState } from './run-state';
import type { SkillRegistry } from './skills';

export const DESIGN_TOOL = 'graphics.design';
export const DESIGNER_SKILL = 'render.designer';

type Facts = Record<string, unknown>;
const record = (value: unknown): Facts =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Facts) : {};

/** One job as the Designer's input takes it: graphics.design's output without its note. */
export interface DesignJobFacts extends Facts {
  readonly jobId: string;
  readonly projectId: string;
  readonly timelineId: string;
}

/** The jobs the completed graphics.design calls of every turn written in `step` recorded, in order. */
export function designJobsIn(state: RunState, step: StepState): DesignJobFacts[] {
  const index = (state.plan ?? []).findIndex((entry) => entry.id === step.id);
  if (index < 0) return [];
  const jobs: DesignJobFacts[] = [];
  for (const item of state.transcript) {
    if (item.kind !== 'assistant' || item.step !== index) continue;
    for (const id of item.toolCallIds) {
      const call = state.toolCalls[id];
      if (call?.requested.tool !== DESIGN_TOOL || call.outcome?.kind !== 'completed') continue;
      const output = call.outcome.payload.output;
      if (output.kind !== 'inline') continue;
      const { note: _note, ...job } = record(output.value);
      if (
        typeof job.jobId === 'string' &&
        typeof job.projectId === 'string' &&
        typeof job.timelineId === 'string'
      )
        jobs.push(job as DesignJobFacts);
    }
  }
  return jobs;
}

/** The most jobs one Designer step takes (render's DESIGNER_JOBS_MAX). */
const JOBS_PER_STEP = 8;

/**
 * After the Editor's handoff: its design jobs as Designer steps right after it (eight jobs a step, on the first
 * job's timeline), when the Designer is registered. Nothing otherwise.
 */
export function afterDesignJobs(
  state: RunState,
  step: StepState,
  skills: Pick<SkillRegistry, 'get'>,
): EventInput[] {
  // AGT2: the Maker records design jobs as the Editor does.
  if (step.skill !== FLOW_SKILLS.editor && step.skill !== FLOW_SKILLS.maker) return [];
  const designer = skills.get(DESIGNER_SKILL);
  if (!designer) return [];
  const all = designJobsIn(state, step);
  const timelineId = all[0]?.timelineId;
  const jobs = all.filter((job) => job.timelineId === timelineId);
  if (jobs.length === 0) return [];
  const entered = record(step.entered?.input);
  const templateId = typeof entered.templateId === 'string' ? { templateId: entered.templateId } : {};
  const taken = new Set<string>();
  const steps: PlanStep[] = [];
  for (let at = 0; at < jobs.length; at += JOBS_PER_STEP) {
    const id = nextFlowStepId(state, taken);
    taken.add(id);
    const batch = jobs.slice(at, at + JOBS_PER_STEP).map(({ projectId: _p, timelineId: _t, ...job }) => job);
    steps.push({
      id,
      text: '',
      labelKey: designer.labelKey,
      skill: designer.id,
      input: { projectId: jobs[0]!.projectId, timelineId, ...templateId, jobs: batch },
    });
  }
  return [['plan.updated', { steps, insertAfter: step.id }]];
}

/** The comments the run's completed graphics.design calls handed to the Designer. */
export function handedOverComments(state: RunState): Set<string> {
  const ids = new Set<string>();
  for (const call of Object.values(state.toolCalls)) {
    if (call.requested.tool !== DESIGN_TOOL || call.outcome?.kind !== 'completed') continue;
    const output = call.outcome.payload.output;
    const commentId = output.kind === 'inline' ? record(output.value).commentId : undefined;
    if (typeof commentId === 'string') ids.add(commentId);
  }
  return ids;
}
