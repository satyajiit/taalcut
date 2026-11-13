// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-S1: lanes inside class budgets. Jobs block on gates the test opens, so every count is exact; the store
 * runs on a stepping clock, so claim order never depends on wall time.
 */
import { defineJobKind, ok, type JobLane } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEngineJobRunner, defineJob, fromJobKind, type ResourceClass } from '../../src/index';
import { deferred, fakePower, steppingStore, testEngine, waitFor } from './helpers';

/** Counts running jobs per kind, lane and class, and their peaks. */
function tracker() {
  const running = new Map<string, number>();
  const peaks = new Map<string, number>();
  const gates: { key: string; open: () => void }[] = [];
  const started: string[] = [];
  const bump = (key: string, by: number) => {
    const next = (running.get(key) ?? 0) + by;
    running.set(key, next);
    peaks.set(key, Math.max(peaks.get(key) ?? 0, next));
  };
  return {
    started,
    running: (key: string) => running.get(key) ?? 0,
    peak: (key: string) => peaks.get(key) ?? 0,
    /** Opens the oldest gate of `key` (a kind), or of any kind. */
    release(key?: string) {
      const at = gates.findIndex((g) => key === undefined || g.key === key);
      if (at >= 0) gates.splice(at, 1).forEach((gate) => gate.open());
    },
    async hold(kind: string, keys: readonly string[], label: string) {
      started.push(label);
      for (const key of keys) bump(key, 1);
      const gate = deferred();
      gates.push({ key: kind, open: gate.resolve });
      await gate.promise;
      for (const key of keys) bump(key, -1);
    },
  };
}

type Tracker = ReturnType<typeof tracker>;

function gated(t: Tracker, kind: string, resourceClass: ResourceClass, lane?: JobLane) {
  return defineJob({
    kind,
    resourceClass,
    ...(lane ? { lane } : {}),
    handler: async (payload: { n: number }) => {
      await t.hold(kind, [kind, resourceClass, ...(lane ? [lane] : [])], `${kind}#${payload.n}`);
    },
  });
}

