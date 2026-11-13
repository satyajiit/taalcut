// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Review H2: a paid tool that bills and then fails (its placement conflicts) must not bill again when the model
 * repeats the call in the same run. The error is kept under the idempotency key, like an uncertain failure; a
 * local tool's clean failure is still not remembered, and a new run may try again.
 */
import { ConflictError, err, newId, ok, type AnyTool } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { fxModule, fxTool, recordingBus, setup } from './helpers';

interface Provider {
  calls: number;
}

/** Bills the provider (and reports it), then dispatches its command: the bus decides whether that holds. */
function generateTool(provider: Provider, overrides: Partial<AnyTool> = {}): AnyTool {
  return fxTool({
    name: 'fx.generate',
    costClass: 'paid',
    sideEffect: 'write',
    command: 'fx.place',
    permission: { network: 'internet' },
    estimateCost: () => ({ usd: 0.08 }),
    idempotencyKey: (input) => JSON.stringify(input),
    run: async (input, ctx) => {
      provider.calls += 1;
      ctx.reportUsage({ usd: 0.08, provider: 'openrouter', model: 'still-1' });
      if (!('dispatch' in ctx)) throw new Error('a command tool');
      const placed = await ctx.dispatch(input);
      return placed.ok ? ok({ n: 1 }) : err(placed.error);
    },
    ...overrides,
  });
}

const conflicting = { dispatch: async () => err(ConflictError({ entity: 'timeline' })) };

describe('a paid call that failed after it billed', () => {
  it('answers a repeat in the same run with the first error, without paying again', async () => {
    const provider = { calls: 0 };
    const { executor } = setup({ modules: [fxModule(generateTool(provider))], commands: conflicting });
    const call = { runId: newId<'AgentRun'>() };
    const first = await executor.execute('fx.generate', { n: 2 }, call);
    const again = await executor.execute('fx.generate', { n: 2 }, call);
    expect(!first.ok && first.error.code).toBe('core.conflict');
    expect(!again.ok && again.error.code).toBe('core.conflict');
    expect(provider.calls).toBe(1);
  });

  it('remembers a failure of any tool that reported usage before it failed', async () => {
    const provider = { calls: 0 };
    const local = generateTool(provider, { costClass: 'local', estimateCost: undefined });
    const { executor } = setup({ modules: [fxModule(local)], commands: conflicting });
    const call = { runId: newId<'AgentRun'>() };
    await executor.execute('fx.generate', { n: 1 }, call);
    await executor.execute('fx.generate', { n: 1 }, call);
    expect(provider.calls).toBe(1);
  });

  it('may try again in a new run (the person asked again)', async () => {
    const provider = { calls: 0 };
    const { executor } = setup({ modules: [fxModule(generateTool(provider))], commands: conflicting });
    await executor.execute('fx.generate', { n: 2 }, { runId: newId<'AgentRun'>() });
    await executor.execute('fx.generate', { n: 2 }, { runId: newId<'AgentRun'>() });
    expect(provider.calls).toBe(2);
  });

  it("still lets a local write's clean failure run again: it had no effect", async () => {
    let calls = 0;
    const { bus } = recordingBus(true);
    const tool = fxTool({
      name: 'fx.rename',
      sideEffect: 'write',
      command: 'fx.rename',
      idempotencyKey: (input) => JSON.stringify(input),
      run: async (input, ctx) => {
        calls += 1;
        if (!('dispatch' in ctx)) throw new Error('a command tool');
        const done = await ctx.dispatch(input);
        return done.ok ? ok({ n: 1 }) : err(done.error);
      },
    });
    const { executor } = setup({ modules: [fxModule(tool)], commands: bus });
    const call = { runId: newId<'AgentRun'>() };
    await executor.execute('fx.rename', { n: 1 }, call);
    await executor.execute('fx.rename', { n: 1 }, call);
    expect(calls).toBe(2);
  });
});
