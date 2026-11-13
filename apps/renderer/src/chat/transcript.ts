// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  EFFORT_REASONING,
  parseCard,
  type Card,
  type CardOf,
  type ChatHistoryEvent,
  type ReferencePointer,
  type RunId,
} from '@taalcut/core';
import { asksNow } from './approvals';
import {
  EMPTY_TRANSCRIPT,
  endReasoning,
  upsert,
  type Item,
  type Transcript,
  type TranscriptItem,
} from './transcript-items';
import { finishRun } from './transcript-runs';

/**
 * Folds a conversation's events (history, then live) into what the chat
 * shows. Pure: the same events always give the same transcript, so replaying
 * stored history and streaming a run go through one path.
 */

export {
  EMPTY_TRANSCRIPT,
  type Notice,
  type RunStatus,
  type Transcript,
  type TranscriptItem,
} from './transcript-items';
export { finishRun, RUN_FINISHED, runEnded } from './transcript-runs';

export function replay(events: readonly ChatHistoryEvent[], from: Transcript = EMPTY_TRANSCRIPT): Transcript {
  return events.reduce(applyEvent, from);
}

/** Puts a card in, keeping what the transcript knows about it (the step a tool call ran under). */
function upsertCard(items: readonly TranscriptItem[], card: Card): TranscriptItem[] {
  const existing = items.find((item): item is Item<'card'> => item.key === card.id && item.kind === 'card');
  const stepId = existing?.stepId;
  return upsert(items, { kind: 'card', key: card.id, card, ...(stepId === undefined ? {} : { stepId }) });
}

/** The step of the run's plan that is running now, if any. */
function runningStep(items: readonly TranscriptItem[], runId: RunId): string | undefined {
  const plan = findCard(items, planKey(runId), 'plan');
  return plan?.steps.find((step) => step.status === 'running')?.id;
}

function findCard<T extends Card['type']>(items: readonly TranscriptItem[], key: string, type: T) {
  const item = items.find((existing) => existing.key === key);
  return item?.kind === 'card' && item.card.type === type ? (item.card as CardOf<T>) : undefined;
}

/**
 * Puts the agent's new words above the question they explain (UX round 1): when the run's open questions are the
 * last thing in the chat, its sentence goes before them, so "This needs about $0.04. Shall I go ahead?" reads before
 * the card that asks it. Placed once, as the words start; an answer settles the card first, so a reply after it
 * stays under it.
 */
function wordsAboveQuestion(items: readonly TranscriptItem[], words: Item<'agent'>): TranscriptItem[] {
  let at = items.length;
  for (;;) {
    const before = items[at - 1];
    const asks =
      before?.kind === 'card' &&
      'runId' in before.card &&
      before.card.runId === words.runId &&
      asksNow(before.card);
    if (!asks) break;
    at -= 1;
  }
  return [...items.slice(0, at), words, ...items.slice(at)];
}

const planKey = (runId: RunId) => `plan:${runId}`;

/** A run's pointers go on the message that started it, the latest one, unless it already has them (history). */
function withPointers(items: readonly TranscriptItem[], pointers: readonly ReferencePointer[]) {
  const latest = items.findLastIndex((item) => item.kind === 'user');
  const message = items[latest];
  if (message?.kind !== 'user' || message.pointers?.length) return items;
  return items.with(latest, { ...message, pointers });
}

/** A model turn stops speaking when it starts thinking, acts, or begins its next message. */
function endMessages(items: readonly TranscriptItem[], runId: RunId, continuing?: string): TranscriptItem[] {
  return items.map((item) =>
    item.kind === 'agent' && item.runId === runId && item.streaming && item.key !== continuing
      ? { ...item, streaming: false }
      : item,
  );
}

function resumeReasoning(items: readonly TranscriptItem[], runId: RunId, delta: string, at: number) {
  const key = `reasoning:${runId}`;
  const existing = items.find(
    (item): item is Item<'reasoning'> => item.key === key && item.kind === 'reasoning',
  );
  const currentText = (existing?.working ? (existing.currentText ?? existing.text) : '') + delta;
  const segments = existing?.segments ?? (existing ? [existing.text] : []);
  const item: Item<'reasoning'> = {
    kind: 'reasoning',
    key,
    runId,
    text: (existing?.text ?? '') + delta,
    currentText,
    segments: existing?.working ? [...segments.slice(0, -1), currentText] : [...segments, delta],
    working: true,
    // A later turn resumes this trace, but its current thinking clock starts afresh.
    startedAt: existing?.working ? existing.startedAt : at,
  };
  return upsert(endMessages(items, runId), item);
}