async function drain(t: Tracker, engine: { running(): unknown[] }) {
  while (engine.running().length > 0) {
    t.release();
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('job engine: lanes inside class budgets', () => {
  it('runs two lanes of one class side by side, one job per lane', async () => {
    const t = tracker();
    const { engine } = testEngine({ store: steppingStore(), concurrency: { gpu: 2 } });
    const embed = gated(t, 'test.embed', 'gpu', 'vision.embedder');
    const whisper = gated(t, 'test.whisper', 'gpu', 'audio.whisper');
    engine.register(embed);
    engine.register(whisper);
    await engine.start();
    for (let n = 0; n < 3; n++) await engine.enqueue(embed, { n });
    for (let n = 0; n < 3; n++) await engine.enqueue(whisper, { n });
    await waitFor(() => t.running('gpu') === 2, 3000, 'embedder and whisper together');
    expect(t.running('vision.embedder')).toBe(1);
    expect(t.running('audio.whisper')).toBe(1);
    // A full lane's queued jobs stay queued while the class has room.
    await new Promise((r) => setTimeout(r, 40));
    expect(t.running('gpu')).toBe(2);
    await drain(t, engine);
    await engine.whenIdle();
    expect(t.peak('vision.embedder')).toBe(1);
    expect(t.peak('audio.whisper')).toBe(1);
    expect(t.peak('gpu')).toBe(2);
    expect(t.started).toHaveLength(6);
  });

  it('never runs a lane over its limit, and fills the rest of the budget with other work', async () => {
    const t = tracker();
    const { engine } = testEngine({
      store: steppingStore(),
      concurrency: { gpu: 4 },
      lanes: { 'vision.embedder': 2 },
    });
    const embed = gated(t, 'test.embed', 'gpu', 'vision.embedder');
    const shader = gated(t, 'test.shader', 'gpu');
    engine.register(embed);
    engine.register(shader);
    await engine.start();
    for (let n = 0; n < 5; n++) await engine.enqueue(embed, { n });
    for (let n = 0; n < 5; n++) await engine.enqueue(shader, { n });
    await waitFor(() => t.running('gpu') === 4, 3000, 'four gpu jobs');
    expect(t.running('vision.embedder')).toBe(2);
    expect(t.running('test.shader')).toBe(2);
    expect(engine.laneLimits()).toEqual({ 'vision.embedder': 2 });
    await drain(t, engine);
    expect(t.peak('vision.embedder')).toBe(2);
    expect(t.peak('gpu')).toBe(4);
  });

  it('keeps every lane inside its class budget, whatever the lane limits say', async () => {
    const t = tracker();
    const { engine } = testEngine({
      store: steppingStore(),
      concurrency: { gpu: 2 },
      lanes: { 'vision.embedder': 3, 'audio.whisper': 3 },
    });
    const embed = gated(t, 'test.embed', 'gpu', 'vision.embedder');
    const whisper = gated(t, 'test.whisper', 'gpu', 'audio.whisper');
    engine.register(embed);
    engine.register(whisper);
    await engine.start();
    for (let n = 0; n < 4; n++) {
      await engine.enqueue(embed, { n });
      await engine.enqueue(whisper, { n });
    }
    await waitFor(() => t.running('gpu') === 2);
    await new Promise((r) => setTimeout(r, 40));
    expect(t.running('gpu')).toBe(2);
    await drain(t, engine);
    expect(t.peak('gpu')).toBe(2);
  });

  it('lets the throttle lower class budgets only: on battery the two lanes take turns', async () => {
    const t = tracker();
    const power = fakePower();
    const { engine, ofType } = testEngine({ store: steppingStore(), power, concurrency: { gpu: 2 } });
    const embed = gated(t, 'test.embed', 'gpu', 'vision.embedder');
    const whisper = gated(t, 'test.whisper', 'gpu', 'audio.whisper');
    engine.register(embed);
    engine.register(whisper);
    await engine.start();
    for (let n = 0; n < 3; n++) {
      await engine.enqueue(embed, { n });
      await engine.enqueue(whisper, { n });
    }
    await waitFor(() => t.running('gpu') === 2);
    power.set({ onBattery: true });
    expect(engine.limits().gpu).toBe(1);
    expect(engine.laneLimits()).toEqual({});
    expect(ofType('queue.limits_changed').at(-1)).toMatchObject({
      limits: { gpu: 1 },
      lanes: {},
      power: { onBattery: true },
    });
    // Running jobs finish; after that, one gpu job at a time.
    t.release('test.embed');
    t.release('test.whisper');
    await waitFor(() => t.running('gpu') === 1, 3000, 'one gpu job on battery');
    await new Promise((r) => setTimeout(r, 40));
    expect(t.running('gpu')).toBe(1);
    power.set({ onBattery: false });
    await waitFor(() => t.running('gpu') === 2, 3000, 'two again on AC');
    await drain(t, engine);
  });

  it('never lets a full lane hold up another lane: the next free slot goes to the oldest claimable job', async () => {
    const t = tracker();
    const { engine } = testEngine({ store: steppingStore(), concurrency: { gpu: 2 } });
    const embed = gated(t, 'test.embed', 'gpu', 'vision.embedder');
    const whisper = gated(t, 'test.whisper', 'gpu', 'audio.whisper');
    const beats = gated(t, 'test.beats', 'gpu', 'audio.beats');
    engine.register(embed);
    engine.register(whisper);
    engine.register(beats);
    // Embedder jobs first and at high priority: the lane is full after one, so whisper still starts.
    for (let n = 0; n < 4; n++) await engine.enqueue(embed, { n }, { priority: 10 });
    await engine.enqueue(whisper, { n: 0 });
    await engine.enqueue(beats, { n: 0 });
    await engine.start();
    await waitFor(() => t.running('gpu') === 2);
    expect(t.started).toEqual(['test.embed#0', 'test.whisper#0']);
    // Whisper's slot frees: beats (the oldest job whose lane has room) takes it, not a queued embed.
    t.release('test.whisper');
    await waitFor(() => t.started.length === 3);
    expect(t.started[2]).toBe('test.beats#0');
    // The embedder's slot frees: its next job, by priority and then age.
    t.release('test.embed');
    await waitFor(() => t.started.length === 4);
    expect(t.started[3]).toBe('test.embed#1');
    await drain(t, engine);
    expect(t.started).toEqual([
      'test.embed#0',
      'test.whisper#0',
      'test.beats#0',
      'test.embed#1',
      'test.embed#2',
      'test.embed#3',
    ]);
  });

  it('applies a new plan to what starts next and says so', async () => {
    const t = tracker();
    const { engine, ofType } = testEngine({ store: steppingStore() });
    const embed = gated(t, 'test.embed', 'gpu', 'vision.embedder');
    const whisper = gated(t, 'test.whisper', 'gpu', 'audio.whisper');
    engine.register(embed);
    engine.register(whisper);
    await engine.start();
    for (let n = 0; n < 2; n++) {
      await engine.enqueue(embed, { n });
      await engine.enqueue(whisper, { n });
    }
    await waitFor(() => t.running('gpu') === 1);
    await new Promise((r) => setTimeout(r, 40));
    expect(t.running('gpu')).toBe(1); // DEFAULT_CONCURRENCY: gpu 1
    const plan = {
      classes: { cpu: 3, gpu: 2, npu: 1, video: 2, io: 4, network: 4 },
      lanes: { 'vision.embedder': 1, 'audio.whisper': 1 },
    };
    engine.applyPlan(plan);
    expect(engine.limits()).toEqual(plan.classes);
    expect(ofType('queue.limits_changed').at(-1)).toMatchObject({ limits: plan.classes, lanes: plan.lanes });
    await waitFor(() => t.running('gpu') === 2, 3000, 'the new budget');
    const events = ofType('queue.limits_changed').length;
    engine.applyPlan(plan); // nothing changed: no event
    expect(ofType('queue.limits_changed')).toHaveLength(events);
    await drain(t, engine);
    expect(t.peak('gpu')).toBe(2);
  });

  it("claims a running job's child at once even when its lane is full", async () => {
    const t = tracker();
    const { engine } = testEngine({ store: steppingStore(), concurrency: { gpu: 2 } });
    const childKind = defineJobKind({
      kind: 'test.childEmbed',
      input: z.object({ n: z.number() }),
      output: z.object({ n: z.number() }),
      resource: 'gpu',
      lane: 'vision.embedder',
    });
    const runner = createEngineJobRunner(engine);
    engine.register(
      fromJobKind(childKind, async (input) => {
        t.started.push(`child#${input.n}`);
        return ok(input);
      }),
    );
    const parent = defineJob({
      kind: 'test.parentEmbed',
      resourceClass: 'gpu',
      lane: 'vision.embedder',
      handler: async (_payload: object, _signal, _progress, context) => {
        t.started.push('parent');
        return runner.run(childKind, { n: 1 }, { parentJobId: context.jobId });
      },
    });
    engine.register(parent);
    await engine.start();
    const queued = await engine.enqueue(parent, {});
    if (!queued.ok) throw new Error(queued.error.code);
    const done = await engine.wait(queued.value.job.id);
    expect(done).toMatchObject({ ok: true, value: { state: 'succeeded' } });
    expect(t.started).toEqual(['parent', 'child#1']);
  });

  it('maps a core kind’s lane and refuses a lane that is not <package>.<camelCase>', () => {
    const kind = defineJobKind({
      kind: 'test.laned',
      input: z.object({}),
      output: z.object({}),
      resource: 'gpu',
      lane: 'audio.whisper',
    });
    const unlaned = defineJobKind({
      kind: 'test.plain',
      input: z.object({}),
      output: z.object({}),
      resource: 'cpu',
    });
    expect(fromJobKind(kind, async () => ok({})).lane).toBe('audio.whisper');
    expect('lane' in fromJobKind(unlaned, async () => ok({}))).toBe(false);
    expect(() =>
      defineJob({ kind: 'test.bad', resourceClass: 'gpu', lane: 'Whisper', handler: async () => undefined }),
    ).toThrow("Job kind 'test.bad' names an invalid lane 'Whisper'");
  });
});
