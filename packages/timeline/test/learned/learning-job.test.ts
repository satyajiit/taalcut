// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The learning job over a log and a memory store that behave like the app's: the learner's writes land in the log
 * as memory commands, so the next run sees them the way the real bus records them.
 */
import {
  MEMORY_COMMANDS,
  memoryCommandPayloads,
  newId,
  ok,
  type AuditEntry,
  type CommandListener,
  type CommandOrigin,
  type MemoryItemView,
  castingWeightsText,
} from '@taalcut/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CASTING_CONFIG } from '../../src/casting/config';
import { createCastingLearner, followCastingSignals } from '../../src/casting/learned/learning-job';
import { scoredCandidate } from '../../src/test-support';
import { cast, clock, deleteEntry, parts, slot, swapEntry, type LogClock } from './log-fixture';

function app() {
  const time = clock();
  const log: AuditEntry[] = [];
  const items: MemoryItemView[] = [];
  const dispatched: { name: string; origin: CommandOrigin }[] = [];
  const record = (name: string, payload: unknown, origin: CommandOrigin) =>
    log.push({
      id: newId<'Command'>(),
      projectId: null,
      name,
      payload,
      inverse: null,
      source: origin.source,
      actor: origin.actor,
      sideEffect: 'write',
      createdAt: (time.at += 10),
      idempotencyKey: null,
      result: null,
      sequence: ++time.sequence,
      undone: false,
    });
  const learner = createCastingLearner({
    log: { entries: async (names) => ok(log.filter((entry) => names.includes(entry.name))) },
    store: { list: async () => ok(items.slice(0, 1)) },
    commands: {
      async dispatch(name, payload, origin) {
        dispatched.push({ name, origin });
        record(name, payload, origin);
        if (name === MEMORY_COMMANDS.create) {
          const { memoryId, item } = memoryCommandPayloads[MEMORY_COMMANDS.create].parse(payload);
          items.unshift({
            ...item,
            id: memoryId,
            revision: 1,
            createdAt: time.at,
            updatedAt: time.at,
            scopeName: null,
          });
        } else {
          const { patch } = memoryCommandPayloads[MEMORY_COMMANDS.update].parse(payload);
          const current = items[0];
          if (!current) throw new Error('an update with no item to update');
          items[0] = { ...current, ...patch, revision: current.revision + 1, updatedAt: time.at };
        }
        return ok(undefined);
      },
    },
  });
  return { time, log, items, dispatched, learner };
}

/** A person swapping to the alternate with the most motion match, `count` times. */
function swapsTowardMotion(time: LogClock, count: number): AuditEntry[] {
  return Array.from({ length: count }, () => {
    const moving = scoredCandidate(parts({ motion: 1, intent: 0.3 }));
    const at = slot(scoredCandidate(parts({ intent: 0.6, motion: 0 })), [
      moving,
      scoredCandidate(parts({ quality: 0.9 })),
    ]);
    return swapEntry(time, cast([at]), at, moving);
  });
}

