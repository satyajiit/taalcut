// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- a seeded conversation: user and model text, never translated */

/**
 * FIX-DOCKCHAT: the chat of a run that copied a reel, as the editor's chat showed it on 2026-11-14: the breakdown
 * card, the cast board (32 slots, each pick with its other shots), an export that needs a look and one that failed.
 * The four cards are that run's own, as it last sent them (the board went out fifteen times; a card's id keeps the
 * newest), with the ids of the fake's project, video, template and exports in place of the real ones. The project
 * is "Travel days in quick cuts" (backend/fake/make/p3/seeds/reel-run.ts), seeded when `taalcut.fake` has
 * `reelRun: true`; the chat is hidden, opened by its link or beside that project's editor.
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
import { fakeUlid } from '../backend/fake/library/seed';
import { MAKE_KIND } from '../backend/fake/make/ids';
import {
  REEL_RUN_CAST,
  REEL_RUN_CONVERSATION,
  REEL_RUN_PROJECT,
  REEL_RUN_TIMELINE,
} from '../backend/fake/make/p3/seeds/reel-run';
import { templateIdOf } from '../backend/fake/templates/template-data';
import { REEL_RUN } from '../backend/fake/templates/template-reel-run';

const RUN = '01K7C5M6Q8R9S0T1V2W3X4RK01' as RunId;
const FLOW = '01K7C5M6Q8R9S0T1V2W3X4RK02' as Id<'Flow'>;
const message = (n: number) => `01K7C5M6Q8R9S0T1V2W3X4RK1${n}` as MessageId;
/** The two exports render-seed.ts seeds for the project: the one to look at, and the one that failed. */
const render = (n: number) => fakeUlid<'Render'>(MAKE_KIND.render, n);
const job = (n: number) => fakeUlid<'Job'>(MAKE_KIND.job, n);

const step = (stepId: string, index: number, skill: string): FlowStepRef => ({
  flowId: FLOW,
  stepId,
  index,
  count: 5,
  skill,
  status: 'ready',
  editedByYou: true,
});

const breakdown = {
  type: 'breakdown',
  id: `step:${FLOW}:templates.analyst`,
  version: 1,
  runId: RUN,
  step: step('f1', 1, 'templates.analyst'),
  stage: 'ready',
  progress: null,
  source: { input: 'link', platform: 'reels', duration: { value: 438, rate: { num: 30, den: 1 } } },
  template: { id: templateIdOf(REEL_RUN), version: 1 },
} satisfies CardOf<'breakdown'>;

const castBoard = {
  type: 'castBoard',
  id: `step:${FLOW}:timeline.librarian`,
  version: 1,
  runId: RUN,
  step: step('f2', 2, 'timeline.librarian'),
  projectId: REEL_RUN_PROJECT,
  castId: REEL_RUN_CAST,
  timelineIds: [REEL_RUN_TIMELINE],
  lowConfidence: 21,
} satisfies CardOf<'castBoard'>;

const needsLook = {
  type: 'renderProgress',
  id: `renderProgress:${render(70)}`,
  version: 1,
  runId: RUN,
  renderId: render(70),
  projectId: REEL_RUN_PROJECT,
  jobId: job(70),
  presetId: 'device',
  status: 'needsAttention',
  progress: null,
  notify: false,
  qa: {
    verdict: 'needsAttention',
    round: 1,
    passed: 24,
    warned: 3,
    failed: 1,
    fixed: 0,
    failing: ['graphicCoversFace'],
  },
} satisfies CardOf<'renderProgress'>;

const failed = {
  type: 'renderProgress',
  id: `renderProgress:${render(71)}`,
  version: 1,
  runId: RUN,
  renderId: render(71),
  projectId: REEL_RUN_PROJECT,
  jobId: job(71),
  presetId: 'device',
  status: 'failed',
  progress: null,
  notify: false,
  qa: null,
} satisfies CardOf<'renderProgress'>;

/** The run's cards, in the order its chat shows them. */
export const REEL_RUN_CARDS = { breakdown, castBoard, needsLook, failed } as const;

export function reelRunSeed(): { summary: ConversationSummary; history: ChatHistoryEvent[]; hidden: true } {
  const id = REEL_RUN_CONVERSATION;
  const start = Date.UTC(2026, 10, 14, 13, 5);
  const says = (n: number, at: number, delta: string): ChatHistoryEvent => ({
    type: 'agent.messageDelta',
    at,
    payload: { runId: RUN, messageId: message(n), delta },
  });
  const card = (
    at: number,
    sent: CardOf<'breakdown' | 'castBoard' | 'renderProgress'>,
  ): ChatHistoryEvent => ({
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
        text: 'lets do one from https://www.instagram.com/reel/EXAMPLE789/',
      },
    },
    { type: 'agent.runStarted', at: start + 300, payload: { runId: RUN, conversationId: id } },
    says(
      1,
      start + 60_000,
      'I read the reel: 32 shots in under fifteen seconds, most a quarter of a second long.',
    ),
    card(start + 61_000, breakdown),
    says(2, start + 240_000, 'Here are your clips for it, slot by slot. Swap any pick that isn’t right.'),
    card(start + 241_000, castBoard),
    says(3, start + 600_000, 'The draft is cut. One check needs a look before it goes out.'),
    card(start + 601_000, needsLook),
    says(4, start + 900_000, 'I changed the words on screen and tried the export again, and it failed.'),
    card(start + 901_000, failed),
    { type: 'agent.runFinished', at: start + 902_000, payload: { runId: RUN, status: 'failed' } },
  ];
  return {
    summary: {
      id,
      title: 'Travel days in quick cuts',
      createdAt: start,
      updatedAt: start + 902_000,
      projectId: REEL_RUN_PROJECT,
    },
    history,
    hidden: true,
  };
}
