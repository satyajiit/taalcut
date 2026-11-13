// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { newId, type ConversationId, type RunId, type ChatEvent } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { gateDemo, settle } from '../src/chat/fake-script';
import {
  applyEvent,
  EMPTY_TRANSCRIPT,
  finishRun,
  replay,
  runEnded,
  type TranscriptItem,
} from '../src/chat/transcript';

// Card payloads are validated (parseCard), so ids must be real ULIDs.
const RUN = newId<'AgentRun'>();
const ids = () => ({
  runId: RUN,
  conversationId: newId<'Conversation'>(),
  messageId: newId<'Message'>(),
  toolRunId: () => newId<'ToolRun'>(),
});

const cards = (items: readonly TranscriptItem[]) =>
  items.flatMap((item) => (item.kind === 'card' ? [item.card] : []));

describe('transcript', () => {
  it('folds the gate demo into reasoning, a plan, three tool runs and one answer', () => {
    const { events } = settle(gateDemo(ids()), 1_000);
    const transcript = replay(events);
    expect(transcript.runs[RUN]).toBe('succeeded');
    expect(transcript.activeRunId).toBeNull();
    expect(transcript.items.map((item) => item.kind)).toEqual([
      'reasoning',
      'card',
      'card',
      'card',
      'card',
      'agent',
    ]);

    const reasoning = transcript.items[0];
    expect(
      reasoning?.kind === 'reasoning' && !reasoning.working && reasoning.text.startsWith('You want'),
    ).toBe(true);

    const [plan, ...tools] = cards(transcript.items);
    expect(plan?.type === 'plan' && plan.steps.map((step) => step.status)).toEqual(['done', 'done', 'done']);
    expect(
      tools.map((card) => card.type === 'toolRun' && [card.tool, card.status, Boolean(card.summary)]),
    ).toEqual([
      ['library.addSource', 'succeeded', true],
      ['media.probe', 'succeeded', true],
      ['vision.describeFrame', 'succeeded', true],
    ]);

    const answer = transcript.items.at(-1);
    expect(answer?.kind === 'agent' && !answer.streaming && answer.text.includes('beach at sunset')).toBe(
      true,
    );
  });

  it('keeps the thinking level the chat last sent with, through later runs that pick none', () => {
    const conversationId = newId<'Conversation'>();
    const second = newId<'AgentRun'>();
    const third = newId<'AgentRun'>();
    const started = (
      runId: RunId,
      at: number,
      picked: { reasoning?: 'xhigh'; effort?: 'deep' } = {},
    ): ChatEvent => ({
      type: 'agent.runStarted',
      at,
      payload: { runId, conversationId, ...picked },
    });
    const finished = (runId: RunId, at: number): ChatEvent => ({
      type: 'agent.runFinished',
      at,
      payload: { runId, status: 'succeeded' },
    });
    expect(replay([started(RUN, 1)]).reasoning).toBeUndefined();
    const transcript = replay([
      started(RUN, 1, { reasoning: 'xhigh' }),
      finished(RUN, 2),
      started(second, 3),
      finished(second, 4),
    ]);
    expect(transcript.reasoning).toBe('xhigh');
    // A run from before UX3-AGT kept only the effort it asked for: Deep was high.
    expect(replay([started(third, 5, { effort: 'deep' })]).reasoning).toBe('high');
  });

  it('settles everything still moving when a run is cancelled', () => {
    const { events } = settle(gateDemo(ids()), 1_000);
    // Stop while the second tool runs.
    const cut = events.findIndex(
      (event) => event.type === 'agent.toolStarted' && event.payload.tool === 'media.probe',
    );
    const partial = replay(events.slice(0, cut + 1));
    expect(partial.activeRunId).toBe(RUN);

    const stopped = applyEvent(partial, {
      type: 'agent.runFinished',
      at: 9_999,
      payload: { runId: RUN, status: 'cancelled' },
    });
    expect(stopped.activeRunId).toBeNull();
    expect(stopped.runs[RUN]).toBe('cancelled');
    const [plan, added, probe] = cards(stopped.items);
    expect(plan?.type === 'plan' && plan.steps.map((step) => step.status)).toEqual([
      'done',
      'skipped',
      'skipped',
    ]);
    expect(added?.type === 'toolRun' && added.status).toBe('succeeded');
    expect(probe?.type === 'toolRun' && probe.status).toBe('cancelled');
    expect(stopped.items.at(-1)).toMatchObject({ kind: 'notice', notice: 'cancelled' });

    // A late duplicate finish changes nothing.
    expect(
      applyEvent(stopped, {
        type: 'agent.runFinished',
        at: 10_000,
        payload: { runId: RUN, status: 'succeeded' },
      }),
    ).toBe(stopped);
  });

  it('updates a card in place when the same id arrives again, and shows a fallback for unknown versions', () => {
    const runId = RUN;
    const card = {
      type: 'approval',
      id: 'ap',
      version: 1,
      runId,
      approvalId: 'ap',
      tool: 'render.start',
      sideEffect: 'external',
      summary: 'Upload it',
      status: 'pending',
    } as const;
    const first = applyEvent(EMPTY_TRANSCRIPT, { type: 'agent.card', at: 1, payload: { runId, card } });
    const second = applyEvent(first, {
      type: 'agent.card',
      at: 2,
      payload: { runId, card: { ...card, status: 'approved' } },
    });
    expect(second.items).toHaveLength(1);
    expect(cards(second.items)[0]).toMatchObject({ status: 'approved' });

    const future = { type: 'agent.card', at: 3, payload: { runId, card: { ...card, id: 'v2', version: 2 } } };
    const withUnknown = applyEvent(second, future as unknown as ChatEvent);
    expect(withUnknown.items.at(-1)).toMatchObject({ kind: 'unsupported' });
  });

  it('turns a failed run with an error into an error card, and synthesizes one if error is missing', () => {
    const runId = newId<'AgentRun'>() as RunId;
    const started = applyEvent(EMPTY_TRANSCRIPT, {
      type: 'agent.runStarted',
      at: 1,
      payload: { runId, conversationId: newId<'Conversation'>() as ConversationId },
    });
    const failed = applyEvent(started, {
      type: 'agent.runFinished',
      at: 2,
      payload: {
        runId,
        status: 'failed',
        error: { code: 'core.timeout', messageKey: 'errors.core.timeout', retryable: true },
      },
    });
    expect(cards(failed.items)[0]).toMatchObject({ type: 'error', error: { code: 'core.timeout' } });

    const silentFailed = applyEvent(started, {
      type: 'agent.runFinished',
      at: 3,
      payload: {
        runId,
        status: 'failed',
      },
    });
    expect(cards(silentFailed.items)[0]).toMatchObject({
      type: 'error',
      error: { code: 'agent.run_failed', retryable: true },
    });
  });

  describe('a run that waits for an answer', () => {
    const runId = newId<'AgentRun'>();
    const conversationId = newId<'Conversation'>() as ConversationId;
    const paused = replay([
      { type: 'agent.runStarted', at: 1, payload: { runId, conversationId } },
      {
        type: 'agent.approvalRequested',
        at: 2,
        payload: {
          runId,
          approvalId: 'ap',
          tool: 'timeline.replace',
          sideEffect: 'write',
          reason: 'Swap it',
        },
      },
      { type: 'agent.runFinished', at: 3, payload: { runId, status: 'paused' } },
    ]);
    const notices = (items: readonly TranscriptItem[]) =>
      items.flatMap((item) => (item.kind === 'notice' ? [item.notice] : []));

    it('waits with its question open', () => {
      expect(paused.runs[runId]).toBe('paused');
      expect(cards(paused.items)[0]).toMatchObject({ type: 'approval', status: 'pending' });
      expect(notices(paused.items)).toEqual(['paused']);
    });

    it('stopped by id: the question expires and "waiting" becomes "stopped" in place', () => {
      const stopped = finishRun(paused, runId, 'cancelled', 4);
      expect(stopped.runs[runId]).toBe('cancelled');
      expect(cards(stopped.items)[0]).toMatchObject({ type: 'approval', status: 'expired' });
      expect(stopped.items.map((item) => item.kind)).toEqual(['card', 'notice']);
      expect(notices(stopped.items)).toEqual(['cancelled']);
      // Replayed from history (the agent stores the cancel), it looks the same.
      const replayed = applyEvent(paused, {
        type: 'agent.runFinished',
        at: 4,
        payload: { runId, status: 'cancelled' },
      });
      expect(replayed.items).toEqual(stopped.items);
    });

    it('an answer refused because it had ended says so calmly, with or without its status', () => {
      const known = runEnded(paused, runId, 'succeeded', 4);
      expect(known.runs[runId]).toBe('succeeded');
      expect(notices(known.items)).toEqual(['ended']);
      expect(cards(known.items)[0]).toMatchObject({ status: 'expired' });
      const unknown = runEnded(paused, runId, null, 4);
      expect(notices(unknown.items)).toEqual(['ended']);
      expect(cards(unknown.items)[0]).toMatchObject({ status: 'expired' });
    });
  });

  it.each(['failed', 'cancelled'] as const)(
    'settles a running or updating step card to failed and clears its progress when %s',
    (status) => {
      const runId = newId<'AgentRun'>();
      const flowId = newId<'Flow'>();
      const conversationId = newId<'Conversation'>();
      const stepCard = (stepStatus: 'running' | 'updating' | 'ready', id: string) => ({
        type: 'step' as const,
        id,
        version: 1 as const,
        runId,
        step: {
          flowId,
          stepId: id,
          skill: 'agent.brief',
          index: 1,
          count: 5,
          status: stepStatus,
          editedByYou: false,
        },
        labelKey: 'skills.agent.brief',
        progress: stepStatus === 'ready' ? null : { fraction: null },
        refs: [],
      });

      const live = replay([
        { type: 'agent.runStarted', at: 1, payload: { runId, conversationId } },
        { type: 'agent.card', at: 2, payload: { runId, card: stepCard('ready', 'step-done') } },
        { type: 'agent.card', at: 3, payload: { runId, card: stepCard('running', 'step-running') } },
        { type: 'agent.card', at: 4, payload: { runId, card: stepCard('updating', 'step-updating') } },
      ]);

      const settled = applyEvent(live, {
        type: 'agent.runFinished',
        at: 5,
        payload: {
          runId,
          status,
          ...(status === 'failed'
            ? {
                error: {
                  code: 'agent.turn_limit',
                  messageKey: 'errors.agent.turn_limit',
                  retryable: false,
                  params: { limit: 25 },
                },
              }
            : {}),
        },
      });

      const stepCards = cards(settled.items).filter((card) => card.type === 'step');
      expect(stepCards.map((card) => [card.id, card.step.status, card.progress])).toEqual([
        ['step-done', 'ready', null],
        ['step-running', 'failed', null],
        ['step-updating', 'failed', null],
      ]);
    },
  );
});
