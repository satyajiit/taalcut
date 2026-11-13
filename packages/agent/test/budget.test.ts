// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-G3 "Done when": a run that would exceed its budget pauses with an
 * estimate card and resumes on approval. Covers money (a cloud tool's
 * estimate), tokens (the next model call) and wall-clock time. BRK1-MAKE:
 * the token limit counts paid tokens only, so models on this Mac never stop
 * a run with "Spend about $0.00?".
 */
import { unwrap } from '@taalcut/core';
import type { CostEstimateCard } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { gateDemoModules } from './support/fixtures';
import { call, harness, ofType, plan, turns } from './support/harness';

const describeAt = (atSeconds: number) => ({
  toolCalls: [call('vision_describeFrame', { path: '/trip/a.mov', atSeconds })],
});
const threeFrames = turns(plan('Describe three frames'), describeAt(1), describeAt(2), describeAt(3), {
  text: 'Described the frames.',
});

/**
 * A US$0.01 cap, and the first model call priced at US$1 per million tokens: its estimate (the prompt's
 * characters / 4, SOUL.md included) stays under the cap however long SOUL.md grows, so the stop is the tool's.
 */
const MONEY = { budget: { maxUsd: 0.01 }, usdPerMillionTokens: 1 } as const;

function costCards(ui: ReturnType<typeof harness>['ui']): CostEstimateCard[] {
  return ui.flatMap((e) => (e.type === 'agent.card' && e.card.kind === 'costEstimate' ? [e.card] : []));
}

describe('money: the cost estimate before an expensive tool', () => {
  it('pauses before the call that would go over, with an estimate card, and resumes on approval', async () => {
    const h = harness({
      modules: gateDemoModules(),
      script: threeFrames,
      settings: MONEY,
    });
    const paused = unwrap(await h.agent.run({ conversationId: 'c', message: 'describe' }));
    expect(paused).toMatchObject({ status: 'paused', pending: [{ kind: 'budget' }] });
    expect(costCards(h.ui)).toEqual([
      {
        kind: 'costEstimate',
        runId: paused.runId,
        requestId: paused.pending[0]!.requestId,
        limit: 'usd',
        used: expect.closeTo(0.008, 9),
        max: 0.01,
        estimate: { usd: 0.004, tokens: 1500 },
        options: ['approve-once', 'raise-budget', 'stop'],
      },
    ]);
    let events = await h.events(paused.runId);
    expect(ofType(events, 'tool.completed').filter((e) => e.payload.usage.usd > 0)).toHaveLength(2);

    const done = unwrap(
      await h.agent.answer(paused.runId, {
        requestId: paused.pending[0]!.requestId,
        decision: 'approve',
        raiseBudgetTo: { maxUsd: 0.05 },
      }),
    );
    expect(done).toMatchObject({ status: 'completed', report: 'Described the frames.' });
    events = await h.events(paused.runId);
    expect(ofType(events, 'budget.raised')[0]?.payload.budget).toEqual({ maxUsd: 0.05 });
    expect(ofType(events, 'tool.completed').filter((e) => e.payload.usage.usd > 0)).toHaveLength(3);
  });

  it('skips the call when the user says no, and the run still reports', async () => {
    const h = harness({
      modules: gateDemoModules(),
      script: threeFrames,
      settings: MONEY,
    });
    const paused = unwrap(await h.agent.run({ conversationId: 'c', message: 'describe' }));
    const done = unwrap(
      await h.agent.answer(paused.runId, { requestId: paused.pending[0]!.requestId, decision: 'deny' }),
    );
    expect(done.status).toBe('completed');
    const failed = ofType(await h.events(paused.runId), 'tool.failed');
    expect(failed.map((e) => [e.payload.error.code, e.payload.error.detail])).toEqual([
      ['tools.denied', 'The user chose not to go over budget.'],
    ]);
  });

  it('rejects answers to unknown or already answered requests', async () => {
    const h = harness({
      modules: gateDemoModules(),
      script: threeFrames,
      settings: MONEY,
    });
    const paused = unwrap(await h.agent.run({ conversationId: 'c', message: 'describe' }));
    const unknown = await h.agent.answer(paused.runId, { requestId: 'nope', decision: 'approve' });
    expect(!unknown.ok && unknown.error.code).toBe('agent.approval_unknown');
    unwrap(await h.agent.answer(paused.runId, { requestId: paused.pending[0]!.requestId, decision: 'deny' }));
    const again = await h.agent.answer(paused.runId, {
      requestId: paused.pending[0]!.requestId,
      decision: 'approve',
    });
    expect(!again.ok && again.error.code).toBe('agent.approval_unknown');
  });
});

