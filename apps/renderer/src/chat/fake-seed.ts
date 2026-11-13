// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- seeded conversations: user and model text, never translated */

import type {
  ConversationId,
  MessageId,
  RunId,
  ToolRunId,
  ChatHistoryEvent,
  ConversationSummary,
} from '@taalcut/core';
import { CARD_FIXTURES } from '@taalcut/ui';
import { settle as settleCard } from './fake-run-kit';
import { FLOW_PROJECT, FLOW_TIMELINE } from './fake-flow-cards';
import {
  answerScript,
  gateDemo,
  GATE_DEMO_PROMPT,
  INSPECT_PROMPT,
  inspectClips,
  settle,
  type ScriptIds,
} from './fake-script';
import { reviewSeeds } from './fake-seed-review';
import { workspaceSeeds } from './fake-workspace-script';

/**
 * The fake's starting conversations, with fixed ids and times so screenshots
 * are stable. The first id is the one the end-to-end route list opens, so
 * every card type shows up in the light, dark and pseudo-locale screenshots.
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A valid, deterministic ULID: a fixed prefix and a counter. */
export function seededId<T>(n: number): T {
  let tail = '';
  for (let value = n, i = 0; i < 4; i += 1, value = Math.floor(value / 32))
    tail = CROCKFORD[value % 32] + tail;
  return `01K7C5M6Q8R9S0T1V2W3X4${tail}` as T;
}

export const SEEDED_CONVERSATION_ID = '01K7C5M6Q8R9S0T1V2W3X4Y5Z6' as ConversationId;

interface Seed {
  summary: ConversationSummary;
  history: ChatHistoryEvent[];
  /** Opened by its link only, never listed (the review page's demo): the sidebar's chats stay as they are. */
  hidden?: true;
}

let counter = 0;
const next = <T>() => seededId<T>(++counter);

function ids(conversationId: ConversationId): ScriptIds {
  return {
    conversationId,
    runId: next<RunId>(),
    messageId: next<MessageId>(),
    toolRunId: () => next<ToolRunId>(),
  };
}

function user(conversationId: ConversationId, text: string, at: number): ChatHistoryEvent {
  return { type: 'user.message', at, payload: { messageId: next<MessageId>(), conversationId, text } };
}

function tripReel(): Seed {
  const id = SEEDED_CONVERSATION_ID;
  const start = Date.UTC(2026, 9, 10, 9, 30);
  const first = settle(gateDemo(ids(id)), start + 1_000);
  const second = ids(id);
  const asked = first.end + 60_000;
  const { runId, conversationId, messageId } = second;
  const cost = { ...CARD_FIXTURES.costEstimate.needsApproval!, runId, id: 'cost:trip' };
  // As the app does (pendingAsks): the next message answered the cost question "Not now" before it went, so the
  // run picked up, settled its card and ended. Only the newest question still waits (UX round 1).
  const declined = settle(
    answerScript(
      { runId, conversationId, messageId: next<MessageId>() },
      settleCard(cost, 'deny'),
      'deny',
      false,
    ),
    asked + 120_000,
  );
  const history: ChatHistoryEvent[] = [
    user(id, GATE_DEMO_PROMPT, start),
    ...first.events,
    user(id, 'Cut a 30 second reel from it, on the beat.', asked),
    // Sent with Deep picked in the composer: the chat reopens on it.
    { type: 'agent.runStarted', at: asked + 200, payload: { runId, conversationId, reasoning: 'high' } },
    {
      type: 'agent.reasoningDelta',
      at: asked + 400,
      payload: {
        runId,
        delta: 'Describing every shot needs the cloud vision model, so I will check the cost first.',
      },
    },
    // The sentence first, then the card it explains; the cost in words is the card's (UX round 1).
    {
      type: 'agent.messageDelta',
      at: asked + 900,
      payload: {
        runId,
        messageId,
        delta:
          'Looking at every shot needs the cloud vision model, which costs about $0.042. Shall I go ahead?',
      },
    },
    { type: 'agent.card', at: asked + 1_000, payload: { runId, card: cost } },
    { type: 'agent.runFinished', at: asked + 1_100, payload: { runId, status: 'paused' } },
    ...declined.events,
    ...uploadConsent(id, declined.end + 1_000),
  ];
  return {
    summary: { id, title: 'Trip to Goa reel', createdAt: start, updatedAt: declined.end + 2_100 },
    history,
  };
}

/** A run that needs a file to leave this Mac: paused on the consent card. */
function uploadConsent(id: ConversationId, at: number): ChatHistoryEvent[] {
  const { runId, conversationId, messageId } = ids(id);
  return [
    user(id, 'What happens in IMG_0418?', at),
    { type: 'agent.runStarted', at: at + 200, payload: { runId, conversationId } },
    {
      type: 'agent.messageDelta',
      at: at + 600,
      payload: {
        runId,
        messageId,
        delta: 'To describe this clip I need the cloud vision model. Is that okay?',
      },
    },
    {
      type: 'agent.card',
      at: at + 700,
      payload: { runId, card: { ...CARD_FIXTURES.consent.pending!, runId, id: 'consent:trip' } },
    },
    { type: 'agent.runFinished', at: at + 1_100, payload: { runId, status: 'paused' } },
  ];
}

