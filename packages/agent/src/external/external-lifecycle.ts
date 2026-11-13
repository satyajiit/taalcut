// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How an external run (P3-V4) starts and ends in its log: run.started for a session (autonomy
 * 'before-render', no wall-clock limit, Local only as it is now), and on revoke or expiry its pending
 * approvals denied with their cards expired, its open calls failed and the run cancelled.
 */
import { contentHash } from '@taalcut/tools';
import { closeOpen } from '../agent-answer';
import { DEFAULT_BUDGET, type ExternalRunHost } from '../agent-types';
import type { EventPayloads } from '../events';
import type { EventInput } from '../run-log';
import type { RunState } from '../run-state';
import { pendingApprovals } from '../state';
import type { ExternalRunSession } from './external-types';

export function externalRunStarted(
  host: Pick<ExternalRunHost, 'deps'>,
  session: ExternalRunSession,
  conversationId: string,
  localOnly: (() => boolean) | undefined,
): EventPayloads['run.started'] {
  const { settings, soul, tools } = host.deps;
  const { maxWallClockMs: _endless, ...budget } = settings?.budget ?? DEFAULT_BUDGET;
  return {
    conversationId,
    message: session.name,
    // An external agent's edits stop before render and export, as the chat's default does.
    autonomy: 'before-render',
    budget,
    localOnly: localOnly?.() ?? settings?.localOnly ?? false,
    soulVersion: soul.version,
    catalogueHash: contentHash(tools.catalogue()),
    external: { sessionId: session.sessionId, name: session.name, client: session.client },
  };
}

/** The events that end an open external run: approvals denied (cards expired), open calls failed, cancelled. */
export function closingEvents(state: RunState, reason: 'revoked' | 'expired'): EventInput[] {
  const expired = pendingApprovals(state).flatMap((approval) => {
    const requestId = approval.request.requestId;
    const card = Object.values(state.cards).find((c) => c.type === 'approval' && c.approvalId === requestId);
    return [
      ['approval.denied', { requestId, note: reason }] as EventInput,
      ...(card?.type === 'approval'
        ? [['card.sent', { card: { ...card, status: 'expired' }, approvalId: requestId }] as EventInput]
        : []),
    ];
  });
  return [...expired, ...closeOpen(state), ['run.cancelled', {}]];
}
