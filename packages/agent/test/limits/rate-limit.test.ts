// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * G8: when every option of a module meets a limit, the run pauses on a rateLimit card; wait sleeps until the
 * limit lifts and goes on, switch runs the module on the chosen model for the rest of the run, stop cancels.
 * A switch the model client made on its own posts a `switched` card.
 */
import { cardSchema, unwrap, type CardOf, type RunId, type UsageLimit } from '@taalcut/core';
import { createMemoryEventLogStore, type AgentEvent } from '@taalcut/agent';
import { ModelProviderUnavailable } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { harness, ofType, type HarnessOptions } from '../support/harness';
import { fallbackClient, LIMITED, PRICES, rateLimited, quotaUsedUp } from './limit-fixtures';

const NOW = 1_800_000_000_000;

function setup(options: Partial<HarnessOptions> & { limited?: UsageLimit[]; localOnly?: boolean } = {}) {
  let now = NOW;
  const clock = { advance: (ms: number) => (now += ms), now: () => now };
  const h = harness({
    // Limited until the clock moves or the run switches models.
    script: (request) =>
      request.target || clock.now() > NOW ? { text: 'Done.' } : rateLimited(NOW + 60_000),
    now: clock.now,
    ...options,
    settings: { autonomy: 'before-render', ...(options.localOnly ? { localOnly: true } : {}) },
    deps: {
      prices: PRICES,
      phase3: { limits: { current: () => options.limited ?? [] } },
      ...options.deps,
    },
  });
  return { ...h, clock };
}

const cards = (events: readonly AgentEvent[]) =>
  ofType(events, 'card.sent')
    .map((e) => e.payload.card)
    .filter((c): c is CardOf<'rateLimit'> => c.type === 'rateLimit');

async function pausedRun(h: ReturnType<typeof setup>): Promise<{ runId: RunId; requestId: string }> {
  const outcome = unwrap(await h.agent.run({ conversationId: 'c1', message: 'Cut my trip video.' }));
  expect(outcome.status).toBe('paused');
  expect(outcome.pending).toEqual([{ requestId: expect.any(String), kind: 'rateLimit' }]);
  return { runId: outcome.runId, requestId: outcome.pending[0]!.requestId };
}

