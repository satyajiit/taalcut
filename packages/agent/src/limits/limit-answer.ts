// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The person's answer on a rateLimit card (core's `{ kind: 'rateLimit', choice, model? }`): wait until the
 * limit lifts, switch this run to another option, or stop. "Don't" (a deny) is a stop; an approve without an
 * answer is a wait. The card moves on under its own id.
 */
import type { QuestionAnswer } from '@taalcut/core';
import type { ApprovalAnswer } from '../agent-types';
import type { EventInput } from '../run-log';
import type { ApprovalState, RunState } from '../run-state';
import { cardOf } from './limit-pause';
import { movedCard } from './limit-cards';

/** How long a wait lasts when the provider didn't say when its limit lifts. */
export const LIMIT_WAIT_MS = { rate: 60_000, quota: 60 * 60_000, plan: 60 * 60_000 } as const;

type RateLimitAnswer = Extract<QuestionAnswer, { kind: 'rateLimit' }>;

export function rateLimitAnswerEvents(
  state: RunState,
  approval: ApprovalState,
  answer: ApprovalAnswer,
  now: number,
  stop: () => EventInput[],
): EventInput[] {
  const { request } = approval;
  const ask = request.rateLimit;
  const card = cardOf(state, request.requestId);
  const note = answer.note ? { note: answer.note } : {};
  const choice: RateLimitAnswer =
    answer.decision === 'deny'
      ? { kind: 'rateLimit', choice: 'stop' }
      : answer.answer?.kind === 'rateLimit'
        ? answer.answer
        : { kind: 'rateLimit', choice: 'wait' };
  const moved = (status: 'waiting' | 'switched' | 'stopped', to?: Parameters<typeof movedCard>[2]) =>
    card ? [['card.sent', { card: movedCard(card, status, to) }] as EventInput] : [];

  if (choice.choice === 'stop') {
    const answered: EventInput =
      answer.decision === 'deny'
        ? ['approval.denied', { requestId: request.requestId, ...note }]
        : ['approval.granted', { requestId: request.requestId, ...note, answer: choice }];
    return [answered, ...moved('stopped'), ...stop(), ['run.cancelled', {}]];
  }
  const granted: EventInput = ['approval.granted', { requestId: request.requestId, ...note, answer: choice }];
  if (choice.choice === 'switch' && choice.model && ask) {
    const offered = ask.options.find(
      (o) => o.provider === choice.model?.provider && o.model === choice.model.model,
    );
    const to = { provider: choice.model.provider, model: choice.model.model, local: offered?.local ?? false };
    return [
      granted,
      ['limit.switched', { requestId: request.requestId, module: ask.module, to: choice.model }],
      ...moved('switched', to),
    ];
  }
  const until = ask?.resetsAt ?? now + LIMIT_WAIT_MS[ask?.kind ?? 'rate'];
  return [granted, ['limit.waiting', { requestId: request.requestId, until }], ...moved('waiting')];
}
