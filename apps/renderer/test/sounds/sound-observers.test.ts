// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ImportSession, TaalcutEvent } from '@taalcut/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../src/backend/backend';
import { observeSounds } from '../../src/features/sounds/sound-observers';
import { cableRun, command, importSession, setup, wifiFile } from './sound-event-fixtures';

/** One connection, with explicit server failure and abort-aware cleanup. */
function connection<T>() {
  let waiting = Promise.withResolvers<IteratorResult<T, undefined>>();
  const closed = vi.fn();
  const end = () => waiting.resolve({ done: true, value: undefined });
  return {
    closed,
    end,
    push: (value: T) => waiting.resolve({ done: false, value }),
    fail: () => waiting.reject(new Error('connection lost')),
    async *stream(signal?: AbortSignal): AsyncGenerator<T> {
      signal?.addEventListener('abort', end, { once: true });
      try {
        while (!signal?.aborted) {
          const item = await waiting.promise;
          waiting = Promise.withResolvers<IteratorResult<T, undefined>>();
          if (item.done) return;
          yield item.value;
        }
      } finally {
        signal?.removeEventListener('abort', end);
        closed();
      }
    },
  };
}

const stops: (() => void)[] = [];
const settle = () => vi.advanceTimersByTimeAsync(0);

function harness() {
  const { sounds, preference: base } = setup();
  let ready = true;
  const preference = {
    ...base,
    getSnapshot: () => ({ ...base.getSnapshot(), ready }),
    refresh: vi.fn(async () => {
      ready = true;
    }),
    cancel: vi.fn(() => {
      ready = false;
    }),
  };
  const events: ReturnType<typeof connection<TaalcutEvent>>[] = [];
  const imports: ReturnType<typeof connection<{ sessions: ImportSession[] }>>[] = [];
  const subscribe = vi.fn(async (...[_input, options]: Parameters<Backend['events']['subscribe']>) => {
    const live = connection<TaalcutEvent>();
    events.push(live);
    return live.stream(options?.signal);
  });
  const watch = vi.fn(async (...[_input, options]: Parameters<Backend['imports']['watch']>) => {
    const live = connection<{ sessions: ImportSession[] }>();
    imports.push(live);
    return live.stream(options?.signal);
  });
  // These narrow fakes provide iterables without the RPC client's private iterator wrapper.
  const backend = { events: { subscribe }, imports: { watch } } as unknown as Backend;
  const start = () => {
    const stop = observeSounds(backend, sounds, preference);
    stops.push(stop);
    return stop;
  };
  return { sounds, preference, events, imports, subscribe, watch, start };
}

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  await settle();
  vi.useRealTimers();
});

