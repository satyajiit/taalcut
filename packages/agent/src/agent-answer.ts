// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What an answer, a resume or a stop writes to the log (SPEC sections 5, 6
 * and 11): the approval, a raised budget, a question's answer, a standing
 * consent, or the stop itself; and the outcome a caller gets back.
 */
import { newId } from '@taalcut/core';
import type { ApprovalAnswer, RunOutcome } from './agent-types';
import { rememberConsent } from './consent';
import { rateLimitAnswerEvents } from './limits/limit-answer';
import type { ConsentStore } from './ports';
import type { EventInput } from './run-log';
import type { ApprovalState, RunState } from './run-state';
import { openToolCalls, pendingApprovals } from './state';

/** The report of a run the user stopped at the project's cap. */
export const STOPPED_AT_BUDGET = 'Stopped at your budget';

export async function answerEvents(
  state: RunState,
  approval: ApprovalState,
  answer: ApprovalAnswer,
  consents: ConsentStore,
  now: number,
): Promise<EventInput[]> {
  const events: EventInput[] = [];
  const note = answer.note ? { note: answer.note } : {};
  const { request } = approval;
  // G8: wait, switch or stop on a rateLimit card.
  if (request.kind === 'rateLimit')
    return rateLimitAnswerEvents(state, approval, answer, now, () => closeOpen(state));
  if (answer.decision === 'approve') {
    // EAR1-R3: a tool that asks every time stores no standing consent, whatever the answer says.
    const consentIds =
      request.kind === 'consent' && answer.remember ? await rememberConsent(consents, request, now) : [];
    events.push([
      'approval.granted',
      {
        requestId: answer.requestId,
        ...note,
        ...(answer.raiseBudgetTo ? { raiseBudgetTo: answer.raiseBudgetTo } : {}),
        ...(consentIds.length > 0 ? { consentIds } : {}),
        ...(answer.answer && request.kind === 'question' ? { answer: answer.answer } : {}),
      },
    ]);
    const raise = answer.raiseBudgetTo ?? autoRaise(state, request);
    if (raise) events.push(['budget.raised', { budget: raise }]);
  } else {
    events.push(['approval.denied', { requestId: answer.requestId, ...note }]);
    // Saying no to a stop before a model call (or to the time budget) is the stop button.
    if (request.kind === 'budget' && request.toolCallIds.length === 0)
      events.push(...closeOpen(state), [
        'run.cancelled',
        request.limit === 'projectCap' ? { reason: 'budget' } : {},
      ]);
  }
  return events;
}

/** "Approve" on the time budget without a new limit gives the run as much time again. */
function autoRaise(state: RunState, request: ApprovalState['request']) {
  if (request.kind !== 'budget' || request.limit !== 'wallClock') return undefined;
  return { maxWallClockMs: state.usage.activeMs + (request.max ?? 0) };
}

/**
 * After a crash, an external call with no outcome may or may not have gone
 * out (an upload, say). It isn't retried blindly: the user is asked again.
 */
export function resumeEvents(state: RunState, after: 'crash' | 'approval'): EventInput[] {
  const events: EventInput[] = [['run.resumed', { after }]];
  if (after !== 'crash') return events;
  const unsure = openToolCalls(state).filter((c) => c.requested.sideEffect === 'external');
  if (unsure.length > 0) {
    events.push([
      'approval.requested',
      {
        requestId: newId<'Approval'>(),
        kind: 'tool',
        toolCallIds: unsure.map((c) => c.requested.toolCallId),
        reason: 'unsure-after-restart',
      },
    ]);
  }
  return events;
}

export function closeOpen(state: RunState): EventInput[] {
  return openToolCalls(state).map((call) => [
    'tool.failed',
    {
      toolCallId: call.requested.toolCallId,
      error: { code: 'core.cancelled', messageKey: 'errors.core.cancelled', retryable: false },
      attempts: 0,
      durationMs: 0,
      usage: { usd: 0, inputTokens: 0, outputTokens: 0 },
    },
  ]);
}

export function isTerminal(state: RunState): boolean {
  return state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled';
}

export function outcome(state: RunState): RunOutcome {
  const report = state.report ?? (state.cancelReason === 'budget' ? STOPPED_AT_BUDGET : undefined);
  return {
    runId: state.runId,
    status: state.status,
    ...(report !== undefined ? { report } : {}),
    ...(state.error ? { error: state.error } : {}),
    pending: pendingApprovals(state).map((a) => ({ requestId: a.request.requestId, kind: a.request.kind })),
  };
}