describe('createCastingLearner', () => {
  it('writes nothing until the pairs weigh enough, then creates one learned item in the user scope', async () => {
    const { time, log, items, learner } = app();
    log.push(...swapsTowardMotion(time, 5));
    const few = await learner.run();
    expect(few.ok && few.value.outcome).toBe('too-few');
    expect(items).toEqual([]);

    log.push(...swapsTowardMotion(time, 5));
    const enough = await learner.run();
    if (!enough.ok) throw new Error(enough.error.code);
    expect(enough.value.outcome).toBe('created');
    const [item] = items;
    if (!item) throw new Error('nothing learned');
    expect(item).toMatchObject({ scope: { kind: 'user' }, source: 'learned' });
    expect(item.data).toMatchObject({ kind: 'casting-weights', configVersion: 'casting.v5', pairs: 20 });
    expect(item.data?.kind === 'casting-weights' && item.data.weights.motion).toBeGreaterThan(
      CASTING_CONFIG.weights.motion,
    );
    expect(item.text).toBe(
      item.data?.kind === 'casting-weights'
        ? castingWeightsText(item.data.weights, CASTING_CONFIG.weights)
        : '',
    );
  });

  it("doesn't write again for the same log, and updates over the revision it read when more pairs come", async () => {
    const { time, log, items, dispatched, learner } = app();
    log.push(...swapsTowardMotion(time, 12));
    await learner.run();
    const again = await learner.run();
    expect(again.ok && again.value.outcome).toBe('unchanged');
    log.push(...swapsTowardMotion(time, 40));
    const more = await learner.run();
    expect(more.ok && more.value.outcome).toBe('updated');
    expect(items[0]?.revision).toBe(2);
    expect(dispatched.map((entry) => entry.origin)).toEqual([
      { source: 'agent', actor: 'casting:learner' },
      { source: 'agent', actor: 'casting:learner' },
    ]);
  });

  it('starts over from the defaults after a reset, and learns only from what comes next', async () => {
    const { time, log, items, learner } = app();
    log.push(...swapsTowardMotion(time, 12));
    await learner.run();
    const [learned] = items;
    if (!learned) throw new Error('nothing learned');
    log.push(deleteEntry(time, learned.id));
    items.length = 0;
    const after = await learner.run();
    expect(after.ok && after.value).toMatchObject({
      outcome: 'too-few',
      weights: CASTING_CONFIG.weights,
      pairs: 0,
    });
    expect(items).toEqual([]);
  });
});

describe('followCastingSignals', () => {
  afterEach(() => vi.useRealTimers());

  it("learns a few seconds after a person's swap, once for a burst, and never for the agent's", async () => {
    vi.useFakeTimers();
    const listeners: CommandListener[] = [];
    const run = vi.fn(async () =>
      ok({ outcome: 'unchanged' as const, weights: CASTING_CONFIG.weights, evidence: 0, pairs: 0 }),
    );
    const follow = followCastingSignals(
      { subscribe: (listener) => (listeners.push(listener), () => listeners.splice(0)) },
      { run },
      { delayMs: 5_000, onError: () => undefined },
    );
    const change = (name: string, source: CommandOrigin['source']) =>
      listeners.forEach((listener) =>
        listener({
          kind: 'executed',
          id: newId<'Command'>(),
          name,
          projectId: null,
          origin: { source, actor: 'x' },
        }),
      );
    change('timeline.swapClip', 'ui');
    vi.advanceTimersByTime(3_000);
    change('timeline.dropSlot', 'shortcut');
    change('timeline.swapClip', 'agent');
    change('timeline.trimClip', 'ui');
    vi.advanceTimersByTime(4_999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await follow.idle();
    expect(run).toHaveBeenCalledTimes(1);
    change('timeline.swapClip', 'agent');
    vi.advanceTimersByTime(10_000);
    await follow.idle();
    expect(run).toHaveBeenCalledTimes(1);
    follow.stop();
  });

  it('reports a run that throws as a failed run, and learns again at the next signal', async () => {
    vi.useFakeTimers();
    const listeners: CommandListener[] = [];
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('the log could not be folded'))
      .mockResolvedValue(
        ok({ outcome: 'unchanged' as const, weights: CASTING_CONFIG.weights, evidence: 0, pairs: 0 }),
      );
    const errors: string[] = [];
    const follow = followCastingSignals(
      { subscribe: (listener) => (listeners.push(listener), () => listeners.splice(0)) },
      { run },
      { delayMs: 5_000, onError: (error) => void errors.push(error.detail ?? error.code) },
    );
    const swap = () =>
      listeners.forEach((listener) =>
        listener({
          kind: 'executed',
          id: newId<'Command'>(),
          name: 'timeline.swapClip',
          projectId: null,
          origin: { source: 'ui', actor: 'x' },
        }),
      );
    swap();
    vi.advanceTimersByTime(5_000);
    await follow.idle();
    expect(errors).toHaveLength(1);
    swap();
    vi.advanceTimersByTime(5_000);
    await follow.idle();
    expect(run).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(1);
    follow.stop();
  });
});
