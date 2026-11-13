// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-M3 (SPEC sections 11 and 18): the Librarian asks only how many
 * variants, and only once; not when the message gave the number, not at
 * autopilot. The answer goes through chat.decideApproval; its reranks stay
 * within 1.3 × the step's estimate; the cast board lists one timeline per
 * variant and each variant gets its own export card.
 */
import { newId, ok, unwrap, type Card } from '@taalcut/core';
import {
  costAccuracy,
  createChatService,
  createMemoryConversationStore,
  type ChatEvent,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { flowHarness } from './support/flow-harness';
import { flowScript } from './support/flow-script';
import { createWorld } from './support/flow-world';
import { ofType } from './support/harness';

const reference = { kind: 'link' as const, url: 'https://www.instagram.com/reel/xyz/' };

async function collect(events: AsyncIterable<ChatEvent>) {
  const seen: ChatEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}
const cardsOf = (events: readonly ChatEvent[]): Card[] =>
  events.flatMap((e) => (e.type === 'agent.card' ? [e.payload.card] : []));

describe('the Librarian asks only how many variants', () => {
  it('asks once on the cast board, takes the answer from chat.decideApproval and casts that many', async () => {
    const world = createWorld();
    const h = flowHarness({
      world,
      script: flowScript(),
      deps: { projects: { forConversation: async () => ok(world.projectId) } },
    });
    const chat = createChatService({ agent: h.agent, conversations: createMemoryConversationStore() });
    const conversationId = newId<'Conversation'>();
    const signal = new AbortController().signal;
    const sent = unwrap(
      await chat.send(
        { conversationId, text: 'Copy this reel', start: { path: 'reference', reference } },
        { signal },
      ),
    );
    const first = await collect(sent.events);
    const asking = cardsOf(first).find((c) => c.type === 'castBoard');
    expect(asking).toMatchObject({ asking: { suggested: 2, slotCount: 4 }, projectId: world.projectId });
    expect(first.at(-1)).toMatchObject({ type: 'agent.runFinished', payload: { status: 'paused' } });
    // The question is the card itself: no separate approval card.
    expect(cardsOf(first).some((c) => c.type === 'approval')).toBe(false);
    const approvalId = asking?.type === 'castBoard' ? asking.asking!.approvalId : '';

    const followed = collect(chat.follow(sent.runId, { signal }));
    unwrap(
      await chat.decideApproval({
        runId: sent.runId,
        approvalId,
        decision: 'approve',
        answer: { kind: 'variants', count: 3 },
      }),
    );
    const second = await followed;
    expect(h.world.calls).toContain('timeline.cast:3');
    const events = await h.events(sent.runId);
    expect(ofType(events, 'approval.granted')[0]?.payload.answer).toEqual({ kind: 'variants', count: 3 });
    expect(ofType(events, 'approval.requested').filter((e) => e.payload.kind === 'question')).toHaveLength(1);
    // The cast board under the same id, now with one timeline per variant.
    const board = cardsOf(second)
      .filter((c) => c.type === 'castBoard')
      .at(-1);
    expect(board).toMatchObject({ id: asking!.id });
    expect(board?.type === 'castBoard' && board.timelineIds).toHaveLength(3);
    // Each variant is edited, reviewed and gets its own export card; the first one waits.
    expect(
      ofType(events, 'skill.entered')
        .map((e) => e.payload.skill)
        .filter((s) => s === 'timeline.editor'),
    ).toHaveLength(1);
    expect(
      cardsOf(second)
        .filter((c) => c.type === 'exportApproval')
        .map((c) => c.id.split(':').at(-1)),
    ).toEqual(['1']);
    const plan = ofType(events, 'plan.updated').flatMap((e) =>
      e.payload.steps.map((s) => `${s.flow?.key}:${s.flow?.variant}`),
    );
    expect(plan).toEqual(['editor:2', 'reviewer:2', 'export:2', 'editor:3', 'reviewer:3', 'export:3']);
    chat.close();
  });

  it('does not ask when the message gave the number, nor at autopilot', async () => {
    const said = flowHarness({ script: flowScript() });
    const run = unwrap(
      await said.agent.run({
        conversationId: 'c',
        projectId: said.world.projectId,
        message: 'Make 3 versions of this',
        start: { path: 'reference', reference },
      }),
    );
    expect(run.pending.map((p) => p.kind)).toEqual(['tool']);
    expect(said.world.calls).toContain('timeline.cast:3');

    const auto = flowHarness({ script: flowScript({ ask: true }), settings: { autonomy: 'autopilot' } });
    const done = unwrap(
      await auto.agent.run({
        conversationId: 'c',
        projectId: auto.world.projectId,
        message: 'Copy it',
        start: { path: 'reference', reference },
      }),
    );
    expect(done.status).toBe('completed');
    const events = await auto.events(done.runId);
    const asked = ofType(events, 'tool.completed').find(
      (e) => e.payload.output.kind === 'inline' && String(e.payload.output.value).startsWith('Autopilot'),
    );
    expect(asked?.payload.output).toEqual({ kind: 'inline', value: 'Autopilot: go with 2.' });
    expect(ofType(events, 'approval.requested')).toHaveLength(0);
  });

  it("keeps vision reranks within 1.3 × the step's estimate, and an over-run is an outlier", async () => {
    const run = async (rerankUsd: number) => {
      const h = flowHarness({
        world: createWorld({ rerankUsd }),
        script: flowScript({ ask: false, rerank: 5 }),
        skills: { rerankEstimateUsd: 0.05 },
        settings: { autonomy: 'autopilot' },
      });
      const outcome = unwrap(
        await h.agent.run({
          conversationId: 'c',
          projectId: h.world.projectId,
          message: 'Copy',
          start: { path: 'reference', reference },
        }),
      );
      expect(outcome.status).toBe('completed');
      return h.events(outcome.runId);
    };
    const fine = await run(0.055);
    const recorded = ofType(fine, 'estimate.recorded').find((e) => e.payload.skill === 'timeline.librarian');
    expect(recorded?.payload).toMatchObject({
      labelKey: 'skills.timeline.librarian',
      estimate: { usd: 0.05 },
    });
    const settled = ofType(fine, 'estimate.settled').find(
      (e) => e.payload.estimateId === recorded?.payload.estimateId,
    );
    expect(settled?.payload.actual.usd).toBeCloseTo(0.055, 6);
    expect(settled!.payload.actual.usd).toBeLessThanOrEqual(1.3 * recorded!.payload.estimate.usd);
    expect(costAccuracy([fine]).passed).toBe(true);

    const over = costAccuracy([await run(0.09)]);
    expect(over.passed).toBe(false);
    expect(over.outliers).toMatchObject([
      { skill: 'timeline.librarian', estimateUsd: 0.05, actualUsd: 0.09 },
    ]);
  });
});
