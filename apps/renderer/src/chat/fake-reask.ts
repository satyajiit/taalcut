// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, type ChatHistoryEvent, type ConversationId, type RunId } from '@taalcut/core';
import { event, type Beat } from './fake-script';

/**
 * The flow watcher for a seeded export approval (fake-seed.ts's review demo), as the agent does it for every export
 * waiting on a timeline that changed (agent flow-watcher.ts): the approval closes, the card says "updating" while
 * the video is checked again, and the run asks again under the same card id with a new approval id. A flow's own
 * approvals are the flow engine's (fake-flow.ts `edited`); `isFlows` says which those are.
 */
export function reaskSeeded(
  conversationId: ConversationId,
  history: readonly ChatHistoryEvent[],
  isFlows: (approvalId: string) => boolean,
): { runId: RunId; beats: Beat[] } | undefined {
  const asked = history.findLast(
    (entry) => entry.type === 'agent.card' && entry.payload.card.type === 'exportApproval',
  );
  if (asked?.type !== 'agent.card' || asked.payload.card.type !== 'exportApproval') return undefined;
  const card = asked.payload.card;
  if (card.status !== 'pending' || isFlows(card.approvalId)) return undefined;
  const runId = asked.payload.runId;
  const finished = history.findLast(
    (entry) => entry.type === 'agent.runFinished' && entry.payload.runId === runId,
  );
  if (finished?.type !== 'agent.runFinished' || finished.payload.status !== 'paused') return undefined;
  const again = {
    ...card,
    approvalId: `ap-${newId<'Approval'>()}`,
    timelineRevision: card.timelineRevision + 1,
    status: 'pending' as const,
  };
  return {
    runId,
    beats: [
      { wait: 0, event: event('agent.runStarted', { runId, conversationId }) },
      { wait: 0, event: event('agent.card', { runId, card: { ...card, status: 'updating' } }) },
      { wait: 1_500, event: event('agent.card', { runId, card: again }) },
      { wait: 60, event: event('agent.runFinished', { runId, status: 'paused' }) },
    ],
  };
}
