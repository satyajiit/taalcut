// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- seeded conversations: user and model text, never translated */

/**
 * BRK1-REV: two chats that have just read a reel, at fixed ids for the review's end-to-end specs and screenshots:
 * "Rainy market walk", portrait, with things Taalcut isn't sure of, and "Coast road trip", landscape, 15 slots. Each
 * ends on its breakdown card; Review the reel opens the review sheet on it. Hidden: opened by their links only, so
 * the sidebar's chats stay as they are.
 */
import type {
  CardOf,
  ChatHistoryEvent,
  ConversationId,
  ConversationSummary,
  MessageId,
  RunId,
} from '@taalcut/core';
import { COAST_ROAD, RAINY_MARKET } from '../backend/fake/templates/template-review-plans';
import { templateIdOf } from '../backend/fake/templates/template-data';

export const REVIEW_PORTRAIT_CHAT = '01K7C5M6Q8R9S0T1V2W3X4RV01' as ConversationId;
export const REVIEW_LANDSCAPE_CHAT = '01K7C5M6Q8R9S0T1V2W3X4RV02' as ConversationId;

interface ReviewSeed {
  summary: ConversationSummary;
  history: ChatHistoryEvent[];
  hidden: true;
}

function readReel(
  id: ConversationId,
  n: number,
  title: string,
  link: string,
  platform: 'reels' | 'shorts',
  plan: typeof RAINY_MARKET,
  seconds: number,
): ReviewSeed {
  const start = Date.UTC(2026, 9, 31, 10, n);
  const runId = `01K7C5M6Q8R9S0T1V2W3X4RR0${n}` as RunId;
  const card = {
    type: 'breakdown',
    id: `breakdown:review-${n}`,
    version: 1,
    runId,
    stage: 'ready',
    progress: null,
    source: { input: 'link', platform, duration: { value: seconds * 30, rate: { num: 30, den: 1 } } },
    template: { id: templateIdOf(plan), version: 1 },
  } satisfies CardOf<'breakdown'>;
  const history: ChatHistoryEvent[] = [
    {
      type: 'user.message',
      at: start,
      payload: {
        messageId: `01K7C5M6Q8R9S0T1V2W3X4RM0${n}` as MessageId,
        conversationId: id,
        text: `Read this reel: ${link}`,
      },
    },
    { type: 'agent.runStarted', at: start + 300, payload: { runId, conversationId: id } },
    {
      type: 'agent.messageDelta',
      at: start + 900,
      payload: {
        runId,
        messageId: `01K7C5M6Q8R9S0T1V2W3X4RA0${n}` as MessageId,
        delta: 'Here is the reel, slot by slot. Have a look at what I wasn’t sure of before you use it.',
      },
    },
    { type: 'agent.card', at: start + 950, payload: { runId, card } },
    { type: 'agent.runFinished', at: start + 1_000, payload: { runId, status: 'succeeded' } },
  ];
  return { summary: { id, title, createdAt: start, updatedAt: start + 1_000 }, history, hidden: true };
}

/** Fresh copies each time, like the other seeds. */
export function reviewSeeds(): ReviewSeed[] {
  return [
    readReel(
      REVIEW_PORTRAIT_CHAT,
      1,
      'Rainy market reel',
      'https://www.instagram.com/reel/EXAMPLE123/',
      'reels',
      RAINY_MARKET,
      10,
    ),
    readReel(
      REVIEW_LANDSCAPE_CHAT,
      2,
      'Coast road reel',
      'https://www.youtube.com/shorts/EXAMPLE456',
      'shorts',
      COAST_ROAD,
      15,
    ),
  ];
}
