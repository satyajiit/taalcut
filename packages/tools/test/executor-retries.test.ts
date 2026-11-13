// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Timeouts (AbortSignal), cancellation and retries with backoff. */
import { defineError, err, ok, unwrap } from '@taalcut/core';
import type { ToolEvent } from '@taalcut/tools';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServices, fxModule, fxTool, setup } from './helpers';

const Busy = defineError('fx.busy', { retryable: true });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A run that never settles on its own; records the signal it was given. */
function hangingTool(timeoutMs: number, retry = { maxAttempts: 1, initialDelayMs: 0 }) {
  const signals: AbortSignal[] = [];
  const tool = fxTool({
    timeoutMs,
    retry,
    run: (_input, ctx) => {
      signals.push(ctx.signal);
      return new Promise(() => {});
    },
  });
  return { tool, signals };
}

describe('retries', () => {
  it('retries retryable errors with jittered exponential backoff, then succeeds', async () => {
    const { executor, events } = setup({ services: fakeServices({ busyTimes: 2 }) });
    const pending = executor.execute('testdomain.captionFrame', { frame: 'f' });
    await vi.runAllTimersAsync();
    const result = unwrap(await pending);
    expect(result).toMatchObject({ attempts: 3, value: { caption: 'A sunny beach (f)' } });
    const retries = events.filter(
      (e): e is Extract<ToolEvent, { type: 'tool.retrying' }> => e.type === 'tool.retrying',
    );
    // initialDelayMs 50, factor 2, cap 200; random() = 0.5 gives 75% of each step.
    expect(retries.map((e) => [e.attempt, e.delayMs, e.error.code])).toEqual([
      [1, 38, 'testdomain.captioner_busy'],
      [2, 75, 'testdomain.captioner_busy'],
    ]);
    // Only the attempt that reached the model reported usage.
    expect(result.usage.usd).toBe(0.003);
  });

  it('gives up after maxAttempts with the last error', async () => {
    const { executor, events } = setup({ services: fakeServices({ busyTimes: 5 }) });
    const pending = executor.execute('testdomain.captionFrame', { frame: 'f' });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(!result.ok && result.error.code).toBe('testdomain.captioner_busy');
    expect(events.at(-1)).toMatchObject({ type: 'tool.finished', attempts: 3 });
  });

  it('does not retry errors that are not retryable', async () => {
    const run = vi.fn(async () => err(defineError('fx.final')()));
    const { executor } = setup({
      modules: [fxModule(fxTool({ run, retry: { maxAttempts: 5, initialDelayMs: 1 } }))],
    });
    expect((await executor.execute('fx.thing', {})).ok).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('numbers attempts in the context', async () => {
    const attempts: number[] = [];
    const tool = fxTool({
      retry: { maxAttempts: 3, initialDelayMs: 10 },
      run: async (_input, ctx) => (attempts.push(ctx.attempt), ctx.attempt < 3 ? err(Busy()) : ok({ n: 1 })),
    });
    const { executor } = setup({ modules: [fxModule(tool)] });
    const pending = executor.execute('fx.thing', {});
    await vi.runAllTimersAsync();
    unwrap(await pending);
    expect(attempts).toEqual([1, 2, 3]);
  });
});

describe('timeouts', () => {
  it('settles at the deadline with core.timeout and aborts the tool’s signal', async () => {
    const { tool, signals } = hangingTool(1_000);
    const { executor } = setup({ modules: [fxModule(tool)] });
    const pending = executor.execute('fx.thing', {});
    await vi.advanceTimersByTimeAsync(999);
    expect(signals[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(!result.ok && result.error).toMatchObject({
      code: 'core.timeout',
      params: { ms: 1000 },
      retryable: true,
    });
    expect(signals[0]?.aborted).toBe(true);
  });

  it('retries a timeout of a read tool that stops when aborted, each attempt with its own signal', async () => {
    const signals: AbortSignal[] = [];
    const tool = fxTool({
      timeoutMs: 100,
      retry: { maxAttempts: 2, initialDelayMs: 10 },
      run: (_input, ctx) => {
        signals.push(ctx.signal);
        return new Promise((resolve) =>
          ctx.signal.addEventListener('abort', () => resolve(err(Busy())), { once: true }),
        );
      },
    });
    const { executor } = setup({ modules: [fxModule(tool)] });
    const pending = executor.execute('fx.thing', {});
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(!result.ok && result.error.code).toBe('core.timeout');
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
  });
});

describe('cancellation', () => {
  it('stops a running call when the caller aborts', async () => {
    const { tool, signals } = hangingTool(60_000);
    const { executor } = setup({ modules: [fxModule(tool)] });
    const stop = new AbortController();
    const pending = executor.execute('fx.thing', {}, { signal: stop.signal });
    await vi.advanceTimersByTimeAsync(10);
    stop.abort();
    const result = await pending;
    expect(!result.ok && result.error.code).toBe('core.cancelled');
    expect(signals[0]?.aborted).toBe(true);
  });

  it('does not start when the signal is already aborted', async () => {
    const run = vi.fn(async () => ok({ n: 1 }));
    const { executor } = setup({ modules: [fxModule(fxTool({ run }))] });
    const result = await executor.execute('fx.thing', {}, { signal: AbortSignal.abort() });
    expect(!result.ok && result.error.code).toBe('core.cancelled');
    expect(run).not.toHaveBeenCalled();
  });

  it('stops waiting between retries when cancelled', async () => {
    const run = vi.fn(async () => err(Busy()));
    const tool = fxTool({ run, retry: { maxAttempts: 3, initialDelayMs: 5_000 } });
    const { executor } = setup({ modules: [fxModule(tool)] });
    const stop = new AbortController();
    const pending = executor.execute('fx.thing', {}, { signal: stop.signal });
    await vi.advanceTimersByTimeAsync(100);
    stop.abort();
    const result = await pending;
    expect(!result.ok && result.error.code).toBe('core.cancelled');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not retry once the caller has cancelled', async () => {
    const stop = new AbortController();
    const tool = fxTool({
      retry: { maxAttempts: 3, initialDelayMs: 1 },
      run: async () => {
        stop.abort();
        return err(Busy());
      },
    });
    const { executor } = setup({ modules: [fxModule(tool)] });
    const result = await executor.execute('fx.thing', {}, { signal: stop.signal });
    expect(!result.ok && result.error.code).toBe('core.cancelled');
  });
});
