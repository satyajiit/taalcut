// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { newId } from '@taalcut/core';
import { CARD_FIXTURES } from '@taalcut/ui';
import { describe, expect, it } from 'vitest';
import { gateDemo, settle } from '../src/chat/fake-script';
import { hasLiveActivity, isTalking, latestRun } from '../src/chat/run-mood';
import { EMPTY_TRANSCRIPT, finishRun, replay, type TranscriptItem } from '../src/chat/transcript';

const ids = (runId = newId<'AgentRun'>()) => ({
  runId,
  conversationId: newId<'Conversation'>(),
  messageId: newId<'Message'>(),
  toolRunId: () => newId<'ToolRun'>(),
});

describe('Kaatu and the chat (run-mood)', () => {
  it('has no run in a new chat', () => {
    expect(latestRun(EMPTY_TRANSCRIPT)).toBeNull();
    expect(isTalking([])).toBe(false);
  });

  it('follows the newest run from start to finish', () => {
    const first = newId<'AgentRun'>();
    const { events } = settle(gateDemo(ids(first)), 1_000);
    const done = replay(events);
    expect(latestRun(done)).toEqual({ id: first, phase: 'succeeded' });

    const second = newId<'AgentRun'>();
    const going = replay(settle(gateDemo(ids(second)), 1_000).events.slice(0, 2), done);
    expect(latestRun(going)).toEqual({ id: second, phase: 'running' });

    const failed = finishRun(going, second, 'failed', Date.now());
    expect(latestRun(failed)).toEqual({ id: second, phase: 'failed' });
  });

  it('suppresses a duplicate working label only for the current run’s visible activity', () => {
    const runId = newId<'AgentRun'>();
    const { events } = settle(gateDemo(ids(runId)), 1_000);
    const transcript = replay(events);
    expect(hasLiveActivity(transcript)).toBe(false);
    expect(hasLiveActivity({ ...transcript, runs: { [runId]: 'running' } })).toBe(true);
    const next = newId<'AgentRun'>();
    expect(hasLiveActivity({ ...transcript, runs: { ...transcript.runs, [next]: 'running' } })).toBe(false);
    const cost = CARD_FIXTURES.costEstimate.goingAhead!;
    expect(
      hasLiveActivity({
        ...EMPTY_TRANSCRIPT,
        runs: { [runId]: 'running' },
        items: [{ kind: 'card', key: cost.id, card: { ...cost, runId } }],
      }),
    ).toBe(true);
  });

  it('knows when the run is already visibly talking or thinking', () => {
    const run = newId<'AgentRun'>();
    const answer: TranscriptItem = {
      kind: 'agent',
      key: 'a',
      runId: run,
      text: 'Hi',
      streaming: true,
      at: 1,
    };
    const thinking: TranscriptItem = {
      kind: 'reasoning',
      key: 'r',
      runId: run,
      text: 'Looking',
      working: true,
      startedAt: 1,
    };
    expect(isTalking([answer])).toBe(true);
    expect(isTalking([thinking])).toBe(true);
    expect(isTalking([{ ...answer, streaming: false }])).toBe(false);
    expect(isTalking([answer, { kind: 'user', key: 'u', text: 'Go', at: 2 }])).toBe(false);
  });
});
