// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core cards the chat builds from the log (the agent's own cards are logged
 * whole as card.sent): consent, the run budget's costEstimate (version 1),
 * a step's estimate (costEstimate version 2) and the project cap
 * (budgetCap). Money goes out in micro-USD.
 */
import type { Card, CardOf, CardRequester, RunId } from '@taalcut/core';
import type { EventPayloads } from './events';

type Asked = EventPayloads['approval.requested'];

export const usd = (amount: number) => ({ currency: 'USD', micros: Math.round(amount * 1_000_000) });

/** A consent card's answers: no Always allow for a tool that asks every time (EAR1-R3). */
export function consentOptions(p: Pick<Asked, 'alwaysAsk'>): ('allow-once' | 'always-allow' | 'deny')[] {
  return p.alwaysAsk ? ['allow-once', 'deny'] : ['allow-once', 'always-allow', 'deny'];
}

/**
 * Core's consent card: the files, the cloud modules and providers, the cost, and the answers (`consentOptions`); for
 * an external agent's run, which agent asked.
 */
export function consentCard(
  runId: RunId,
  p: Asked,
  tool: string,
  status: 'pending' | 'approved' | 'denied',
  requester?: CardRequester,
) {
  const upload = p.upload ?? { modules: [], providers: [], files: [] };
  return {
    type: 'consent' as const,
    id: p.requestId,
    version: 1 as const,
    runId,
    approvalId: p.requestId,
    tool,
    upload: {
      modules: [...upload.modules],
      providers: [...upload.providers],
      files: [...upload.files],
      ...(upload.sources ? { sources: [...upload.sources] } : {}),
    },
    ...(p.estimate
      ? { estimate: { money: usd(p.estimate.usd), tokens: Math.round(p.estimate.tokens) } }
      : {}),
    options: consentOptions(p),
    status,
    ...(requester ? { requester } : {}),
  };
}

/** The run budget's stop-and-ask card (version 1). */
export function runBudgetCard(runId: RunId, requestId: string, p: Asked, requiresApproval: boolean) {
  const estimate = p.estimate ?? { usd: 0, tokens: 0 };
  return {
    type: 'costEstimate' as const,
    id: requestId,
    version: 1 as const,
    runId,
    estimate: { money: usd(estimate.usd), tokens: Math.round(estimate.tokens) },
    requiresApproval,
    approvalId: requestId,
  };
}

/** Spent plus the estimate, rounded up to the next US$0.50. */
export function suggestedCap(spentUsd: number, estimateUsd: number): number {
  return Math.ceil((spentUsd + estimateUsd) * 2 - 1e-9) / 2 || 0.5;
}

/** The project cap stop: raise it, use a cheaper model, or stop; for an external agent's run, which agent asked. */
export function budgetCapCard(
  runId: RunId,
  p: Asked,
  status: CardOf<'budgetCap'>['status'],
  requester?: CardRequester,
): CardOf<'budgetCap'> {
  const spent = p.used ?? 0;
  const estimate = p.estimate?.usd ?? 0;
  return {
    type: 'budgetCap',
    id: `cap:${p.requestId}`,
    version: 1,
    runId,
    projectId: (p.projectId ?? '') as CardOf<'budgetCap'>['projectId'],
    approvalId: p.requestId,
    cap: usd(p.max ?? 0),
    spent: usd(spent),
    next: { labelKey: p.labelKey ?? 'flows.step.model', estimate: usd(estimate) },
    suggestedCap: usd(suggestedCap(spent, estimate)),
    cheaper: (p.cheaper ?? []).map((c) => ({
      module: c.module,
      provider: c.provider,
      model: c.model,
      local: c.local,
      estimate: usd(c.usd),
    })),
    status,
    ...(requester ? { requester } : {}),
  };
}

/** A step's or a paid call's estimate (version 2): going ahead, then settled with what it cost. */
export function stepCostCard(
  runId: RunId,
  projectId: string | null,
  p: EventPayloads['estimate.recorded'],
  actual?: EventPayloads['estimate.settled']['actual'],
): Card {
  return {
    type: 'costEstimate',
    id: `cost:${p.estimateId}`,
    version: 2,
    runId,
    projectId: projectId as CardOf<'budgetCap'>['projectId'] | null,
    phase: {
      labelKey: p.labelKey,
      ...(p.skill ? { skill: p.skill } : {}),
      ...(p.tool ? { tool: p.tool } : {}),
    },
    estimate: { money: usd(p.estimate.usd), tokens: Math.round(p.estimate.tokens) },
    lines: p.lines.map((l) => ({
      module: l.module,
      provider: l.provider,
      model: l.model,
      local: l.local,
      money: usd(l.usd),
      tokens: Math.round(l.tokens),
      ...(l.billed ? { billed: l.billed } : {}),
    })),
    cap: p.cap ? { cap: usd(p.cap.usd), spent: usd(p.cap.spentUsd) } : null,
    cheaper: [],
    status: actual ? 'settled' : 'going-ahead',
    ...(actual ? { actual: { money: usd(actual.usd), tokens: Math.round(actual.tokens) } } : {}),
  } as Card;
}

/**
 * A tool's own approval card after the answer (exportApproval: exporting or declined; memoryProposal: approved or
 * declined; others approved or denied).
 */
export function answeredCard(card: Card, granted: boolean, stale: boolean): Card | undefined {
  if (!('status' in card)) return undefined;
  if (card.type === 'exportApproval') {
    if (stale) return undefined; // The watcher already sent it as "updating".
    return { ...card, status: granted ? 'exporting' : 'declined' };
  }
  if (card.type === 'memoryProposal') return { ...card, status: granted ? 'approved' : 'declined' };
  if (card.type === 'approval' || card.type === 'consent')
    return { ...card, status: granted ? 'approved' : 'denied' };
  return undefined;
}

/**
 * An approved card once its call finished: the export card once its render is under way (the render id from
 * render.export's output), the memory card once its item is stored (the id from memory.remember's).
 */
export function exportedCard(card: Card, output: unknown): Card | undefined {
  if (card.type === 'memoryProposal') {
    const value = (output ?? {}) as { memoryId?: unknown };
    return {
      ...card,
      status: 'remembered',
      ...(typeof value.memoryId === 'string'
        ? { memoryId: value.memoryId as CardOf<'memoryProposal'>['memoryId'] }
        : {}),
    };
  }
  if (card.type !== 'exportApproval') return undefined;
  const value = (output ?? {}) as { renderId?: unknown; render?: { id?: unknown } };
  const renderId = typeof value.renderId === 'string' ? value.renderId : value.render?.id;
  return {
    ...card,
    status: 'exported',
    ...(typeof renderId === 'string' ? { renderId: renderId as CardOf<'exportApproval'>['renderId'] } : {}),
  } as Card;
}
