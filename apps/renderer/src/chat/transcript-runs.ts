// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Card, CardOf, RunId, TaalcutError } from '@taalcut/core';
import {
  endReasoning,
  upsert,
  type Notice,
  type RunStatus,
  type Transcript,
  type TranscriptItem,
} from './transcript-items';

/** How runs end in the transcript: stopped, failed, paused, or refused because they had already ended. */

/** A question the run asked that can no longer be answered: its card shows no buttons. */
function closeAsk(card: Card, runId: RunId): Card {
  if (!('runId' in card) || card.runId !== runId) return card;
  if ((card.type === 'approval' || card.type === 'consent') && card.status === 'pending')
    return { ...card, status: 'expired' };
  if (card.type === 'costEstimate' && card.version === 1 && card.requiresApproval)
    return { ...card, requiresApproval: false };
  if (
    card.type === 'exportApproval' &&
    (card.status === 'pending' || card.status === 'updating' || card.status === 'exporting')
  )
    return { ...card, status: 'expired' };
  return card;
}

/** The line a run's status puts under it, if any. */
const STATUS_NOTICE: Partial<Record<RunStatus, Notice>> = { cancelled: 'cancelled', paused: 'paused' };

/**
 * The run stopped: settle everything still moving. A cancelled or failed run
 * leaves no spinner behind: running tools read "Stopped", unfinished plan
 * steps "Skipped". A paused run can still end (stopped by id, say); once it
 * has, its questions expire, their buttons go, and its "waiting" line becomes
 * the new status line (`notice` overrides which one).
 */
export function finishRun(
  state: Transcript,
  runId: RunId,
  status: Exclude<RunStatus, 'running'>,
  at: number,
  error?: TaalcutError,
  notice: Notice | null | undefined = STATUS_NOTICE[status],
): Transcript {
  const before = state.runs[runId];
  if (before !== undefined && before !== 'running' && (before !== 'paused' || status === 'paused'))
    return state;
  const halted = status === 'cancelled' || status === 'failed';
  const ended = status !== 'paused';
  const line: TranscriptItem[] = notice ? [{ kind: 'notice', key: `${notice}:${runId}`, runId, notice }] : [];
  let items = endReasoning(state.items, runId, at).flatMap((item): TranscriptItem[] => {
    if (item.kind === 'agent' && item.runId === runId) return [{ ...item, streaming: false }];
    // No longer waiting for an answer: the status line takes the waiting line's place.
    if (ended && item.kind === 'notice' && item.runId === runId && item.notice === 'paused') return line;
    if (item.kind !== 'card') return [item];
    const card = ended ? closeAsk(item.card, runId) : item.card;
    if (halted && card.type === 'toolRun' && card.runId === runId && card.status === 'running') {
      return [{ ...item, card: { ...card, status: 'cancelled', finishedAt: at } }];
    }
    if (
      halted &&
      card.type === 'step' &&
      card.runId === runId &&
      (card.step.status === 'running' || card.step.status === 'updating')
    ) {
      return [{ ...item, card: { ...card, step: { ...card.step, status: 'failed' }, progress: null } }];
    }
    if (halted && card.type === 'plan' && card.runId === runId) {
      const steps = card.steps.map((step) =>
        step.status === 'running' || step.status === 'pending'
          ? { ...step, status: 'skipped' as const }
          : step,
      );
      return [{ ...item, card: { ...card, steps } }];
    }
    return [card === item.card ? item : { ...item, card }];
  });
  if (status === 'failed' && error) {
    const card: CardOf<'error'> = { type: 'error', id: `run-error:${runId}`, version: 1, error };
    items = upsert(items, { kind: 'card', key: card.id, card });
  }
  if (notice) items = upsert(items, { kind: 'notice', key: `${notice}:${runId}`, runId, notice });
  return {
    ...state,
    items,
    runs: { ...state.runs, [runId]: status },
    activeRunId: state.activeRunId === runId ? null : state.activeRunId,
  };
}

/** The agent's error for an answer to a run that has ended: shown as a calm notice, not an error. */
export const RUN_FINISHED = 'agent.run_finished';

/**
 * The agent refused an answer because the run had already ended: record how
 * it ended (`status`, when stop could tell) and say so calmly under it, in
 * place of an error.
 */
export function runEnded(
  state: Transcript,
  runId: RunId,
  status: Exclude<RunStatus, 'running' | 'paused'> | null,
  at: number,
): Transcript {
  const current = state.runs[runId];
  if (status && (current === undefined || current === 'running' || current === 'paused'))
    return finishRun(state, runId, status, at, undefined, 'ended');
  // Already settled here, or how it ended is unknown: close its questions and say why.
  const notice: TranscriptItem = { kind: 'notice', key: `ended:${runId}`, runId, notice: 'ended' };
  let placed = false;
  const items = state.items.map((item): TranscriptItem => {
    if (item.kind === 'card') {
      const card = closeAsk(item.card, runId);
      return card === item.card ? item : { ...item, card };
    }
    if (item.kind === 'notice' && item.runId === runId && item.notice === 'paused') {
      placed = true;
      return notice;
    }
    return item;
  });
  return { ...state, items: placed ? items : upsert(items, notice) };
}