function diwali(): Seed {
  const id = seededId<ConversationId>(900);
  const start = Date.UTC(2026, 9, 8, 18, 5);
  const { runId, conversationId, messageId } = ids(id);
  const history: ChatHistoryEvent[] = [
    user(id, 'Index the Diwali 2025 folder and find the fireworks.', start),
    { type: 'agent.runStarted', at: start + 300, payload: { runId, conversationId } },
    {
      type: 'agent.card',
      at: start + 800,
      payload: { runId, card: { ...CARD_FIXTURES.progress.determinate! } },
    },
    {
      type: 'agent.messageDelta',
      at: start + 1_200,
      payload: {
        runId,
        messageId,
        delta: 'Indexing is under way. I could not open one of the folders, though.',
      },
    },
    { type: 'agent.card', at: start + 1_300, payload: { runId, card: { ...CARD_FIXTURES.error.withFix! } } },
    { type: 'agent.runFinished', at: start + 1_400, payload: { runId, status: 'succeeded' } },
  ];
  return { summary: { id, title: 'Diwali highlights', createdAt: start, updatedAt: start + 1_400 }, history };
}

function teaser(): Seed {
  const id = seededId<ConversationId>(901);
  const start = Date.UTC(2026, 9, 2, 11, 0);
  const { runId, conversationId, messageId } = ids(id);
  const history: ChatHistoryEvent[] = [
    user(id, 'Make a 15 second teaser for the new bottle.', start),
    { type: 'agent.runStarted', at: start + 300, payload: { runId, conversationId } },
    {
      type: 'agent.messageDelta',
      at: start + 900,
      payload: {
        runId,
        messageId,
        delta: 'I can start from your last cut. It replaces the opening shot, so I need your go-ahead.',
      },
    },
    {
      type: 'agent.card',
      at: start + 950,
      payload: { runId, card: { ...CARD_FIXTURES.approval.pending!, runId, id: 'approval:teaser' } },
    },
    { type: 'agent.runFinished', at: start + 1_000, payload: { runId, status: 'paused' } },
  ];
  return {
    summary: { id, title: 'Product teaser, 15 s', createdAt: start, updatedAt: start + 1_000 },
    history,
  };
}

/** The review page's demo (UX4): a chat whose export waits, at fixed ids, for e2e/routes.ts and the screenshots. */
export const REVIEW_CONVERSATION_ID = seededId<ConversationId>(902);
export const REVIEW_APPROVAL_ID = 'ap-review-demo';

function reviewDemo(): Seed {
  const id = REVIEW_CONVERSATION_ID;
  const start = Date.UTC(2026, 9, 11, 16, 0);
  const { runId, conversationId, messageId } = ids(id);
  const card = {
    ...CARD_FIXTURES.exportApproval.pending!,
    id: 'export:review',
    runId,
    approvalId: REVIEW_APPROVAL_ID,
    projectId: FLOW_PROJECT,
    timelineId: FLOW_TIMELINE,
    variant: undefined,
  };
  const history: ChatHistoryEvent[] = [
    user(id, 'Make a reel from the Goa trip, on the beat.', start),
    { type: 'agent.runStarted', at: start + 300, payload: { runId, conversationId } },
    {
      type: 'agent.messageDelta',
      at: start + 900,
      payload: {
        runId,
        messageId,
        delta: 'The cut is ready and the check passed. Have a look before it goes out.',
      },
    },
    { type: 'agent.card', at: start + 950, payload: { runId, card } },
    { type: 'agent.runFinished', at: start + 1_000, payload: { runId, status: 'paused' } },
  ];
  return {
    summary: { id, title: 'Goa reel, ready to export', createdAt: start, updatedAt: start + 1_000 },
    history,
    hidden: true,
  };
}

/**
 * FIX-TOOLGROUPS: a chat whose run inspected eleven clips at once (one read timed out), then looked at three frames,
 * opened from history: what e2e/routes.ts's chat-tools and the screenshots show. Hidden, like the review demo.
 */
export const TOOLS_CONVERSATION_ID = seededId<ConversationId>(903);

function toolsDemo(): Seed {
  const id = TOOLS_CONVERSATION_ID;
  const start = Date.UTC(2026, 9, 12, 10, 0);
  const run = settle(inspectClips(ids(id)), start + 1_000);
  return {
    summary: { id, title: 'Beach clips', createdAt: start, updatedAt: run.end },
    history: [user(id, INSPECT_PROMPT, start), ...run.events],
    hidden: true,
  };
}

/** Fresh copies each time, so one test's sends never leak into the next. */
export function seedConversations(): Seed[] {
  counter = 0;
  return [tripReel(), diwali(), teaser(), reviewDemo(), toolsDemo(), ...reviewSeeds(), ...workspaceSeeds()];
}