describe('sound observation lifecycle', () => {
  it('aborts both live streams and drops events already in flight when stopped', async () => {
    const h = harness();
    const stop = h.start();
    await settle();
    const eventSignal = h.subscribe.mock.calls[0]?.[1]?.signal;
    const importSignal = h.watch.mock.calls[0]?.[1]?.signal;
    expect(eventSignal?.aborted).toBe(false);
    expect(importSignal?.aborted).toBe(false);

    h.events[0]!.push(command());
    stop();
    await settle();
    expect(eventSignal?.aborted).toBe(true);
    expect(importSignal?.aborted).toBe(true);
    expect(h.events[0]!.closed).toHaveBeenCalledOnce();
    expect(h.imports[0]!.closed).toHaveBeenCalledOnce();
    expect(h.sounds.play).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.subscribe).toHaveBeenCalledOnce();
    expect(h.watch).toHaveBeenCalledOnce();
  });

  it('cancels both retry waits without reconnecting after shutdown', async () => {
    const h = harness();
    h.subscribe.mockRejectedValueOnce(new Error('events unavailable'));
    h.watch.mockRejectedValueOnce(new Error('imports unavailable'));
    const stop = h.start();
    await settle();
    expect(h.preference.getSnapshot().ready).toBe(false);
    expect(vi.getTimerCount()).toBe(2);

    stop();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.subscribe).toHaveBeenCalledOnce();
    expect(h.watch).toHaveBeenCalledOnce();
    expect(h.preference.refresh).not.toHaveBeenCalled();
  });

  it('gates preference readiness on subscription failure and refreshes on each reconnection', async () => {
    const h = harness();
    h.subscribe.mockRejectedValueOnce(new Error('events unavailable'));
    h.start();
    await settle();
    expect(h.preference.cancel).toHaveBeenCalledOnce();
    expect(h.preference.getSnapshot().ready).toBe(false);
    expect(h.preference.refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(999);
    expect(h.subscribe).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.preference.refresh).toHaveBeenCalledOnce();
    expect(h.preference.getSnapshot().ready).toBe(true);

    h.events[0]!.end();
    await settle();
    expect(h.preference.getSnapshot().ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.preference.refresh).toHaveBeenCalledTimes(2);
    expect(h.preference.getSnapshot().ready).toBe(true);
    expect(h.watch).toHaveBeenCalledOnce();
  });

  it('ignores subscription responses arriving after stop', async () => {
    const h = harness();
    const pendingEvents = Promise.withResolvers<Awaited<ReturnType<typeof h.subscribe>>>();
    const pendingImports = Promise.withResolvers<Awaited<ReturnType<typeof h.watch>>>();
    h.subscribe.mockReturnValueOnce(pendingEvents.promise);
    h.watch.mockReturnValueOnce(pendingImports.promise);
    const stop = h.start();
    stop();
    pendingEvents.resolve(
      (async function* () {
        yield command();
      })(),
    );
    pendingImports.resolve(
      (async function* () {
        yield { sessions: [importSession({ status: 'completed' })] };
      })(),
    );
    await settle();
    expect(h.preference.refresh).not.toHaveBeenCalled();
    expect(h.sounds.play).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('sound stream reconnection', () => {
  it('seeds initial and recovered import snapshots without replaying completion', async () => {
    const h = harness();
    h.start();
    await settle();
    const previous = importSession();
    const historical = importSession({ status: 'completed', finishedAt: 1 });
    h.imports[0]!.push({ sessions: [previous, historical] });
    await settle();
    expect(h.sounds.play).not.toHaveBeenCalled();

    h.imports[0]!.fail();
    await settle();
    expect(h.preference.cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    const active = importSession();
    const completed = { ...previous, status: 'completed' as const, finishedAt: 2 };
    h.imports[1]!.push({ sessions: [completed, historical, active] });
    await settle();
    expect(h.sounds.play).not.toHaveBeenCalled();

    const snapshot = { sessions: [completed, { ...active, status: 'completed' as const, finishedAt: 3 }] };
    h.imports[1]!.push(snapshot);
    await settle();
    h.imports[1]!.push(snapshot);
    await settle();
    expect(h.sounds.play.mock.calls).toEqual([['importDone', `import:${active.id}:3`]]);
  });

  it('forgets active transfer history across a failed event connection', async () => {
    const h = harness();
    h.start();
    await settle();
    const run = cableRun();
    const file = wifiFile();
    h.events[0]!.push({ type: 'transfer.deviceRun', at: 1, payload: run });
    await settle();
    h.events[0]!.push({ type: 'transfer.file', at: 1, payload: file });
    await settle();
    h.events[0]!.fail();
    await settle();
    expect(h.preference.getSnapshot().ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    h.events[1]!.push({ type: 'transfer.deviceRun', at: 2, payload: { ...run, state: 'succeeded' } });
    await settle();
    h.events[1]!.push({ type: 'transfer.file', at: 2, payload: { ...file, state: 'imported' } });
    await settle();
    expect(h.sounds.play).not.toHaveBeenCalled();

    const active = cableRun();
    h.events[1]!.push({ type: 'transfer.deviceRun', at: 3, payload: active });
    await settle();
    h.events[1]!.push({ type: 'transfer.deviceRun', at: 4, payload: { ...active, state: 'succeeded' } });
    await settle();
    expect(h.sounds.play.mock.calls).toEqual([['importDone', `cable:${active.id}`]]);
  });
});
