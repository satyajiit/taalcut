// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Round P3-3: the budget gate's estimate is a tool's closer `refineCost` when it answers ok in time, else the
 * synchronous `estimateCost` bound: on an error, a throw, a cancelled call or a refinement slower than the wait.
 */
import { err, ok, type AnyTool, type ToolCostEstimate } from '@taalcut/core';
import type { ToolAuthorizeRequest, ToolPolicy } from '@taalcut/tools';
import { describe, expect, it } from 'vitest';
import { estimateFor } from '../src/estimate';
import { fxModule, fxTool, setup } from './helpers';

const BOUND: ToolCostEstimate = { usd: 0.3, basis: 'up to 1,000 characters' };
const CLOSER: ToolCostEstimate = { usd: 0.12, basis: '400 draft characters' };

const paid = (refineCost?: AnyTool['refineCost']) =>
  fxTool({
    costClass: 'paid',
    permission: { network: 'internet', cloudModules: ['voice'] },
    estimateCost: () => BOUND,
    ...(refineCost ? { refineCost } : {}),
    run: async () => ok({ n: 1 }),
  });

/** The estimate the policy was asked with, for one call. */
async function gateSaw(tool: AnyTool): Promise<ToolCostEstimate | undefined> {
  const asked: ToolAuthorizeRequest[] = [];
  const policy: ToolPolicy = { authorize: (request) => (asked.push(request), { kind: 'allow' }) };
  const { executor } = setup({ modules: [fxModule(tool)], policy });
  expect((await executor.execute('fx.thing', {})).ok).toBe(true);
  return asked[0]?.estimate;
}

describe('the budget gate’s estimate', () => {
  it('passes the approved billing mode to the run even if account state changes during authorization', async () => {
    let connected = true;
    const estimate: ToolCostEstimate = { usd: 0, billing: 'subscription' };
    let runEstimate: ToolCostEstimate | undefined;
    const tool = fxTool({
      costClass: 'paid',
      permission: { network: 'internet', cloudModules: ['images'] },
      estimateCost: () => BOUND,
      refineCost: async () => ok(connected ? estimate : BOUND),
      run: async (_input, ctx) => {
        runEstimate = ctx.estimate;
        return ok({ n: 1 });
      },
    });
    const policy: ToolPolicy = {
      authorize: (request) => {
        expect(request.estimate).toEqual(estimate);
        connected = false;
        return { kind: 'allow' };
      },
    };
    const { executor } = setup({ modules: [fxModule(tool)], policy });
    expect((await executor.execute('fx.thing', {})).ok).toBe(true);
    expect(runEstimate).toEqual(estimate);
  });

  it('is the bound for a tool without a refinement', async () => {
    expect(await gateSaw(paid())).toEqual(BOUND);
  });

  it("is the refinement when it answers, read with the call's input and a live signal", async () => {
    const seen: unknown[] = [];
    const tool = paid(async (input, ctx) => {
      seen.push(input, ctx.signal.aborted);
      return ok(CLOSER);
    });
    expect(await gateSaw(tool)).toEqual(CLOSER);
    expect(seen).toEqual([{ n: 1 }, false]);
  });

  it('keeps the bound when the refinement fails or throws', async () => {
    const failing = paid(async () => err({ code: 'timeline.not_found', messageKey: 'x', retryable: false }));
    expect(await gateSaw(failing)).toEqual(BOUND);
    const throwing = paid(async () => {
      throw new Error('refine bug');
    });
    expect(await gateSaw(throwing)).toEqual(BOUND);
  });
});

describe('estimateFor', () => {
  const never = (_input: unknown, ctx: { readonly signal: AbortSignal }) =>
    new Promise<never>((_resolve, reject) =>
      ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason)),
    );

  it('keeps the bound when the refinement is slower than the wait, and aborts it', async () => {
    let signal: AbortSignal | undefined;
    const spec = paid((input, ctx) => {
      signal = ctx.signal;
      return never(input, ctx);
    });
    expect(await estimateFor(spec, { n: 1 }, { timeoutMs: 20 })).toEqual(BOUND);
    expect(signal?.aborted).toBe(true);
  });

  it('keeps the bound when the call is cancelled while it waits', async () => {
    const call = new AbortController();
    const waiting = estimateFor(paid(never), { n: 1 }, { signal: call.signal });
    call.abort();
    expect(await waiting).toEqual(BOUND);
    // Already cancelled: no wait at all.
    expect(await estimateFor(paid(never), { n: 1 }, { signal: call.signal })).toEqual(BOUND);
  });

  it('is undefined for a tool with neither', async () => {
    expect(await estimateFor(fxTool({ run: async () => ok({ n: 1 }) }), {})).toBeUndefined();
  });
});
