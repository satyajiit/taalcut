// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X1 (SPEC sections 14 and 18): the project cap. A paid step that would
 * go over it pauses with the budgetCap card: raise the cap, use a cheaper
 * model, or stop ("Stopped at your budget"). Approving without changing
 * either asks again. Every estimate is settled with what the step cost.
 */
import { newId, ok, unwrap, type ProjectId } from '@taalcut/core';
import {
  createChatService,
  createMemoryConversationStore,
  STOPPED_AT_BUDGET,
  type AgentEvent,
  type ChatEvent,
} from '@taalcut/agent';
import type { ModulePrice, PriceLookup } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { flowHarness } from './support/flow-harness';
import { flowScript } from './support/flow-script';
import { createWorld } from './support/flow-world';
import { ofType } from './support/harness';
import { fakeBudgetStore, usd } from './support/ports';

const big: Omit<ModulePrice, 'module'> = {
  provider: 'cloudco',
  model: 'big',
  local: false,
  usdPerMTok: { input: 30, output: 150, cacheRead: 3 },
};
const small: Omit<ModulePrice, 'module'> = {
  provider: 'cloudco',
  model: 'small',
  local: false,
  usdPerMTok: { input: 0.1, output: 0.4, cacheRead: 0.01 },
};
const onMac: Omit<ModulePrice, 'module'> = {
  provider: 'local',
  model: 'qwen3',
  local: true,
  usdPerMTok: { input: 0, output: 0, cacheRead: 0 },
};

/** Prices whose current model the test switches, as models.setModuleChoice would. */
function prices(): PriceLookup & { use(p: Omit<ModulePrice, 'module'>): void } {
  let current = big;
  return {
    use: (p) => void (current = p),
    price: (module) => ({ module, ...current }),
    options: (module) => [onMac, small, big].map((p) => ({ module, ...p })),
  };
}

function setup(cap: number, spent = 0) {
  const world = createWorld();
  const budgets = fakeBudgetStore({ [world.projectId]: { cap: usd(cap), spent: usd(spent) } });
  const lookup = prices();
  const h = flowHarness({
    world,
    budgets,
    script: flowScript({ ask: false }),
    deps: { prices: lookup, projects: { forConversation: async () => ok(world.projectId) } },
  });
  const start = () =>
    h.agent.start({
      conversationId: 'c',
      projectId: world.projectId,
      message: 'Copy it',
      start: { path: 'reference', reference: { kind: 'link', url: 'https://www.instagram.com/reel/q/' } },
    });
  return { h, world, budgets, lookup, start };
}

const capStops = (events: readonly AgentEvent[]) =>
  ofType(events, 'approval.requested').filter(
    (e) => e.payload.kind === 'budget' && e.payload.limit === 'projectCap',
  );