export function applyEvent(state: Transcript, event: ChatHistoryEvent): Transcript {
  const { items } = state;
  switch (event.type) {
    case 'user.message': {
      const { messageId, text, selections, pointers, start } = event.payload;
      const item: Item<'user'> = {
        kind: 'user',
        key: messageId,
        text,
        at: event.at,
        ...(selections?.length ? { selections } : {}),
        ...(start ? { start } : {}),
        ...(pointers?.length ? { pointers } : {}),
      };
      return { ...state, items: upsert(items, item) };
    }
    case 'agent.runStarted': {
      const { runId, reasoning, effort, pointers } = event.payload;
      // UX3-AGT: the exact level the chat picked; a run from before it only kept the effort it asked for.
      const level = reasoning ?? (effort ? EFFORT_REASONING[effort][0] : undefined);
      // A paused run that carries on (it took an answer) no longer waits: its waiting line goes, and a later
      // pause puts a new one under the newest question (UX round 1: one waiting line per paused run).
      const going =
        state.runs[runId] === 'paused'
          ? items.filter(
              (item) => !(item.kind === 'notice' && item.runId === runId && item.notice === 'paused'),
            )
          : items;
      return {
        ...state,
        items: pointers?.length ? withPointers(going, pointers) : going,
        runs: { ...state.runs, [runId]: 'running' },
        activeRunId: runId,
        ...(level ? { reasoning: level } : {}),
      };
    }
    case 'agent.reasoningDelta': {
      const { runId, delta } = event.payload;
      return { ...state, items: resumeReasoning(items, runId, delta, event.at) };
    }
    case 'agent.plan': {
      const { runId, steps } = event.payload;
      const card: CardOf<'plan'> = { type: 'plan', id: planKey(runId), version: 1, runId, steps };
      const next = endReasoning(endMessages(items, runId), runId, event.at);
      return { ...state, items: upsert(next, { kind: 'card', key: card.id, card }) };
    }
    case 'agent.step': {
      const { runId, stepId, status } = event.payload;
      const plan = findCard(items, planKey(runId), 'plan');
      if (!plan) return state;
      const steps = plan.steps.map((step) => (step.id === stepId ? { ...step, status } : step));
      return { ...state, items: upsertCard(items, { ...plan, steps }) };
    }
    case 'agent.toolStarted': {
      const { runId, toolRunId, tool } = event.payload;
      const card: CardOf<'toolRun'> = {
        type: 'toolRun',
        id: toolRunId,
        version: 1,
        runId,
        toolRunId,
        tool,
        status: 'running',
        startedAt: event.at,
      };
      const next = endReasoning(endMessages(items, runId), runId, event.at);
      const stepId = runningStep(items, runId);
      return {
        ...state,
        items: upsert(next, {
          kind: 'card',
          key: card.id,
          card,
          ...(stepId === undefined ? {} : { stepId }),
        }),
      };
    }
    case 'agent.toolFinished': {
      const { toolRunId, status, durationMs, error, summary } = event.payload;
      const card = findCard(items, toolRunId, 'toolRun');
      if (!card) return state;
      const finished: CardOf<'toolRun'> = {
        ...card,
        status,
        finishedAt: card.startedAt + Math.round(durationMs),
        ...(error ? { error } : {}),
        // What the call was about ("IMG_0412.MOV · 0:48"): the row says it beside the tool's name.
        ...(summary ? { summary } : {}),
      };
      return { ...state, items: upsertCard(items, finished) };
    }
    case 'agent.card': {
      const parsed = parseCard(event.payload.card);
      const next = endReasoning(endMessages(items, event.payload.runId), event.payload.runId, event.at);
      if (!parsed.ok) {
        const key = `unsupported:${String((event.payload.card as { id?: unknown }).id)}`;
        return { ...state, items: upsert(next, { kind: 'unsupported', key }) };
      }
      return { ...state, items: upsertCard(next, parsed.value) };
    }
    case 'agent.messageDelta': {
      const { runId, messageId, delta } = event.payload;
      const existing = items.find(
        (item): item is Item<'agent'> => item.key === messageId && item.kind === 'agent',
      );
      const next = endReasoning(endMessages(items, runId, messageId), runId, event.at);
      if (existing)
        return {
          ...state,
          items: upsert(next, { ...existing, text: existing.text + delta, streaming: true }),
        };
      const item: Item<'agent'> = {
        kind: 'agent',
        key: messageId,
        runId,
        text: delta,
        streaming: true,
        at: event.at,
      };
      return { ...state, items: wordsAboveQuestion(next, item) };
    }
    case 'agent.approvalRequested': {
      const { runId, approvalId, tool, sideEffect, reason } = event.payload;
      const card: CardOf<'approval'> = {
        type: 'approval',
        id: approvalId,
        version: 1,
        runId,
        approvalId,
        tool,
        sideEffect,
        summary: reason,
        status: 'pending',
      };
      return {
        ...state,
        items: upsert(endReasoning(endMessages(items, runId), runId, event.at), {
          kind: 'card',
          key: card.id,
          card,
        }),
      };
    }
    case 'agent.budgetExceeded': {
      const { runId } = event.payload;
      return {
        ...state,
        items: upsert(items, { kind: 'notice', key: `budget:${runId}`, runId, notice: 'budget' }),
      };
    }
    case 'agent.runFinished':
      return finishRun(
        state,
        event.payload.runId,
        event.payload.status,
        event.at,
        event.payload.error ??
          (event.payload.status === 'failed'
            ? { code: 'agent.run_failed', messageKey: 'errors.generic', retryable: true }
            : undefined),
      );
  }
}
