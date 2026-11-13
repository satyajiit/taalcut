// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Regression tests for review finding 1 (P1-G1, high): a timed-out attempt
 * was retried while its run() was still going, so one approved call could
 * have its side effect several times after the caller was told it failed.
 */
import {
  defineError,
  err,
  newId,
  ok,
  type AnyTool,
  type CommandToolContext,
  type ToolContextBase,
} from '@taalcut/core';
import type { ToolDispatchMeta } from '@taalcut/tools';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { approvingPolicy, fxModule, fxTool, setup } from './helpers';

const Busy = defineError('fx.overlap_busy', { retryable: true });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A tool whose run() takes `ms` and ignores its signal; counts runs in flight and effects. */
function slowTool(ms: number, overrides: Partial<AnyTool> = {}) {
  const stats = { started: 0, active: 0, maxActive: 0, effects: 0 };
  const tool = fxTool({
    timeoutMs: 80,
    retry: { maxAttempts: 3, initialDelayMs: 0 },
    ...overrides,
    run: async () => {
      stats.started++;
      stats.active++;
      stats.maxActive = Math.max(stats.maxActive, stats.active);
      await new Promise((resolve) => setTimeout(resolve, ms));
      stats.effects++;
      stats.active--;
      return ok({ n: 1 });
    },
  });
  return { tool, stats };
}

const upload: Partial<AnyTool> = {
  name: 'fx.upload',
  sideEffect: 'external',
  permission: { network: 'internet' },
  idempotencyKey: () => 'clip-1',
};

describe('timeouts never lead to overlapping or repeated side effects', () => {
  it('runs an approved external tool once when it times out, and remembers that', async () => {
    const { tool, stats } = slowTool(250, upload);
    const { policy, approvals } = approvingPolicy();
    const { executor, events } = setup({ modules: [fxModule(tool)], policy });
    const runId = newId<'AgentRun'>();
    const pending = executor.execute('fx.upload', {}, { runId });
    await vi.advanceTimersByTimeAsync(80);
    const result = await pending;
    expect(!result.ok && result.error.code).toBe('core.timeout');
    expect(events.at(-1)).toMatchObject({ type: 'tool.finished', attempts: 1 });
    await vi.runAllTimersAsync();
    expect(stats).toMatchObject({ started: 1, maxActive: 1, effects: 1 });
    expect(approvals).toHaveLength(1);

    // The upload may have gone out: a repeat in the same run gets the same error and doesn't run.
    const again = await executor.execute('fx.upload', {}, { runId });
    expect(!again.ok && again.error.code).toBe('core.timeout');
    expect(events.at(-1)).toMatchObject({ type: 'tool.finished', deduplicated: true });
    expect(stats.started).toBe(1);
    expect(approvals).toHaveLength(1);
  });

  it('does not retry a read tool that ignores its signal past the grace period', async () => {
    const { tool, stats } = slowTool(250);
    const { executor } = setup({ modules: [fxModule(tool)] });
    const pending = executor.execute('fx.thing', {});
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(!result.ok && result.error.code).toBe('core.timeout');
    expect(stats).toMatchObject({ started: 1, maxActive: 1 });
  });

  it('retries a timed-out read only after the attempt has returned', async () => {
    const { tool, stats } = slowTool(120);
    const { executor, events } = setup({ modules: [fxModule(tool)] });
    const pending = executor.execute('fx.thing', {});
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(!result.ok && result.error.code).toBe('core.timeout');
    expect(stats).toMatchObject({ started: 3, maxActive: 1, effects: 3 });
    expect(events.at(-1)).toMatchObject({ type: 'tool.finished', attempts: 3 });
  });

  it('gives up waiting for a stopped attempt when the caller cancels', async () => {
    const { tool, stats } = slowTool(10_000, { timeoutMs: 1_000 });
    const { executor } = setup({ modules: [fxModule(tool)] });
    const stop = new AbortController();
    const pending = executor.execute('fx.thing', {}, { signal: stop.signal });
    await vi.advanceTimersByTimeAsync(1_100);
    stop.abort();
    const result = await pending;
    expect(!result.ok && result.error.code).toBe('core.cancelled');
    expect(stats.started).toBe(1);
  });
});

describe('one approval covers one call, retried only after definite failures', () => {
  it('retries an error the tool reported, under the same approval, key and command', async () => {
    const metas: ToolDispatchMeta[] = [];
    let failures = 1;
    const erase = fxTool({
      name: 'fx.erase',
      sideEffect: 'destructive',
      command: 'fx.erase',
      idempotencyKey: () => 'c1',
      retry: { maxAttempts: 3, initialDelayMs: 1 },
      run: async (_input, ctx) => {
        const done = await (ctx as CommandToolContext).dispatch({});
        return done.ok && done.value === 'busy' ? err(Busy()) : ok({ n: 1 });
      },
    });
    const { policy, approvals } = approvingPolicy();
    const commands = {
      dispatch: async (_command: string, _payload: unknown, meta: ToolDispatchMeta) => {
        metas.push(meta);
        return ok(failures-- > 0 ? 'busy' : 'applied');
      },
    };
    const { executor } = setup({ modules: [fxModule(erase)], policy, commands });
    const runId = newId<'AgentRun'>();
    const pending = executor.execute('fx.erase', {}, { runId });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.ok && result.value.attempts).toBe(2);
    expect(approvals).toHaveLength(1);
    // The bus sees the same key both times (so it can refuse a second apply) and each attempt's signal.
    expect(metas.map((m) => m.idempotencyKey)).toEqual([`${runId}:fx.erase:c1`, `${runId}:fx.erase:c1`]);
    expect(metas[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(metas[0]?.signal).not.toBe(metas[1]?.signal);
  });

  it('gives an external tool with no command its idempotency key on the context', async () => {
    let seen: unknown;
    const tool = fxTool({
      ...upload,
      run: async (_input, ctx) => {
        seen = (ctx as ToolContextBase & { idempotencyKey?: string }).idempotencyKey;
        return ok({ n: 1 });
      },
    });
    const { policy } = approvingPolicy();
    const { executor } = setup({ modules: [fxModule(tool)], policy });
    const runId = newId<'AgentRun'>();
    expect((await executor.execute('fx.upload', {}, { runId })).ok).toBe(true);
    expect(seen).toBe(`${runId}:fx.upload:clip-1`);
  });
});