describe('the rate-limit pause', () => {
  it('asks with a rateLimit card: the limited model, its reset and the other options, local last', async () => {
    const h = setup();
    const { runId, requestId } = await pausedRun(h);
    const events = await h.events(runId);
    const [card] = cards(events);
    expect(cardSchema.safeParse(card).success).toBe(true);
    expect(card).toMatchObject({
      id: `rateLimit:${requestId}`,
      module: 'agent',
      reason: 'rate',
      status: 'waiting',
      from: { provider: 'openai', model: 'gpt-5.4' },
      resetsAt: NOW + 60_000,
      approvalId: requestId,
    });
    expect(card?.options.map((o) => [o.provider, o.local])).toEqual([
      ['google', false],
      ['anthropic', false],
      ['on-device', true],
    ]);
    const asked = ofType(events, 'approval.requested')[0]?.payload;
    expect(asked).toMatchObject({ kind: 'rateLimit', customCard: true, rateLimit: { cardId: card?.id } });
    expect(ofType(events, 'run.paused').at(-1)?.payload).toEqual({
      reason: 'approval',
      requestIds: [requestId],
    });
  });

  it('wait: sleeps until the limit lifts, then says it resumed and goes on', async () => {
    const h = setup();
    const { runId, requestId } = await pausedRun(h);
    const waiting = unwrap(
      await h.agent.answer(runId, {
        requestId,
        decision: 'approve',
        answer: { kind: 'rateLimit', choice: 'wait' },
      }),
    );
    expect(waiting.status).toBe('paused');
    let events = await h.events(runId);
    expect(ofType(events, 'limit.waiting')[0]?.payload).toEqual({ requestId, until: NOW + 60_000 });
    expect(ofType(events, 'run.paused').at(-1)?.payload).toEqual({
      reason: 'limit',
      requestIds: [],
      until: NOW + 60_000,
    });
    // Resumed too early (a timer that fires before the reset): it pauses again.
    unwrap(await h.agent.resume(runId));
    expect(ofType(await h.events(runId), 'run.paused')).toHaveLength(3);
    h.clock.advance(61_000);
    const done = unwrap(await h.agent.resume(runId));
    expect(done.status).toBe('completed');
    events = await h.events(runId);
    expect(ofType(events, 'limit.resumed')).toHaveLength(1);
    expect(cards(events).map((c) => [c.status, Boolean(c.approvalId)])).toEqual([
      ['waiting', true],
      ['waiting', false],
      ['resumed', false],
    ]);
  });

  it('switch: the module runs on the chosen model for the rest of the run', async () => {
    const h = setup();
    const { runId, requestId } = await pausedRun(h);
    const model = { provider: 'anthropic', model: 'claude-sonnet-5' };
    const done = unwrap(
      await h.agent.answer(runId, {
        requestId,
        decision: 'approve',
        answer: { kind: 'rateLimit', choice: 'switch', model },
      }),
    );
    expect(done.status).toBe('completed');
    expect(h.models.requests.at(-1)?.target).toEqual(model);
    const events = await h.events(runId);
    expect(ofType(events, 'limit.switched')[0]?.payload).toEqual({ requestId, module: 'agent', to: model });
    expect(cards(events).at(-1)).toMatchObject({ status: 'switched', to: { ...model, local: false } });
  });

  it('stop, or saying no, cancels the run', async () => {
    for (const answer of [
      { decision: 'approve' as const, answer: { kind: 'rateLimit' as const, choice: 'stop' as const } },
      { decision: 'deny' as const },
    ]) {
      const h = setup();
      const { runId, requestId } = await pausedRun(h);
      const stopped = unwrap(await h.agent.answer(runId, { requestId, ...answer }));
      expect(stopped.status).toBe('cancelled');
      expect(cards(await h.events(runId)).at(-1)?.status).toBe('stopped');
    }
  });

  it('an approve with no answer waits; a quota gets its billing page and the default wait', async () => {
    const h = setup({ script: (_r, turn) => (turn === 0 ? quotaUsedUp() : { text: 'Done.' }) });
    const { runId, requestId } = await pausedRun(h);
    const [card] = cards(await h.events(runId));
    expect(card).toMatchObject({
      reason: 'quota',
      resetsAt: null,
      billingUrl: 'https://platform.openai.com/settings/organization/billing',
    });
    unwrap(await h.agent.answer(runId, { requestId, decision: 'approve' }));
    expect(ofType(await h.events(runId), 'limit.waiting')[0]?.payload.until).toBe(NOW + 60 * 60_000);
  });

  it('never offers a paid model under Local only, nor one that is limited too', async () => {
    const local = setup({ localOnly: true });
    const first = await pausedRun(local);
    expect(cards(await local.events(first.runId))[0]?.options.map((o) => o.provider)).toEqual(['on-device']);
    const limited = setup({ limited: [LIMITED] });
    const second = await pausedRun(limited);
    expect(cards(await limited.events(second.runId))[0]?.options.map((o) => o.provider)).toEqual([
      'anthropic',
      'on-device',
    ]);
  });

  it('a switch the client made on its own posts a switched card, with what it costs on top', async () => {
    const store = createMemoryEventLogStore();
    const h = setup({ store, deps: { models: fallbackClient() } });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c1', message: 'Cut it.' }));
    expect(outcome.status).toBe('completed');
    const [card] = cards(await h.events(outcome.runId));
    expect(cardSchema.safeParse(card).success).toBe(true);
    expect(card).toMatchObject({
      status: 'switched',
      reason: 'rate',
      from: { provider: 'openai', model: 'gpt-5.4' },
      to: { provider: 'anthropic', model: 'claude-sonnet-5', local: false },
      options: [],
    });
    expect(card?.extra?.micros).toBeGreaterThan(0);
  });

  it('a fallback for anything but a limit (a provider down) posts no card', async () => {
    const down = ModelProviderUnavailable({ provider: 'openai', model: 'gpt-5.4' });
    const h = setup({ deps: { models: fallbackClient(down) } });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c1', message: 'Cut it.' }));
    expect(outcome.status).toBe('completed');
    expect(cards(await h.events(outcome.runId))).toEqual([]);
  });
});