describe('the project cap', () => {
  it('pauses before the step that would go over, offering this Mac first, then asks again until the cap is raised', async () => {
    const s = setup(0.05, 0.049);
    const runId = unwrap(await s.start());
    const paused = unwrap(await s.h.agent.wait(runId));
    expect(paused).toMatchObject({ status: 'paused', pending: [{ kind: 'budget' }] });
    let events = await s.h.events(runId);
    const stop = capStops(events)[0]!.payload;
    expect(stop).toMatchObject({
      toolCallIds: [],
      used: 0.049,
      max: 0.05,
      projectId: s.world.projectId,
      labelKey: 'skills.templates.analyst',
    });
    expect(stop.cheaper?.map((c) => [c.model, c.local])).toEqual([['qwen3', true]]);
    expect(ofType(events, 'skill.entered')).toHaveLength(0);

    // Approving without raising the cap: the same step asks again.
    const again = unwrap(await s.h.agent.answer(runId, { requestId: stop.requestId, decision: 'approve' }));
    expect(again).toMatchObject({ status: 'paused', pending: [{ kind: 'budget' }] });
    events = await s.h.events(runId);
    expect(capStops(events)).toHaveLength(2);

    // Raised on the card (budget.setProjectCap), then approved: the run goes on.
    unwrap(await s.budgets.setCap(s.world.projectId as ProjectId, usd(5), undefined as never));
    const next = unwrap(
      await s.h.agent.answer(runId, { requestId: again.pending[0]!.requestId, decision: 'approve' }),
    );
    expect(next).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
    events = await s.h.events(runId);
    const recorded = ofType(events, 'estimate.recorded');
    expect(recorded.map((e) => e.payload.skill)).toEqual([
      'templates.analyst',
      'timeline.librarian',
      'timeline.editor',
      'render.reviewer',
    ]);
    expect(recorded[0]?.payload.cap).toEqual({ usd: 5, spentUsd: 0.049 });
    expect(recorded[0]?.payload.lines).toMatchObject([
      { module: 'agent', provider: 'cloudco', model: 'big', local: false },
    ]);
    // Each estimate is settled with what its step cost.
    expect(ofType(events, 'estimate.settled').map((e) => e.payload.estimateId)).toEqual(
      recorded.map((e) => e.payload.estimateId),
    );
  });

  it('a cheaper model goes ahead with no cost, and stopping ends the run "Stopped at your budget"', async () => {
    const cheaper = setup(0.05, 0.049);
    const runId = unwrap(await cheaper.start());
    const paused = unwrap(await cheaper.h.agent.wait(runId));
    cheaper.lookup.use(onMac); // The user picked "Use Qwen3 on this Mac".
    const on = unwrap(
      await cheaper.h.agent.answer(runId, { requestId: paused.pending[0]!.requestId, decision: 'approve' }),
    );
    expect(on.pending.map((p) => p.kind)).toEqual(['tool']);
    expect(ofType(await cheaper.h.events(runId), 'estimate.recorded')).toHaveLength(0);

    const stopped = setup(0.05, 0.049);
    const stopRun = unwrap(await stopped.start());
    const asked = unwrap(await stopped.h.agent.wait(stopRun));
    const done = unwrap(
      await stopped.h.agent.answer(stopRun, { requestId: asked.pending[0]!.requestId, decision: 'deny' }),
    );
    expect(done).toMatchObject({ status: 'cancelled', report: STOPPED_AT_BUDGET, pending: [] });
    const events = await stopped.h.events(stopRun);
    expect(ofType(events, 'run.cancelled')[0]?.payload).toEqual({ reason: 'budget' });
  });

  it('shows the stop as a budgetCap card and the costs as v2 estimate cards in chat', async () => {
    const s = setup(0.05, 0.049);
    const chat = createChatService({
      agent: s.h.agent,
      conversations: createMemoryConversationStore(),
    });
    const signal = new AbortController().signal;
    const conversationId = newId<'Conversation'>();
    const sent = unwrap(
      await chat.send(
        {
          conversationId,
          text: 'Copy it',
          start: { path: 'reference', reference: { kind: 'link', url: 'https://www.instagram.com/reel/q/' } },
        },
        { signal },
      ),
    );
    const seen: ChatEvent[] = [];
    for await (const e of sent.events) seen.push(e);
    const capCard = seen.flatMap((e) =>
      e.type === 'agent.card' && e.payload.card.type === 'budgetCap' ? [e.payload.card] : [],
    );
    expect(capCard).toMatchObject([
      {
        status: 'pending',
        cap: usd(0.05),
        spent: usd(0.049),
        next: { labelKey: 'skills.templates.analyst' },
        cheaper: [{ model: 'qwen3', local: true, estimate: usd(0) }],
      },
    ]);
    expect(seen.find((e) => e.type === 'agent.budgetExceeded')).toBeDefined();
    unwrap(await s.budgets.setCap(s.world.projectId as ProjectId, usd(5), undefined as never));
    const followed: ChatEvent[] = [];
    const following = (async () => {
      for await (const e of chat.follow(sent.runId, { signal })) followed.push(e);
    })();
    unwrap(
      await chat.decideApproval({
        runId: sent.runId,
        approvalId: capCard[0]!.approvalId,
        decision: 'approve',
      }),
    );
    await following;
    const costs = followed.flatMap((e) =>
      e.type === 'agent.card' && e.payload.card.type === 'costEstimate' ? [e.payload.card] : [],
    );
    expect(costs.length).toBeGreaterThan(0);
    expect(costs.every((c) => c.version === 2)).toBe(true);
    chat.close();
  });
});
