// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CMT: a run that answers a batch of comments ("Send N comments to Taalcut"). run.started logs the batch
 * (core's CommentBatch, read once by the chat service) and the first prompt gets it as a note (comment-note.ts); the
 * run goes straight to the Editor (no planning turn), and the Editor's handoff is checked for a comments.reply to
 * every comment. Pure: everything here reads the run's state, so a resume or a replay is the same.
 */
import { COMMENT_TOOLS, type SkillVerdict } from '@taalcut/core';
import type { PlanStep } from '../events';
import { FLOW_SKILLS } from '../flows';
import type { EventInput } from '../run-log';
import { DESIGNER_SKILL, handedOverComments } from '../design-jobs';
import type { StepState } from '../run-state';
import type { RunState } from '../state';
import type { SkillRegistry } from '../skills';
import { COMMENT_STEP_ID, commentBatchEditor, commentBatchRequest } from './comment-request';

export { COMMENT_STEP_ID } from './comment-request';

/** The step's words in the window (ui flow-labels.ts): the Editor working through the comments, not cutting to the beat. */
export const COMMENTS_LABEL = 'flows.step.comments';

/**
 * A batch run's plan: one Editor step on the batch's timeline, when the Editor is registered. FIX-CMT: it asks, in
 * words built from the comments (comment-request.ts), pointing at what they are on, so the Editor has a request's
 * tools; an Editor that can't take that input gets the timeline alone. A replay gives the plan as the run logged
 * it: an older batch's, with no request, replays as it ran.
 */
export function commentBatchPlan(
  state: RunState,
  skills: Pick<SkillRegistry, 'get'>,
  logged?: readonly PlanStep[],
): EventInput | undefined {
  const batch = state.started?.comments;
  const editor = skills.get(FLOW_SKILLS.editor);
  if (!batch || !editor) return undefined;
  if (logged?.[0]?.id === COMMENT_STEP_ID) return ['plan.created', { steps: [...logged] }];
  const timeline = {
    projectId: batch.projectId,
    timelineId: batch.timelineId,
    ...(batch.templateId ? { templateId: batch.templateId } : {}),
  };
  const pointing = commentBatchEditor(batch);
  const asked = editor.input.safeParse({
    ...timeline,
    request: commentBatchRequest(batch),
    ...(pointing ? { context: pointing.context, targets: pointing.targets } : {}),
  });
  const input = asked.success ? asked.data : timeline;
  return [
    'plan.created',
    { steps: [{ id: COMMENT_STEP_ID, text: '', labelKey: COMMENTS_LABEL, skill: editor.id, input }] },
  ];
}

/**
 * The batch's comments the run hasn't answered yet: no completed comments.reply names them. HFW1: with `handedOver`,
 * a comment the Editor handed to the Designer (graphics.design's commentId) isn't the Editor's to answer: its own
 * check leaves those out, and the Designer's step counts them.
 */
export function unansweredComments(state: RunState, handedOver: ReadonlySet<string> = new Set()): string[] {
  const batch = state.started?.comments;
  if (!batch) return [];
  const answered = new Set<string>(handedOver);
  for (const call of Object.values(state.toolCalls)) {
    if (call.requested.tool !== COMMENT_TOOLS.reply || call.outcome?.kind !== 'completed') continue;
    const id = (call.requested.input as { commentId?: unknown } | null)?.commentId;
    if (typeof id === 'string') answered.add(id);
  }
  return batch.comments.map((item) => item.commentId).filter((id) => !answered.has(id));
}

/**
 * The Editor's check, with the batch's on top: a handoff that leaves a comment unanswered goes back, naming the ones
 * left, while the step has tries left. Then it passes: the run's end gives those comments back, open. A verdict that
 * isn't a pass stands as it is.
 */
export function withCommentsAnswered(
  state: RunState,
  verdict: SkillVerdict,
  canRetry: boolean,
  step?: Pick<StepState, 'skill'>,
  designer = false,
): SkillVerdict {
  if (verdict.verdict !== 'pass' || !canRetry) return verdict;
  // HFW1: the Editor hands the comments on graphics' looks to the Designer, which answers them in its own step.
  const handedOver = designer && step?.skill !== DESIGNER_SKILL ? handedOverComments(state) : new Set<string>();
  const left = unansweredComments(state, handedOver);
  if (left.length === 0) return verdict;
  return {
    verdict: 'retry',
    reason: `Answer ${left.length === 1 ? 'comment' : 'comments'} ${left.join(', ')} with ${COMMENT_TOOLS.reply} (resolved, or open with the reason), then hand off again.`,
  };
}
