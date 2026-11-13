// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-HW: a plan's `foldInto` (core's budgetClass). Where there's no Neural Engine, npu jobs (OCR) run on the GPU
 * and draw on the gpu budget: gpu and npu jobs together never pass it, the npu budget is ignored, lanes keep their
 * limits, and the two classes are claimed in one order (priority, then age), so neither starves the other.
 */
import type { JobConcurrencyPlan, JobLane } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { defineJob, type ResourceClass } from '../../src/index';
import { Slots } from '../../src/queue/slots';
import { defaultThrottle } from '../../src/queue/policy';
import { deferred, steppingStore, testEngine, waitFor } from './helpers';

const PLAN: JobConcurrencyPlan = {
  classes: { cpu: 4, gpu: 2, npu: 3, video: 2, io: 4, network: 4 },
  lanes: { 'vision.ocr': 1 },
  foldInto: { npu: 'gpu' },
};

function gate() {
  const running = new Map<string, number>();
  const peaks = new Map<string, number>();
  const gates: { kind: string; open: () => void }[] = [];
  const started: string[] = [];
  const bump = (key: string, by: number) => {
    running.set(key, (running.get(key) ?? 0) + by);
    peaks.set(key, Math.max(peaks.get(key) ?? 0, running.get(key) ?? 0));
  };
  const job = (kind: string, resourceClass: ResourceClass, lane?: JobLane) =>
    defineJob({
      kind,
      resourceClass,
      ...(lane ? { lane } : {}),
      handler: async (payload: { n: number }) => {
        started.push(`${kind}#${payload.n}`);
        bump('pool', 1);
        bump(kind, 1);
        const open = deferred();
        gates.push({ kind, open: open.resolve });
        await open.promise;
        bump('pool', -1);
        bump(kind, -1);
      },
    });
  const release = (kind?: string) => {
    const at = gates.findIndex((g) => kind === undefined || g.kind === kind);
    if (at >= 0) gates.splice(at, 1).forEach((g) => g.open());
  };
  return {
    job,
    release,
    started,
    running: (k: string) => running.get(k) ?? 0,
    peak: (k: string) => peaks.get(k) ?? 0,
  };
}

describe('job engine: folded classes (LNX1)', () => {
  it('runs gpu and npu jobs in the gpu budget together; the npu budget is ignored, lanes still apply', async () => {
    const t = gate();
    const { engine, ofType } = testEngine({ store: steppingStore() });
    const embed = t.job('test.embed', 'gpu', 'vision.embedder');
    const whisper = t.job('test.whisper', 'gpu', 'audio.whisper');
    const ocr = t.job('test.ocr', 'npu', 'vision.ocr');
    for (const kind of [embed, whisper, ocr]) engine.register(kind);
    engine.applyPlan(PLAN);
    expect(ofType('queue.limits_changed').at(-1)).toMatchObject({ foldInto: { npu: 'gpu' } });
    await engine.start();
    for (let n = 0; n < 3; n++) {
      await engine.enqueue(ocr, { n });
      await engine.enqueue(embed, { n });
      await engine.enqueue(whisper, { n });
    }
    await waitFor(() => t.running('pool') === 2, 3000, 'two jobs in the gpu budget');
    await new Promise((r) => setTimeout(r, 40));
    expect(t.running('pool')).toBe(2);
    while (engine.running().length > 0) {
      t.release();
      await new Promise((r) => setTimeout(r, 5));
    }
    await engine.whenIdle();
    expect(t.peak('pool')).toBe(2);
    expect(t.peak('test.ocr')).toBe(1);
    expect(t.started).toHaveLength(9);
  });

  it('claims across the folded classes by priority, so OCR is not starved by gpu work listed first', async () => {
    const t = gate();
    const { engine } = testEngine({ store: steppingStore() });
    const embed = t.job('test.embed', 'gpu');
    const ocr = t.job('test.ocr', 'npu');
    engine.register(embed);
    engine.register(ocr);
    engine.applyPlan({ ...PLAN, classes: { ...PLAN.classes, gpu: 1 } });
    for (let n = 0; n < 3; n++) await engine.enqueue(embed, { n });
    await engine.enqueue(ocr, { n: 0 }, { priority: 10 });
    await engine.start();
    await waitFor(() => t.started.length === 1);
    expect(t.started).toEqual(['test.ocr#0']);
    t.release('test.ocr');
    await waitFor(() => t.started.length === 2);
    expect(t.started[1]).toBe('test.embed#0');
    while (engine.running().length > 0) {
      t.release();
      await new Promise((r) => setTimeout(r, 5));
    }
  });

  it('without a fold each class keeps its own budget', async () => {
    const t = gate();
    const { engine, ofType } = testEngine({ store: steppingStore() });
    const embed = t.job('test.embed', 'gpu');
    const ocr = t.job('test.ocr', 'npu');
    engine.register(embed);
    engine.register(ocr);
    const { foldInto: _fold, ...unfolded } = PLAN;
    engine.applyPlan(PLAN);
    engine.applyPlan(unfolded);
    // Dropping the fold alone is a change.
    expect(ofType('queue.limits_changed').at(-1)).not.toHaveProperty('foldInto');
    await engine.start();
    for (let n = 0; n < 4; n++) {
      await engine.enqueue(embed, { n });
      await engine.enqueue(ocr, { n });
    }
    await waitFor(() => t.running('pool') === 5, 3000, 'gpu 2 plus npu 3');
    while (engine.running().length > 0) {
      t.release();
      await new Promise((r) => setTimeout(r, 5));
    }
  });

  it('groups the classes into pools, the throttled target budget deciding', () => {
    const slots = new Slots(PLAN, defaultThrottle, () => ({ onBattery: false, thermalState: 'nominal' }));
    expect(slots.pools()).toEqual([['cpu'], ['gpu', 'npu'], ['video'], ['io'], ['network']]);
    const gpuJob = { resourceClass: 'gpu' as const };
    const npuJob = { resourceClass: 'npu' as const };
    expect(slots.classHasRoom('npu', [gpuJob])).toBe(true);
    expect(slots.classHasRoom('npu', [gpuJob, npuJob])).toBe(false);
    expect(slots.classHasRoom('gpu', [npuJob, npuJob])).toBe(false);
    expect(slots.classHasRoom('cpu', [gpuJob, npuJob])).toBe(true);
    const battery = new Slots(PLAN, defaultThrottle, () => ({ onBattery: true, thermalState: 'nominal' }));
    expect(battery.classHasRoom('npu', [gpuJob])).toBe(false);
  });
});
