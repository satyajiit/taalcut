// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * G8's follower: a run waiting for a limit is resumed by a timer when it lifts (also after a restart, from
 * the log); while it waits the usage limits show the run waiting; each outcome is `rateLimit.met` telemetry.
 */
import { unwrap, type TelemetryEvent } from '@taalcut/core';
import { createMemoryEventLogStore, createRateLimitFollower, type TimerPort } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { harness } from '../support/harness';
import { PRICES, rateLimited } from './limit-fixtures';

const NOW = 1_800_000_000_000;

function fakeTimers() {
  const pending: { run: () => void; ms: number; cleared: boolean }[] = [];
  const timers: TimerPort = {
    set(run, ms) {
      const timer = { run, ms, cleared: false };
      pending.push(timer);
      return timer;
    },
    clear(handle) {
      const timer = pending.find((t) => t === handle);
      if (timer) timer.cleared = true;
    },
  };
  const fire = () => {
    const due = pending.filter((t) => !t.cleared);
    pending.length = 0;
    for (const timer of due) timer.run();
  };
  return { timers, pending, fire };
}

function world(store = createMemoryEventLogStore()) {
  let now = NOW;
  const h = harness({
    script: (request) => (request.target || now > NOW ? { text: 'Done.' } : rateLimited(NOW + 60_000)),
    store,
    now: () => now,
    settings: { autonomy: 'before-render' },
    deps: { prices: PRICES },
  });
  const telemetry: TelemetryEvent[] = [];
  const held: string[] = [];
  const released: string[] = [];
  const timers = fakeTimers();
  const follower = createRateLimitFollower({
    agent: h.agent,
    log: store,
    telemetry: { record: (event) => telemetry.push(event) },
    limits: {
      hold: (provider) => {
        held.push(provider);
        return () => released.push(provider);
      },
    },
    now: () => now,
    timers: timers.timers,
  });
  return { ...h, follower, telemetry, held, released, timers, advance: (ms: number) => (now += ms) };
}

async function waitingRun(w: ReturnType<typeof world>) {
  const paused = unwrap(await w.agent.run({ conversationId: 'c1', message: 'Cut it.' }));
  const requestId = paused.pending[0]!.requestId;
  unwrap(
    await w.agent.answer(paused.runId, {
      requestId,
      decision: 'approve',
      answer: { kind: 'rateLimit', choice: 'wait' },
    }),
  );
  return paused.runId;
}

/** Lets the resume the timer started finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('the rate-limit follower', () => {
  it('times a waiting run for when the limit lifts and resumes it then', async () => {
    const w = world();
    const runId = await waitingRun(w);
    expect(w.timers.pending.filter((t) => !t.cleared).map((t) => t.ms)).toEqual([60_000]);
    expect(w.held).toEqual(['openai']);
    w.advance(60_001);
    w.timers.fire();
    await settle();
    const done = unwrap(await w.agent.wait(runId));
    expect(done.status).toBe('completed');
    expect(w.released).toEqual(['openai']);
    expect(w.telemetry).toEqual([
      { name: 'rateLimit.met', module: 'agent', reason: 'rate', outcome: 'waited' },
    ]);
    w.follower.close();
  });

  it('after a restart, finds the waiting run in the log and times it again', async () => {
    const store = createMemoryEventLogStore();
    const before = world(store);
    const runId = await waitingRun(before);
    before.follower.close();
    expect(before.timers.pending.every((t) => t.cleared)).toBe(true);
    const after = world(store);
    await after.follower.start();
    expect(after.timers.pending.map((t) => t.ms)).toEqual([60_000]);
    after.advance(61_000);
    after.timers.fire();
    await settle();
    expect(unwrap(await after.agent.wait(runId)).status).toBe('completed');
    after.follower.close();
  });

  it('records a switch and a stop', async () => {
    const w = world();
    const switched = unwrap(await w.agent.run({ conversationId: 'c1', message: 'Cut it.' }));
    unwrap(
      await w.agent.answer(switched.runId, {
        requestId: switched.pending[0]!.requestId,
        decision: 'approve',
        answer: {
          kind: 'rateLimit',
          choice: 'switch',
          model: { provider: 'anthropic', model: 'claude-sonnet-5' },
        },
      }),
    );
    const stopped = unwrap(await w.agent.run({ conversationId: 'c2', message: 'Cut it.' }));
    unwrap(
      await w.agent.answer(stopped.runId, { requestId: stopped.pending[0]!.requestId, decision: 'deny' }),
    );
    expect(w.telemetry.map((e) => (e.name === 'rateLimit.met' ? e.outcome : e.name))).toEqual([
      'switched',
      'stopped',
    ]);
    // Each asking card held the provider; the answer released it.
    expect(w.held).toEqual(['openai', 'openai']);
    expect(w.released).toEqual(['openai', 'openai']);
    w.follower.close();
  });
});
