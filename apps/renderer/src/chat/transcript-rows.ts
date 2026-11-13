// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Card, CardOf, CostEstimateCardV2, RunId } from '@taalcut/core';
import type { RunTool } from '@taalcut/ui';
import { asksNow } from './approvals';
import type { Transcript, TranscriptItem } from './transcript';

export type ActivityNote = Extract<TranscriptItem, { kind: 'agent' | 'reasoning' }>;

type RunRow = {
  kind: 'run';
  key: string;
  runId: RunId;
  status?: Transcript['runs'][string];
  plan?: CardOf<'plan'>;
  tools: RunTool[];
  /** What the run's steps cost, for its details (UX3-AGT): never a line of its own under each message. */
  costs: CostEstimateCardV2[];
  notes: ActivityNote[];
};

/** What the transcript shows, in order: items as they are, and each run's plan and calls as one block. */
export type Row = { kind: 'item'; key: string; item: TranscriptItem } | RunRow;

/** A step's cost that goes ahead by itself (version 2, not asking): it belongs in its run's details. */
function quietCost(card: Card): card is CostEstimateCardV2 {
  return card.type === 'costEstimate' && card.version === 2 && card.status !== 'asking' && !asksNow(card);
}

/** Activity can move within an exchange, never below the next message from the creator. */
function exchanges(items: readonly TranscriptItem[]): TranscriptItem[][] {
  const groups: TranscriptItem[][] = [[]];
  for (const item of items) {
    if (item.kind === 'user') groups.push([]);
    groups.at(-1)!.push(item);
  }
  return groups;
}

function runOf(item: TranscriptItem): RunId | undefined {
  if ('runId' in item) return item.runId;
  if (item.kind === 'card' && 'runId' in item.card) return item.card.runId;
  return undefined;
}

function isActivity(item: TranscriptItem): boolean {
  return (
    item.kind === 'reasoning' ||
    (item.kind === 'card' &&
      (item.card.type === 'plan' ||
        (item.card.type === 'toolRun' && !item.card.savedCover) ||
        quietCost(item.card)))
  );
}

/** A sentence attached to a decision, result or notice remains beside what it explains. */
function explainsResult(items: readonly TranscriptItem[], index: number): boolean {
  const next = items.slice(index + 1).find((item) => !isActivity(item));
  return next?.kind === 'card' || next?.kind === 'unsupported' || next?.kind === 'notice';
}

/** The latest prose only reads as a conclusion when it follows the work, including a failed final call. */
function exchangeContext(items: readonly TranscriptItem[]) {
  const last = new Map<RunId, number>();
  const response = new Map<RunId, number>();
  const lastCall = new Map<RunId, number>();
  const recovery = new Set<RunId>();
  let owner: RunId | undefined;
  const owners = items.map((item, index) => {
    // Older cards do not all carry runId; their position still belongs to the preceding run in this exchange.
    owner = runOf(item) ?? owner;
    if (owner) last.set(owner, index);
    if (item.kind === 'agent') response.set(item.runId, index);
    if (item.kind === 'card' && item.card.type === 'toolRun' && !item.card.savedCover) {
      const card = item.card;
      lastCall.set(card.runId, index);
      if (card.status === 'failed' && card.error && card.error.code !== 'agent.run_failed')
        recovery.add(card.runId);
    }
    return owner;
  });
  return { last, response, lastCall, recovery, owners };
}

function earlierCommentary(
  item: TranscriptItem,
  index: number,
  items: readonly TranscriptItem[],
  runs: Transcript['runs'],
  context: ReturnType<typeof exchangeContext>,
): item is Extract<ActivityNote, { kind: 'agent' }> {
  if (item.kind !== 'agent') return false;
  const status = runs[item.runId];
  const response = context.response.get(item.runId) ?? -1;
  return (
    status !== undefined &&
    status !== 'running' &&
    status !== 'paused' &&
    response > index &&
    response > (context.lastCall.get(item.runId) ?? -1) &&
    !explainsResult(items, index)
  );
}

/** Only the reducer's generic fallback is redundant; a distinct run error still needs its own recovery. */
function redundantFailure(item: TranscriptItem, runId: RunId | undefined, recovery: Set<RunId>): boolean {
  return Boolean(
    runId &&
    recovery.has(runId) &&
    item.key === `run-error:${runId}` &&
    item.kind === 'card' &&
    item.card.type === 'error' &&
    item.card.error.code === 'agent.run_failed',
  );
}

function newActivity(runId: RunId, first: TranscriptItem | undefined, runs: Transcript['runs']): RunRow {
  const status = runs[runId];
  return {
    kind: 'run',
    key: `run:${first?.kind === 'user' ? first.key : 'initial'}:${runId}`,
    runId,
    ...(status ? { status } : {}),
    tools: [],
    costs: [],
    notes: [],
  };
}

function exchangeRows(items: readonly TranscriptItem[], runs: Transcript['runs']): Row[] {
  const rows: Row[] = [];
  const activities = new Map<RunId, RunRow>();
  const context = exchangeContext(items);
  const activity = (runId: RunId): RunRow => {
    const existing = activities.get(runId);
    if (existing) return existing;
    const row = newActivity(runId, items[0], runs);
    activities.set(runId, row);
    return row;
  };
  items.forEach((item, index) => {
    const runId = context.owners[index];
    const card = item.kind === 'card' ? item.card : null;
    if (card && quietCost(card)) {
      activity(card.runId).costs.push(card);
    } else if (card?.type === 'plan') {
      activity(card.runId).plan = card;
    } else if (card?.type === 'toolRun' && !card.savedCover) {
      activity(card.runId).tools.push(
        item.kind === 'card' && item.stepId ? { card, stepId: item.stepId } : { card },
      );
    } else if (item.kind === 'reasoning' || earlierCommentary(item, index, items, runs, context)) {
      activity(item.runId).notes.push(item);
    } else if (!redundantFailure(item, runId, context.recovery)) {
      rows.push({ kind: 'item', key: item.key, item });
    }
    const work = runId ? activities.get(runId) : undefined;
    if (work && context.last.get(runId!) === index) rows.push(work);
  });
  return rows;
}

/** Results lead each exchange; its reasoning, calls and quiet costs share one activity disclosure per run. */
export function transcriptRows(items: readonly TranscriptItem[], runs: Transcript['runs'] = {}): Row[] {
  return exchanges(items).flatMap((exchange) => exchangeRows(exchange, runs));
}

/**
 * The card that holds the screen's one marigold primary (DESIGN.md: one per screen; UX round 1): the newest card
 * that asks for an answer now. Older questions still open show their main action as secondary. Null when nothing
 * asks, so every card keeps its own.
 */
export function primaryHolder(items: readonly TranscriptItem[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === 'card' && asksNow(item.card)) return item.card.id;
  }
  return null;
}
