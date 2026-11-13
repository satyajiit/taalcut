// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
// UX1 W2-1: every state change of useRpcQuery and useRpcStream. New inputs go back to loading at once, keeping
// the last answer as stale data; reload() re-reads the same inputs and keeps the answer current, refreshing (so
// a page never flashes its bones on a change event); a failure keeps the answer beside the error; a late answer
// to an earlier request never lands.
import { NotFoundError, TimeoutError } from '@taalcut/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRpcQuery, useRpcStream } from '../src/backend/use-rpc';

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (cause: unknown) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** A load function whose calls the test answers one by one, and which records the signals it got. */
function scripted<T>() {
  const calls: { input: string; signal: AbortSignal; answer: ReturnType<typeof deferred<T>> }[] = [];
  const load = (input: string) => (signal: AbortSignal) => {
    const answer = deferred<T>();
    calls.push({ input, signal, answer });
    return answer.promise;
  };
  return { calls, load };
}

describe('useRpcQuery', () => {
  it('starts loading with nothing stale, then is ready with the answer', async () => {
    const { calls, load } = scripted<string>();
    const { result } = renderHook(() => useRpcQuery(load('a'), ['a']));
    expect(result.current).toMatchObject({ status: 'loading', stale: false });
    expect(result.current.data).toBeUndefined();
    await act(async () => calls[0]?.answer.resolve('A'));
    expect(result.current).toMatchObject({ status: 'ready', data: 'A' });
    expect(result.current.stale).toBeFalsy();
  });

  it('goes back to loading in the same render when its inputs change, keeping the last answer as stale', async () => {
    const { calls, load } = scripted<string>();
    const { result, rerender } = renderHook(({ id }) => useRpcQuery(load(id), [id]), {
      initialProps: { id: 'a' },
    });
    await act(async () => calls[0]?.answer.resolve('A'));
    rerender({ id: 'b' });
    // No frame shows clip A's answer as clip B's.
    expect(result.current).toMatchObject({ status: 'loading', data: 'A', stale: true });
    expect(calls).toHaveLength(2);
    await act(async () => calls[1]?.answer.resolve('B'));
    expect(result.current).toMatchObject({ status: 'ready', data: 'B' });
  });

  it('does not reload when the inputs are the same values', async () => {
    const { calls, load } = scripted<string>();
    const { result, rerender } = renderHook(({ id }) => useRpcQuery(load(id), [id]), {
      initialProps: { id: 'a' },
    });
    await act(async () => calls[0]?.answer.resolve('A'));
    rerender({ id: 'a' });
    expect(result.current.status).toBe('ready');
    expect(calls).toHaveLength(1);
  });

  it('reload() re-reads the same inputs keeping the answer: ready and refreshing, never loading, then the new one', async () => {
    const { calls, load } = scripted<number>();
    const { result } = renderHook(() => useRpcQuery(load('n'), []));
    await act(async () => calls[0]?.answer.resolve(1));
    act(() => result.current.reload());
    // The same render: no frame drops the answer or goes back to the skeleton state.
    expect(result.current).toMatchObject({ status: 'ready', data: 1, refreshing: true });
    expect(result.current.stale).toBeFalsy();
    expect(calls).toHaveLength(2);
    // Another change event while it reads: still the same answer, still refreshing.
    act(() => result.current.reload());
    expect(result.current).toMatchObject({ status: 'ready', data: 1, refreshing: true });
    expect(calls[1]?.signal.aborted).toBe(true);
    await act(async () => calls[2]?.answer.resolve(2));
    expect(result.current).toMatchObject({ status: 'ready', data: 2 });
    expect(result.current.refreshing).toBeFalsy();
  });

  it('reload() with no answer yet is plain loading', () => {
    const { calls, load } = scripted<number>();
    const { result } = renderHook(() => useRpcQuery(load('n'), []));
    act(() => result.current.reload());
    expect(result.current).toMatchObject({ status: 'loading', stale: false });
    expect(result.current.data).toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  it('reload() while new inputs load keeps the old answer stale: it is still for the other inputs', async () => {
    const { calls, load } = scripted<string>();
    const { result, rerender } = renderHook(({ id }) => useRpcQuery(load(id), [id]), {
      initialProps: { id: 'a' },
    });
    await act(async () => calls[0]?.answer.resolve('A'));
    rerender({ id: 'b' });
    act(() => result.current.reload());
    expect(result.current).toMatchObject({ status: 'loading', data: 'A', stale: true });
    await act(async () => calls[2]?.answer.resolve('B'));
    expect(result.current).toMatchObject({ status: 'ready', data: 'B' });
  });

  it('a first failure is an error with no data', async () => {
    const { calls, load } = scripted<string>();
    const { result } = renderHook(() => useRpcQuery(load('a'), []));
    await act(async () => calls[0]?.answer.reject(NotFoundError({ entity: 'asset' })));
    expect(result.current).toMatchObject({ status: 'error', stale: false });
    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.code).toBe('core.not_found');
  });

  it('a failed re-read keeps the answer beside the error, not stale, and reload() recovers', async () => {
    const { calls, load } = scripted<string>();
    const { result } = renderHook(() => useRpcQuery(load('a'), []));
    await act(async () => calls[0]?.answer.resolve('A'));
    act(() => result.current.reload());
    await act(async () => calls[1]?.answer.reject(TimeoutError({ ms: 30_000 })));
    expect(result.current).toMatchObject({ status: 'error', data: 'A', stale: false });
    expect(result.current.error?.code).toBe('core.timeout');
    act(() => result.current.reload());
    expect(result.current).toMatchObject({ status: 'ready', data: 'A', refreshing: true });
    await act(async () => calls[2]?.answer.resolve('A2'));
    expect(result.current).toMatchObject({ status: 'ready', data: 'A2' });
  });

  it('a failure after new inputs keeps the old answer stale beside the error', async () => {
    const { calls, load } = scripted<string>();
    const { result, rerender } = renderHook(({ id }) => useRpcQuery(load(id), [id]), {
      initialProps: { id: 'a' },
    });
    await act(async () => calls[0]?.answer.resolve('A'));
    rerender({ id: 'b' });
    await act(async () => calls[1]?.answer.reject(NotFoundError({ entity: 'asset' })));
    expect(result.current).toMatchObject({ status: 'error', data: 'A', stale: true });
    act(() => result.current.reload());
    expect(result.current).toMatchObject({ status: 'loading', data: 'A', stale: true });
  });

  it('aborts the older request, and its late answer never lands', async () => {
    const { calls, load } = scripted<string>();
    const { result, rerender } = renderHook(({ id }) => useRpcQuery(load(id), [id]), {
      initialProps: { id: 'a' },
    });
    rerender({ id: 'b' });
    expect(calls[0]?.signal.aborted).toBe(true);
    await act(async () => calls[1]?.answer.resolve('B'));
    await act(async () => calls[0]?.answer.resolve('A, late'));
    expect(result.current).toMatchObject({ status: 'ready', data: 'B' });
  });

  it('aborts on unmount', () => {
    const { calls, load } = scripted<string>();
    const { unmount } = renderHook(() => useRpcQuery(load('a'), []));
    unmount();
    expect(calls[0]?.signal.aborted).toBe(true);
  });
});

/** A stream the test feeds by hand: push values, or fail it. */
function controlledStream<T>() {
  const queue: T[] = [];
  let wake: (() => void) | null = null;
  let failure: unknown = null;
  const nudge = () => {
    wake?.();
    wake = null;
  };
  async function* values(): AsyncGenerator<T> {
    for (;;) {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) yield next;
      if (failure) throw failure;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }
  return {
    iterable: values(),
    push: (value: T) => {
      queue.push(value);
      nudge();
    },
    fail: (cause: unknown) => {
      failure = cause;
      nudge();
    },
  };
}

describe('useRpcStream', () => {
  it('is ready with each value as it arrives', async () => {
    const stream = controlledStream<number>();
    const { result } = renderHook(() => useRpcStream(async () => stream.iterable, []));
    expect(result.current).toMatchObject({ status: 'loading', stale: false });
    act(() => stream.push(1));
    await waitFor(() => expect(result.current).toMatchObject({ status: 'ready', data: 1 }));
    act(() => stream.push(2));
    await waitFor(() => expect(result.current.data).toBe(2));
  });

  it('a failure keeps the last value beside the error, and reload() opens the stream again, refreshing', async () => {
    const first = controlledStream<string>();
    const second = controlledStream<string>();
    let opened = 0;
    const { result } = renderHook(() =>
      useRpcStream(async () => (opened++ === 0 ? first : second).iterable, []),
    );
    act(() => first.push('first'));
    await waitFor(() => expect(result.current.data).toBe('first'));
    act(() => first.fail(TimeoutError({ ms: 1000 })));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toMatchObject({ data: 'first', stale: false });
    act(() => result.current.reload());
    expect(result.current).toMatchObject({ status: 'ready', data: 'first', refreshing: true });
    act(() => second.push('again'));
    await waitFor(() => expect(result.current).toMatchObject({ status: 'ready', data: 'again' }));
    expect(opened).toBe(2);
  });

  it('new inputs open a new stream: loading with the old value stale until the first new one', async () => {
    const byId = { a: controlledStream<string>(), b: controlledStream<string>() };
    const signals: AbortSignal[] = [];
    const { result, rerender } = renderHook(
      ({ id }: { id: 'a' | 'b' }) =>
        useRpcStream(
          async (signal) => {
            signals.push(signal);
            return byId[id].iterable;
          },
          [id],
        ),
      { initialProps: { id: 'a' } },
    );
    act(() => byId.a.push('A'));
    await waitFor(() => expect(result.current.data).toBe('A'));
    rerender({ id: 'b' });
    expect(result.current).toMatchObject({ status: 'loading', data: 'A', stale: true });
    expect(signals[0]?.aborted).toBe(true);
    act(() => byId.b.push('B'));
    await waitFor(() => expect(result.current).toMatchObject({ status: 'ready', data: 'B' }));
  });
});
