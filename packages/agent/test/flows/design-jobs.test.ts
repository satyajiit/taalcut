// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 "The Designer's step": the jobs the Editor's completed graphics.design calls recorded become Designer steps
 * right after the Editor's (eight jobs a step, on the first job's timeline), only when the Designer is registered;
 * a comment handed over that way is the Designer's to answer, so the Editor's check leaves it out.
 */
import { describe, expect, it } from 'vitest';
import { newId } from '@taalcut/core';
import { withCommentsAnswered } from '../../src/comments/comment-run';
import { afterDesignJobs, designJobsIn, handedOverComments, DESIGN_TOOL, DESIGNER_SKILL } from '../../src/design-jobs';
import { FLOW_SKILLS } from '../../src/flows';
import { initialState, type RunState, type StepState } from '../../src/run-state';

const projectId = newId<'Project'>();
const timelineId = newId<'Timeline'>();
const otherTimeline = newId<'Timeline'>();

function editorRun(jobs: readonly Record<string, unknown>[], failed = 0): { state: RunState; step: StepState } {
  const state = initialState(newId<'AgentRun'>());
  const step = {
    id: 'f1',
    text: '',
    status: 'running',
    turns: 1,
    verifyRetries: 0,
    ended: true,
    summary: '',
    skill: FLOW_SKILLS.editor,
    entered: { input: { templateId: newId<'Template'>() } },
  } as unknown as StepState;
  state.plan = [step];
  state.stepIndex = 0;
  const ids: string[] = [];
  jobs.forEach((job, index) => {
    const id = `call-${index}`;
    ids.push(id);
    state.toolCalls[id] = {
      requested: { tool: DESIGN_TOOL, version: '1.0.0', input: {}, modelToolCallId: `m-${index}` },
      requestedAt: index,
      outcome:
        index < failed
          ? { kind: 'failed', at: index, payload: {} }
          : {
              kind: 'completed',
              at: index,
              payload: { version: '1.0.0', output: { kind: 'inline', value: { ...job, note: 'Recorded.' } } },
            },
    } as never;
  });
  state.transcript.push({ kind: 'assistant', text: '', toolCallIds: ids, step: 0 } as never);
  return { state, step };
}

const job = (index: number, extra: Record<string, unknown> = {}) => ({
  jobId: `j${index}`,
  projectId,
  timelineId,
  request: `graphic ${index}`,
  ...extra,
});

const designer = { get: (id: string) => (id === DESIGNER_SKILL ? { id, labelKey: 'skills.render.designer' } : undefined) };

describe('the Designer’s step', () => {
  it('follows the Editor’s step with its completed jobs, eight a step, on the first job’s timeline', () => {
    const jobs = [...Array.from({ length: 10 }, (_, index) => job(index)), job(10, { timelineId: otherTimeline })];
    const { state, step } = editorRun(jobs, 1);
    expect(designJobsIn(state, step).map((entry) => entry.jobId)).toEqual(jobs.slice(1).map((entry) => entry.jobId));
    const events = afterDesignJobs(state, step, designer as never);
    expect(events).toHaveLength(1);
    type Steps = { steps: { skill: string; input: { jobs: unknown[]; timelineId: string; templateId?: string } }[] };
    const [name, payload] = events[0] as [string, Steps & { insertAfter: string }];
    expect(name).toBe('plan.updated');
    expect(payload.insertAfter).toBe('f1');
    expect(payload.steps.map((entry) => entry.skill)).toEqual([DESIGNER_SKILL, DESIGNER_SKILL]);
    // The first call failed and the last is on another timeline: nine jobs, as eight and one.
    expect(payload.steps.map((entry) => entry.input.jobs.length)).toEqual([8, 1]);
    expect(payload.steps[0]?.input.timelineId).toBe(timelineId);
    expect(payload.steps[0]?.input.templateId).toBeTypeOf('string');
    // A job carries no project or timeline of its own: the step's input does.
    expect(payload.steps[0]?.input.jobs[0]).toEqual({ jobId: 'j1', request: 'graphic 1' });
  });

  it('adds nothing without the Designer, or after another skill’s step', () => {
    const { state, step } = editorRun([job(0)]);
    expect(afterDesignJobs(state, step, { get: () => undefined } as never)).toEqual([]);
    expect(afterDesignJobs(state, { ...step, skill: 'render.reviewer' } as StepState, designer as never)).toEqual([]);
  });

  it('leaves a handed-over comment to the Designer’s check', () => {
    const commentId = newId<'TimelineComment'>();
    const { state, step } = editorRun([job(0, { commentId })]);
    state.started = { comments: { comments: [{ commentId }] } } as never;
    expect([...handedOverComments(state)]).toEqual([commentId]);
    const pass = { verdict: 'pass' as const };
    expect(withCommentsAnswered(state, pass, true, step, true)).toEqual(pass);
    expect(withCommentsAnswered(state, pass, true, step, false).verdict).toBe('retry');
    expect(withCommentsAnswered(state, pass, true, { skill: DESIGNER_SKILL }, true).verdict).toBe('retry');
  });
});
