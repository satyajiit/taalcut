// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stored conversation replays as the renderer's history events
 * (apps/renderer/src/chat/client.ts, ChatHistoryEvent): what the transcript
 * reducer folds into the same transcript a live run produced.
 */
import { unwrap, type ConversationId, type MessageId, type RunId, type ToolRunId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createLibraryPorts,
  createRepositories,
  toChatHistory,
  type ConversationHistory,
} from '../src/index';
import { fakeClock, openTestDb } from './helpers';

const conversationId = 'conv' as ConversationId;
const r1 = 'r1' as RunId;
const r2 = 'r2' as RunId;
const plan = {
  type: 'plan',
  id: 'plan:r1',
  version: 1,
  runId: r1,
  steps: [{ id: 's', text: 'Cut', status: 'done' }],
};

function stored(overrides: Partial<ConversationHistory> = {}): ConversationHistory {
  const message = (
    id: string,
    role: 'user' | 'assistant' | 'system',
    at: number,
    runId: RunId | null,
    parts: object[],
  ) => ({
    id: id as MessageId,
    role,
    parts: parts as never,
    runId,
    createdAt: at,
  });
  return {
    conversation: {
      id: conversationId,
      projectId: null,
      title: '',
      preview: '',
      createdAt: 0,
      updatedAt: 0,
      archived: false,
    },
    messages: [
      message('m1', 'user', 10, r1, [{ type: 'text', text: 'Make a reel' }]),
      message('m0', 'system', 11, null, [{ type: 'text', text: 'hidden' }]),
      message('m2', 'assistant', 40, r1, [
        { type: 'text', text: 'Done: ' },
        { type: 'card', cardId: 'result' },
      ]),
      message('m3', 'user', 50, r2, [{ type: 'text', text: 'Again' }]),
      message('m4', 'assistant', 60, r2, [{ type: 'text', text: 'Working…' }]),
      message('m5', 'assistant', 70, null, [{ type: 'text', text: 'Note without a run' }]),
    ],
    cards: [
      { cardId: 'plan:r1', runId: r1, card: plan, createdAt: 15, updatedAt: 35 },
      {
        cardId: 'result',
        runId: r1,
        card: { type: 'future', id: 'result', version: 9 },
        createdAt: 39,
        updatedAt: 39,
      },
    ],
    toolRuns: [
      {
        id: 'tool-1' as ToolRunId,
        runId: r1,
        messageId: null,
        tool: 'media.probe',
        sideEffect: 'read',
        status: 'failed',
        startedAt: 20,
        finishedAt: 32,
        error: { code: 'media.probe_failed', messageKey: 'errors.media.probe_failed', retryable: false },
      },
      {
        id: 'tool-x' as ToolRunId,
        runId: null,
        messageId: null,
        tool: 'x',
        sideEffect: null,
        status: 'running',
        startedAt: 21,
        finishedAt: null,
        error: null,
      },
    ],
    runs: [
      { runId: r1, conversationId, status: 'succeeded', lastSeq: 5, startedAt: 10, updatedAt: 45 },
      { runId: r2, conversationId, status: 'running', lastSeq: 2, startedAt: 50, updatedAt: 60 },
    ],
    ...overrides,
  };
}

describe('toChatHistory', () => {
  it('replays messages, tool runs, cards and run boundaries in order', () => {
    const events = toChatHistory(stored());
    expect(events.map((e) => [e.type, e.at])).toEqual([
      ['user.message', 10],
      ['agent.runStarted', 15],
      ['agent.card', 15], // the plan: no message refers to it, so it appears when it was created
      ['agent.toolStarted', 20],
      ['agent.toolFinished', 32],
      ['agent.messageDelta', 40],
      ['agent.card', 40],
      ['agent.runFinished', 45],
      ['user.message', 50],
      ['agent.runStarted', 60],
      ['agent.messageDelta', 60], // r2 is still running: no finish
      ['agent.runStarted', 70],
      ['agent.messageDelta', 70],
      ['agent.runFinished', 70],
    ]);
    expect(events[0]).toEqual({
      type: 'user.message',
      at: 10,
      payload: { messageId: 'm1', conversationId, text: 'Make a reel' },
    });
    expect(events[4]).toMatchObject({
      payload: {
        toolRunId: 'tool-1',
        status: 'failed',
        durationMs: 12,
        error: { code: 'media.probe_failed' },
      },
    });
    expect(events[2]).toMatchObject({ payload: { runId: r1, card: plan } });
    // A card the renderer can't parse still travels; it shows as "unsupported" there.
    expect(events[6]).toMatchObject({ payload: { card: { type: 'future', version: 9 } } });
    expect(events[11]).toMatchObject({ payload: { runId: 'm5', conversationId } });
  });

  it('marks paused runs and leaves out tool runs and system messages without a run', () => {
    const history = stored({
      runs: [{ runId: r1, conversationId, status: 'paused', lastSeq: 5, startedAt: 10, updatedAt: 45 }],
    });
    const events = toChatHistory(history);
    expect(events.filter((e) => e.type === 'agent.runFinished').map((e) => e.payload)).toEqual([
      { runId: r1, status: 'paused' },
      { runId: r2, status: 'succeeded' }, // no summary stored: treated as finished
      { runId: 'm5', status: 'succeeded' },
    ]);
    expect(events.some((e) => e.type === 'agent.toolStarted' && e.payload.toolRunId === 'tool-x')).toBe(
      false,
    );
    expect(JSON.stringify(events)).not.toContain('hidden');
  });

  it('comes back from the store as `history` next to the stored parts', async () => {
    const clock = fakeClock();
    const db = openTestDb({ file: false, clock: clock.now });
    const { conversations } = createLibraryPorts(db);
    const repos = createRepositories(db);
    unwrap(
      await conversations.appendMessage({
        conversationId,
        role: 'user',
        parts: [{ type: 'text', text: 'hi' }],
        runId: r1,
      }),
    );
    unwrap(await conversations.linkRun(conversationId, r1));
    clock.advance(5);
    const tool = unwrap(
      repos.toolRuns.start({
        toolName: 'media.probe',
        toolVersion: '1',
        runId: r1,
        conversationId,
        input: {},
        sideEffect: 'read',
      }),
    );
    clock.advance(5);
    unwrap(repos.toolRuns.finish(tool.id, { status: 'succeeded', output: {} }));
    unwrap(
      await conversations.appendMessage({
        conversationId,
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hello' }],
        runId: r1,
      }),
    );
    unwrap(repos.runLog.append(r1, [], { expectedSeq: 0, status: 'succeeded' }));
    const record = unwrap(await conversations.get(conversationId));
    expect(record.history.map((e) => e.type)).toEqual([
      'user.message',
      'agent.runStarted',
      'agent.toolStarted',
      'agent.toolFinished',
      'agent.messageDelta',
      'agent.runFinished',
    ]);
    expect(record.toolRuns).toMatchObject([
      { id: tool.id, tool: 'media.probe', sideEffect: 'read', status: 'succeeded' },
    ]);
  });
});
