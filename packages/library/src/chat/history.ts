// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Turns a stored conversation into the events the renderer's transcript
 * replays (apps/renderer/src/chat/transcript.ts), so history and a live run
 * go through the same reducer. Pure.
 *
 * Messages, tool runs and cards no message refers to are merged by time. A
 * run starts before its first agent-side item and finishes after its last,
 * with its stored status; a run still `running` gets no finish (it is live, or
 * the recovery report lists it). Assistant text arrives as one messageDelta
 * per text part; cards as `agent.card` with their latest payload.
 */
import {
  parseCard,
  taalcutErrorSchema,
  type Card,
  type ConversationId,
  type RunId,
  type RunSummary,
} from '@taalcut/core';
import type { ChatCard, ChatHistoryEvent, ChatMessage, ChatToolRun, ConversationHistory } from './types';

type Entry =
  | {
      readonly kind: 'message';
      readonly at: number;
      readonly runId: RunId | null;
      readonly message: ChatMessage;
    }
  | { readonly kind: 'tool'; readonly at: number; readonly runId: RunId; readonly tool: ChatToolRun }
  | { readonly kind: 'card'; readonly at: number; readonly runId: RunId | null; readonly card: ChatCard };

const ORDER = { message: 0, tool: 1, card: 2 } as const;

/** Assistant messages outside any run get a run of their own, so nothing is left streaming. */
const runOf = (entry: Entry): RunId | null =>
  entry.kind === 'message' && entry.message.role !== 'user' && !entry.runId
    ? (entry.message.id as unknown as RunId)
    : entry.runId;

/** The renderer re-validates every card; one it can't parse shows as "unsupported", so pass it through. */
const asCard = (payload: unknown): Card => {
  const parsed = parseCard(payload);
  return parsed.ok ? parsed.value : (payload as Card);
};

function timeline(history: ConversationHistory): Entry[] {
  const referenced = new Set(
    history.messages.flatMap((m) => m.parts.flatMap((p) => (p.type === 'card' ? [p.cardId] : []))),
  );
  const entries: Entry[] = [
    ...history.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ kind: 'message' as const, at: message.createdAt, runId: message.runId, message })),
    ...history.toolRuns.flatMap((tool) =>
      tool.runId ? [{ kind: 'tool' as const, at: tool.startedAt, runId: tool.runId, tool }] : [],
    ),
    ...history.cards
      .filter((card) => !referenced.has(card.cardId))
      .map((card) => ({ kind: 'card' as const, at: card.createdAt, runId: card.runId, card })),
  ];
  // Stable: equal times keep messages, then tool runs, then cards, each in stored order.
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.at - b.entry.at || ORDER[a.entry.kind] - ORDER[b.entry.kind] || a.index - b.index)
    .map(({ entry }) => entry);
}

function finish(run: RunSummary | undefined, runId: RunId, at: number): ChatHistoryEvent | null {
  const status = run?.status ?? 'succeeded';
  if (status === 'running') return null;
  return { type: 'agent.runFinished', at: Math.max(at, run?.updatedAt ?? at), payload: { runId, status } };
}

export function toChatHistory(history: ConversationHistory): ChatHistoryEvent[] {
  const conversationId: ConversationId = history.conversation.id;
  const runs = new Map(history.runs.map((run) => [run.runId, run]));
  const cards = new Map(history.cards.map((card) => [card.cardId, card]));
  const entries = timeline(history);
  const last = new Map<RunId, number>();
  entries.forEach((entry, i) => {
    const runId = runOf(entry);
    if (runId && !(entry.kind === 'message' && entry.message.role === 'user')) last.set(runId, i);
  });

  const events: ChatHistoryEvent[] = [];
  const started = new Set<RunId>();
  entries.forEach((entry, i) => {
    const runId = runOf(entry);
    const agentSide = runId !== null && !(entry.kind === 'message' && entry.message.role === 'user');
    if (agentSide && !started.has(runId)) {
      started.add(runId);
      events.push({ type: 'agent.runStarted', at: entry.at, payload: { runId, conversationId } });
    }
    if (entry.kind === 'message') {
      const { message } = entry;
      if (message.role === 'user') {
        const text = message.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n');
        events.push({
          type: 'user.message',
          at: message.createdAt,
          payload: { messageId: message.id, conversationId, text },
        });
      } else {
        for (const part of message.parts) {
          if (part.type === 'text') {
            events.push({
              type: 'agent.messageDelta',
              at: message.createdAt,
              payload: { runId: runId!, messageId: message.id, delta: part.text },
            });
          } else {
            const card = cards.get(part.cardId);
            if (card)
              events.push({
                type: 'agent.card',
                at: message.createdAt,
                payload: { runId: runId!, card: asCard(card.card) },
              });
          }
        }
      }
    } else if (entry.kind === 'tool') {
      const { tool } = entry;
      const base = { runId: entry.runId, toolRunId: tool.id, tool: tool.tool };
      events.push({
        type: 'agent.toolStarted',
        at: tool.startedAt,
        payload: { ...base, sideEffect: tool.sideEffect ?? 'read' },
      });
      if (tool.status !== 'running' && tool.finishedAt !== null) {
        const error = taalcutErrorSchema.safeParse(tool.error);
        events.push({
          type: 'agent.toolFinished',
          at: tool.finishedAt,
          payload: {
            ...base,
            status: tool.status,
            durationMs: Math.max(0, tool.finishedAt - tool.startedAt),
            ...(error.success ? { error: error.data } : {}),
          },
        });
      }
    } else {
      const runIdOrEmpty = (entry.runId ?? '') as RunId;
      events.push({
        type: 'agent.card',
        at: entry.at,
        payload: { runId: runIdOrEmpty, card: asCard(entry.card.card) },
      });
    }
    if (runId && last.get(runId) === i) {
      const done = finish(runs.get(runId), runId, entry.at);
      if (done) events.push(done);
    }
  });
  return events;
}
