// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The export approval is for one timeline revision (SPEC section 13): the
 * exportApproval card names the revision it shows. Once the timeline has
 * moved past it the approval is stale, whether the export is a flow step or
 * the model's own call: it is closed (approval.denied, reason stale) and the
 * card shows "updating", so approving it can't export a timeline nobody saw.
 */
import type { CardOf } from '@taalcut/core';
import type { RefVersions } from './ports';
import type { EventInput } from './run-log';
import type { ApprovalState, RunState } from './run-state';
import { pendingApprovals } from './state';

/** What a model is told when its export's approval went stale. */
export const STALE_EXPORT_REASON =
  'The timeline changed while this export waited for approval, so the approval no longer applies. ' +
  'Check the new revision again, then export it with its timelineRevision.';

export interface PendingExport {
  readonly approval: ApprovalState;
  readonly card: CardOf<'exportApproval'>;
}

/** Tool approvals still waiting whose card is an exportApproval. */
export function pendingExports(state: RunState): PendingExport[] {
  const cards = Object.values(state.cards).filter(
    (card): card is CardOf<'exportApproval'> => card.type === 'exportApproval',
  );
  return pendingApprovals(state).flatMap((approval) => {
    if (approval.request.kind !== 'tool') return [];
    const card = cards.find((c) => c.approvalId === approval.request.requestId);
    return card ? [{ approval, card }] : [];
  });
}

/** The waiting export approvals whose timeline is no longer at the card's revision. */
export async function staleExports(state: RunState, refs: RefVersions): Promise<PendingExport[]> {
  const stale: PendingExport[] = [];
  for (const pending of pendingExports(state)) {
    const current = await refs.version({ entity: 'timeline', id: pending.card.timelineId });
    // A store that can't tell leaves the approval open: the export command still checks the revision.
    if (current.ok && current.value !== undefined && current.value !== pending.card.timelineRevision)
      stale.push(pending);
  }
  return stale;
}

/** Closes a stale export approval: denied as stale, and its card shows "updating". */
export function staleEvents(pending: PendingExport): EventInput[] {
  return [
    ['approval.denied', { requestId: pending.approval.request.requestId, reason: 'stale' }],
    ['card.sent', { card: { ...pending.card, status: 'updating' } }],
  ];
}
