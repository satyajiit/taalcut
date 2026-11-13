// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-RUN: a run on a plan the person signed in with (a ChatGPT subscription: provider openai, US$0 a call) spends
 * no money, so it never stops on a budget card: not for tokens, not for the wall clock. The owner's make paused at
 * the Editor with "The next model call would go over the tokens budget" (374,190 of 400,000) though they never set
 * a limit and nothing cost them anything. A metered API key's tokens still count.
 */
import { unwrap } from '@taalcut/core';
import type { ModulePrice, PriceLookup } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { call, harness, ofType, plan, turns, type HarnessOptions } from './support/harness';

const onPlan = { provider: 'openai', model: 'gpt-6-astra', planBilled: true } as const;
const metered = { provider: 'openai', model: 'gpt-6-astra' } as const;

const count = (reply: object) =>
  turns(
    { ...plan('Count'), ...reply },
    { toolCalls: [call('clips_countWords', { text: 'a' })], ...reply },
    { toolCalls: [call('clips_countWords', { text: 'b' })], ...reply },
    { text: 'Counted.', ...reply },
  );

/** What the desktop's price lookup says of a module on the ChatGPT plan: free per token, not on this Mac. */
const planPrices: PriceLookup = {
  price: (module) =>
    ({
      module,
      provider: 'chatgpt',
      model: 'gpt-6-astra',
      local: false,
      planBilled: true,
      usdPerMTok: { input: 0, output: 0, cacheRead: 0 },
    }) satisfies ModulePrice,
  options: () => [],
};

// Each turn's own estimate fits the 400 tokens; their sum (4 × 120 used, plus the next estimate) does not.
const small = { estimator: { estimate: () => ({ tokens: 300, usd: 0 }) } };

const run = (options: HarnessOptions) => {
  const h = harness(options);
  return { h, done: h.agent.run({ conversationId: 'c', message: 'count' }) };
};

describe('a plan the person signed in with costs nothing', () => {
  it('never stops the run on the tokens budget', async () => {
    const { h, done } = run({
      script: count(onPlan),
      deps: { ...small, prices: planPrices },
      settings: { budget: { maxTokens: 400 } },
    });
    const outcome = unwrap(await done);
    expect(outcome).toMatchObject({ status: 'completed', report: 'Counted.' });
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'approval.requested')).toEqual([]);
    expect(ofType(events, 'model.responded').every((e) => e.payload.planBilled === true)).toBe(true);
  });

  it('never stops it on the tokens budget when the price lookup does not know the plan yet', async () => {
    // Without prices, the first turn's estimate counts (300 of 400); the plan's answers then say they were free.
    const { h, done } = run({ script: count(onPlan), deps: small, settings: { budget: { maxTokens: 400 } } });
    const outcome = unwrap(await done);
    expect(outcome.status).toBe('completed');
    expect(ofType(await h.events(outcome.runId), 'approval.requested')).toEqual([]);
  });

  it('never stops it on the wall clock', async () => {
    let now = 1_000_000;
    const script = count(onPlan);
    const { h, done } = run({
      now: () => now,
      script: (request, turn) => {
        now += 400;
        return script(request, turn);
      },
      deps: { prices: planPrices },
      settings: { budget: { maxWallClockMs: 1_000 } },
    });
    const outcome = unwrap(await done);
    expect(outcome.status).toBe('completed');
    expect(ofType(await h.events(outcome.runId), 'approval.requested')).toEqual([]);
  });

  it('a metered API key on the same model still stops at the tokens budget', async () => {
    const { h, done } = run({
      script: count(metered),
      deps: small,
      settings: { budget: { maxTokens: 400 } },
    });
    const outcome = unwrap(await done);
    expect(outcome).toMatchObject({ status: 'paused', pending: [{ kind: 'budget' }] });
    const asked = ofType(await h.events(outcome.runId), 'approval.requested');
    expect(asked[0]?.payload).toMatchObject({ kind: 'budget', limit: 'tokens' });
  });
});
