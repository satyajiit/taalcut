// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Card } from '@taalcut/core';

/**
 * The approval a card is waiting on, if it is: approval, consent, cost (v1, or v2 when it asks), the budget cap,
 * the export approval and a memory proposal (LRN1-MEM) while pending.
 */
export function openApproval(card: Card): string | undefined {
  switch (card.type) {
    case 'approval':
    case 'consent':
    case 'budgetCap':
    case 'exportApproval':
    case 'memoryProposal':
      return card.status === 'pending' ? card.approvalId : undefined;
    case 'costEstimate':
      if (card.version === 1) return card.requiresApproval ? card.approvalId : undefined;
      return card.status === 'asking' ? card.approvalId : undefined;
    default:
      return undefined;
  }
}

/** The approval ids a card answers, open or not (to find its run when it is answered). */
export function approvalIdsOf(card: Card): string[] {
  switch (card.type) {
    case 'approval':
    case 'consent':
    case 'budgetCap':
    case 'exportApproval':
    case 'memoryProposal':
      return [card.approvalId];
    case 'costEstimate':
      return card.approvalId ? [card.approvalId] : [];
    case 'castBoard':
    case 'gapFix':
      return card.asking ? [card.asking.approvalId] : [];
    default:
      return [];
  }
}

/**
 * Whether a card asks for an answer now (UX round 1): an open approval, a question a step asks (how many videos,
 * which fixes for the gaps), or a model limit the run waits on. The newest of these holds the transcript's one
 * marigold primary, and the agent's words that explain it go above it.
 */
export function asksNow(card: Card): boolean {
  if (openApproval(card) !== undefined) return true;
  switch (card.type) {
    case 'exportApproval':
      return card.status === 'updating';
    case 'castBoard':
    case 'gapFix':
      return card.asking !== undefined;
    case 'rateLimit':
      return card.status === 'waiting' && card.approvalId !== undefined;
    default:
      return false;
  }
}
