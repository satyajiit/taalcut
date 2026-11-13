// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ApprovalDecision, ChatHistoryEvent, RunId, RunStopped, TaalcutError } from '@taalcut/core';
import { openApproval } from './approvals';
import { applyEvent, finishRun, runEnded, type Transcript } from './transcript';
import { mergeSavedCovers } from './saved-cover-history';

/** How a conversation's transcript moves (useConversation's reducer), and what it asks of its runs. */

export type FinalStatus = Exclude<RunStopped['status'], 'running' | 'paused'>;
export const isFinal = (status: RunStopped['status']): status is FinalStatus =>
  status !== 'running' && status !== 'paused';

export type Action =
  | { type: 'reset'; transcript: Transcript }
  | { type: 'event'; event: ChatHistoryEvent }
  | { type: 'saved-covers'; history: readonly ChatHistoryEvent[] }
  | { type: 'stopped'; at: number }
  | { type: 'failed'; error: TaalcutError; at: number }
  | { type: 'finished'; runId: RunId; status: FinalStatus; at: number }
  | { type: 'ended'; runId: RunId; status: FinalStatus | null; at: number };

export function reducer(state: Transcript, action: Action): Transcript {
  switch (action.type) {
    case 'reset':
      return action.transcript;
    case 'event':
      return applyEvent(state, action.event);
    case 'saved-covers':
      return mergeSavedCovers(state, action.history);
    case 'stopped':
      // The stream ended without saying how: record the cancel ourselves.
      return state.activeRunId ? finishRun(state, state.activeRunId, 'cancelled', action.at) : state;
    case 'failed':
      return state.activeRunId
        ? finishRun(state, state.activeRunId, 'failed', action.at, action.error)
        : state;
    case 'finished':
      return finishRun(state, action.runId, action.status, action.at);
    case 'ended':
      return runEnded(state, action.runId, action.status, action.at);
  }
}

/** Runs Stop applies to: the one in progress, and any waiting for an answer. */
export function stoppableRuns(transcript: Transcript): RunId[] {
  const paused = Object.entries(transcript.runs)
    .filter(([, status]) => status === 'paused')
    .map(([runId]) => runId as RunId);
  return transcript.activeRunId ? [transcript.activeRunId, ...paused] : paused;
}

/**
 * The questions runs are waiting on: approval, consent and cost cards still
 * open on a paused run. A new message answers each of them "Not now"
 * (DESIGN.md v0.2: a paused run doesn't lock the composer).
 */
export function pendingAsks(transcript: Transcript): ApprovalDecision[] {
  const asks: ApprovalDecision[] = [];
  for (const item of transcript.items) {
    if (item.kind !== 'card') continue;
    const { card } = item;
    if (!('runId' in card) || card.runId === undefined || transcript.runs[card.runId] !== 'paused') continue;
    const approvalId = openApproval(card);
    if (approvalId) asks.push({ runId: card.runId as RunId, approvalId, decision: 'deny' });
  }
  return asks;
}
