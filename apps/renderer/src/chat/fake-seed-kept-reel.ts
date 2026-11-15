// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- a seeded conversation: user and model text, never translated */

/**
 * KEEP1: the chat of a run that copied a reel whose last two shots are the format's fixed part: the breakdown card
 * (Review the reel opens the review, where each slot says whose clip it plays) and the cast board (one pick of the
 * person's, two shots that are the reel's own). The template is templates/template-kept-reel.ts, always in the fake;
 * the project and its video (backend/fake/make/p3/seeds/kept-reel.ts) are seeded when `taalcut.fake` has
 * `keptReel: true`. Hidden: opened by its link or beside that project's editor.
 */
import type {
  CardOf,
  ChatHistoryEvent,
  ConversationSummary,
  FlowStepRef,
  Id,
  MessageId,
  RunId,
} from '@taalcut/core';
import {
  KEPT_REEL_CAST,
  KEPT_REEL_CONVERSATION,
  KEPT_REEL_PROJECT,
  KEPT_REEL_TIMELINE,
} from '../backend/fake/make/p3/seeds/kept-reel';
import { templateIdOf } from '../backend/fake/templates/template-data';
import { KEPT_REEL } from '../backend/fake/templates/template-kept-reel';

const RUN = '01K7C5M6Q8R9S0T1V2W3X4KR01' as RunId;
const FLOW = '01K7C5M6Q8R9S0T1V2W3X4KR02' as Id<'Flow'>;
const message = (n: number) => `01K7C5M6Q8R9S0T1V2W3X4KR1${n}` as MessageId;

const step = (stepId: string, index: number, skill: string): FlowStepRef => ({
  flowId: FLOW,
  stepId,
  index,
  count: 4,
  skill,
  status: 'ready',
  editedByYou: false,
});

const breakdown = {
  type: 'breakdown',
  id: `step:${FLOW}:templates.analyst`,
  version: 1,
  runId: RUN,
  step: step('k1', 1, 'templates.analyst'),
  stage: 'ready',
  progress: null,
  source: { input: 'link', platform: 'reels', duration: { value: 150, rate: { num: 30, den: 1 } } },
  template: { id: templateIdOf(KEPT_REEL), version: 1 },
} satisfies CardOf<'breakdown'>;

const castBoard = {
  type: 'castBoard',
  id: `step:${FLOW}:timeline.librarian`,
  version: 1,
  runId: RUN,
  step: step('k2', 2, 'timeline.librarian'),
  projectId: KEPT_REEL_PROJECT,
  castId: KEPT_REEL_CAST,
  timelineIds: [KEPT_REEL_TIMELINE],
  lowConfidence: 0,
} satisfies CardOf<'castBoard'>;

/** The run's cards, in the order its chat shows them. */
export const KEPT_REEL_CARDS = { breakdown, castBoard } as const;

export function keptReelSeed(): { summary: ConversationSummary; history: ChatHistoryEvent[]; hidden: true } {
  const id = KEPT_REEL_CONVERSATION;
  const start = Date.UTC(2026, 10, 15, 9, 0);
  const says = (n: number, at: number, delta: string): ChatHistoryEvent => ({
    type: 'agent.messageDelta',
    at,
    payload: { runId: RUN, messageId: message(n), delta },
  });
  const card = (at: number, sent: CardOf<'breakdown' | 'castBoard'>): ChatHistoryEvent => ({
    type: 'agent.card',
    at,
    payload: { runId: RUN, card: sent },
  });
  const history: ChatHistoryEvent[] = [
    {
      type: 'user.message',
      at: start,
      payload: {
        messageId: message(0),
        conversationId: id,
        text: 'make one like https://www.instagram.com/reel/EXAMPLEKEEP/ with my morning clip',
      },
    },
    { type: 'agent.runStarted', at: start + 300, payload: { runId: RUN, conversationId: id } },
    says(
      1,
      start + 40_000,
      'I read the reel: your shot first, then a film scene and a reaction clip that the format keeps as they are.',
    ),
    card(start + 41_000, breakdown),
    says(2, start + 120_000, 'Your clip is in the first slot. The other two shots are the reel’s own.'),
    card(start + 121_000, castBoard),
    { type: 'agent.runFinished', at: start + 122_000, payload: { runId: RUN, status: 'succeeded' } },
  ];
  return {
    summary: {
      id,
      title: 'My morning, then the scene',
      createdAt: start,
      updatedAt: start + 122_000,
      projectId: KEPT_REEL_PROJECT,
    },
    history,
    hidden: true,
  };
}
