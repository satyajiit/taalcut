// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK: the chat's half of answering the gaps question in words. When the conversation's latest run waits on the
 * gapFix question and the message answers it (gaps/gap-reply.ts), the message is that answer: the run carries on
 * instead of a new run starting beside it. Anything else goes on as a message of its own.
 */
import type { RunId } from '@taalcut/core';
import type { Agent, ApprovalAnswer } from './agent-types';
import { TERMINAL_EVENTS, type AgentEvent } from './events';
import type { GapAnswer } from './gaps/answers';
import { readJoinData } from './gaps/gap-card';
import { gapReply } from './gaps/gap-reply';

export interface ChatGapAnswer {
  readonly runId: RunId;
  readonly requestId: string;
  readonly fixes: GapAnswer[];
}

/** The gapFix question a run's log still waits on, with the facts its card showed, or undefined. */
export function waitingGapQuestion(events: readonly AgentEvent[]) {
  if (events.length === 0 || events.some((event) => TERMINAL_EVENTS.includes(event.type))) return undefined;
  const asked = events.findLast((e) => e.type === 'approval.requested' && e.payload.question === 'gapFix');
  if (asked?.type !== 'approval.requested') return undefined;
  const { requestId } = asked.payload;
  const answered = events.some(
    (e) =>
      (e.type === 'approval.granted' || e.type === 'approval.denied') && e.payload.requestId === requestId,
  );
  if (answered) return undefined;
  const extended = events.findLast((e) => e.type === 'flow.extended' && e.payload.extension === 'gaps');
  const data = extended?.type === 'flow.extended' ? readJoinData(extended.payload.data) : undefined;
  return data ? { requestId, data } : undefined;
}

/** The chat message as an answer to the conversation's waiting gaps question, if it is one. */
export async function chatGapAnswer(
  agent: Pick<Agent, 'events'>,
  runIds: readonly RunId[],
  text: string,
): Promise<ChatGapAnswer | undefined> {
  const runId = runIds.at(-1);
  if (!runId) return undefined;
  const log = await agent.events(runId);
  if (!log.ok) return undefined;
  const waiting = waitingGapQuestion(log.value);
  const fixes = waiting && gapReply(text, waiting.data);
  return waiting && fixes ? { runId, requestId: waiting.requestId, fixes } : undefined;
}

/**
 * Answers the waiting gaps question with the message, if it answers it: `follow` starts the chat's stream of that run
 * first and gives back how to end it, which happens once the run stops again. Resolves the run's id, or undefined
 * (the message starts a run of its own).
 */
export async function answerInChat(
  agent: Pick<Agent, 'events' | 'answer'>,
  runIds: readonly RunId[],
  text: string,
  follow: (runId: RunId) => Promise<() => void>,
): Promise<RunId | undefined> {
  const reply = await chatGapAnswer(agent, runIds, text);
  if (!reply) return undefined;
  const end = await follow(reply.runId);
  // The ids are the card's own (the answer's schema checks them again).
  const answer = { kind: 'gapFix', fixes: reply.fixes } as NonNullable<ApprovalAnswer['answer']>;
  void agent.answer(reply.runId, { requestId: reply.requestId, decision: 'approve', answer }).then(end, end);
  return reply.runId;
}
