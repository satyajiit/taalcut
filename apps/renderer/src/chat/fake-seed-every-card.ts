// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- a seeded conversation: user and model text, never translated */

/**
 * FIX-DOCKCHAT: one chat that holds every card the kit has, in every state worth seeing (`CARD_FIXTURES`), so the
 * layout of each can be checked at any width a chat has: the full page by its link, and the editor's narrow column
 * when `taalcut.fake` has `reelRun: 'everyCard'` (the reel run's project then has this chat instead of its own;
 * backend/fake/make/p3/seeds/reel-run.ts). Hidden, and its run has ended, so nothing waits on it.
 */
import type { Card, ChatHistoryEvent, ConversationSummary, MessageId, RunId } from '@taalcut/core';
import { CARD_FIXTURES } from '@taalcut/ui';
import { EVERY_CARD_CONVERSATION, REEL_RUN_PROJECT } from '../backend/fake/make/p3/seeds/reel-run';

const RUN = '01K7C5M6Q8R9S0T1V2W3X4RK03' as RunId;

/** Each fixture under an id of its own (`every:<type>:<state>`), in this chat's run. */
export function everyCard(): Card[] {
  return Object.entries(CARD_FIXTURES).flatMap(([type, states]) =>
    Object.entries(states as Readonly<Record<string, Card>>).map(([state, card]) => ({
      ...card,
      id: `every:${type}:${state}`,
      ...('runId' in card ? { runId: RUN } : {}),
    })),
  );
}

export function everyCardSeed(): { summary: ConversationSummary; history: ChatHistoryEvent[]; hidden: true } {
  const id = EVERY_CARD_CONVERSATION;
  const start = Date.UTC(2026, 10, 14, 15, 0);
  const cards = everyCard();
  const history: ChatHistoryEvent[] = [
    {
      type: 'user.message',
      at: start,
      payload: {
        messageId: '01K7C5M6Q8R9S0T1V2W3X4RK20' as MessageId,
        conversationId: id,
        text: 'Show me every card.',
      },
    },
    { type: 'agent.runStarted', at: start + 300, payload: { runId: RUN, conversationId: id } },
    ...cards.map((card, index): ChatHistoryEvent => ({
      type: 'agent.card',
      at: start + 1_000 + index * 100,
      payload: { runId: RUN, card },
    })),
    {
      type: 'agent.runFinished',
      at: start + 2_000 + cards.length * 100,
      payload: { runId: RUN, status: 'succeeded' },
    },
  ];
  return {
    summary: {
      id,
      title: 'Every card',
      createdAt: start,
      updatedAt: start + 2_000 + cards.length * 100,
      projectId: REEL_RUN_PROJECT,
    },
    history,
    hidden: true,
  };
}