describe('tokens: the estimate before the next model call', () => {
  // A cloud model's turns: their tokens count against the budget (a scripted model is one on this Mac).
  const cloud = { provider: 'anthropic' } as const;
  const fourTurns = turns(
    { ...plan('Count'), ...cloud },
    { toolCalls: [call('clips_countWords', { text: 'a' })], ...cloud },
    { toolCalls: [call('clips_countWords', { text: 'b' })], ...cloud },
    { text: 'Counted.', ...cloud },
  );
  const deps = { estimator: { estimate: () => ({ tokens: 500, usd: 0 }) } };

  it('pauses before the model call, then lets one call through per "approve once"', async () => {
    const h = harness({ script: fourTurns, deps, settings: { budget: { maxTokens: 700 } } });
    const paused = unwrap(await h.agent.run({ conversationId: 'c', message: 'count' }));
    expect(paused.status).toBe('paused');
    expect(costCards(h.ui).at(-1)).toMatchObject({
      limit: 'tokens',
      used: 240,
      max: 700,
      estimate: { tokens: 500 },
    });
    expect(h.models.requests).toHaveLength(2);

    const second = unwrap(
      await h.agent.answer(paused.runId, { requestId: paused.pending[0]!.requestId, decision: 'approve' }),
    );
    expect(second.status).toBe('paused');
    expect(h.models.requests).toHaveLength(3);
    const done = unwrap(
      await h.agent.answer(paused.runId, { requestId: second.pending[0]!.requestId, decision: 'approve' }),
    );
    expect(done).toMatchObject({ status: 'completed', report: 'Counted.' });
    const overBudget = ofType(await h.events(paused.runId), 'model.requested').map(
      (e) => e.payload.overBudget ?? false,
    );
    expect(overBudget).toEqual([false, false, true, true]);
  });

  it('never stops a run for tokens a model on this Mac used (BRK1-MAKE, gate blocker 4a)', async () => {
    // The same four turns on a model that runs here: 480 tokens, over the 400 the budget allows (each turn's own
    // estimate, 300, fits; before, the second turn's stopped the run at 120 + 300).
    const small = { estimator: { estimate: () => ({ tokens: 300, usd: 0 }) } };
    const local = turns(
      plan('Count'),
      { toolCalls: [call('clips_countWords', { text: 'a' })] },
      { toolCalls: [call('clips_countWords', { text: 'b' })] },
      { text: 'Counted.' },
    );
    const h = harness({ script: local, deps: small, settings: { budget: { maxTokens: 400 } } });
    const done = unwrap(await h.agent.run({ conversationId: 'c', message: 'count' }));
    expect(done).toMatchObject({ status: 'completed', report: 'Counted.' });
    expect(costCards(h.ui)).toEqual([]);
    const events = await h.events(done.runId);
    expect(ofType(events, 'model.responded').every((e) => e.payload.local)).toBe(true);
    expect(ofType(events, 'approval.requested')).toEqual([]);
  });

  it("under Local only, not even the first turn's estimate counts against the budget", async () => {
    // The estimate (500 tokens) alone is over the 400 allowed, but every turn of a Local only run runs here.
    const onDevice = turns(
      plan('Count'),
      { toolCalls: [call('clips_countWords', { text: 'a' })] },
      { text: 'Counted.' },
    );
    const h = harness({ script: onDevice, deps, settings: { budget: { maxTokens: 400 } } });
    const done = unwrap(await h.agent.run({ conversationId: 'c', message: 'count', localOnly: true }));
    expect(done).toMatchObject({ status: 'completed', report: 'Counted.' });
    expect(costCards(h.ui)).toEqual([]);
  });

  it('stops the run when the user says no to the model call', async () => {
    const h = harness({ script: fourTurns, deps, settings: { budget: { maxTokens: 700 } } });
    const paused = unwrap(await h.agent.run({ conversationId: 'c', message: 'count' }));
    const stopped = unwrap(
      await h.agent.answer(paused.runId, { requestId: paused.pending[0]!.requestId, decision: 'deny' }),
    );
    expect(stopped.status).toBe('cancelled');
  });
});

describe('wall clock', () => {
  it('counts active time only, pauses at the limit and continues with more time on approval', async () => {
    let now = 1_000_000;
    // A cloud model billed per token: the wall clock counts once a run spends (FIX-RUN; budget-plan.test.ts).
    const cloud = { provider: 'anthropic' } as const;
    const h = harness({
      now: () => now,
      script: (request, turn) => {
        now += 400;
        return turns(
          { ...plan('Count'), ...cloud },
          { toolCalls: [call('clips_countWords', { text: 'a' })], ...cloud },
          { toolCalls: [call('clips_countWords', { text: 'b' })], ...cloud },
          { text: 'Counted.', ...cloud },
        )(request, turn);
      },
      settings: { budget: { maxWallClockMs: 1_000 } },
    });
    const paused = unwrap(await h.agent.run({ conversationId: 'c', message: 'count' }));
    expect(paused.status).toBe('paused');
    expect(costCards(h.ui).at(-1)).toMatchObject({ limit: 'wallClock', max: 1_000 });

    now += 3_600_000; // An hour passes while the card waits.
    const done = unwrap(
      await h.agent.answer(paused.runId, { requestId: paused.pending[0]!.requestId, decision: 'approve' }),
    );
    expect(done.status).toBe('completed');
    const events = await h.events(paused.runId);
    const raised = ofType(events, 'budget.raised')[0]?.payload.budget.maxWallClockMs ?? 0;
    expect(raised).toBeGreaterThan(1_000);
    expect(raised).toBeLessThan(5_000);
  });
});
