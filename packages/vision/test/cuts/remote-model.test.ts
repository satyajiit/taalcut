// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-S2: the shot-boundary model in a process of its own, with fakes (helpers/model-pair.ts; a real Node child:
 * model-channels.test.ts; the live model: integration/model-process.test.ts). Its lifecycle: nothing starts
 * before the first window and one process serves every job; it ends after `idleMs` without a window and the
 * next window starts another; a process that fails to start, never says it is ready or is lost mid-run fails the
 * windows as `vision.shot_model_failed` (the job's scdet fallback) and the next job starts one again; a
 * cancelled window stops waiting at once and sends nothing more.
 */
import { err, ok, type AsyncResult, type ComputeFallbackEvent } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { remoteShotModel, type RemoteShotModelOptions } from '../../src/cuts/remote-model';
import type { ShotBoundaryModel } from '../../src/cuts/transnet';
import { ShotModelFailed } from '../../src/errors';
import { pictureChangeModel } from '../../src/test-support';
import {
  grayWindow,
  manualTimers,
  modelPair,
  settle,
  stuckModel,
  type ModelPair,
} from '../helpers/model-pair';

const IDLE = 120_000;
const START = 30_000;

/** A remote model whose processes are model pairs serving what `open` gives, with the pairs it started. */
function harness(
  open: (modelDir: string) => AsyncResult<ShotBoundaryModel> = async () => ok(pictureChangeModel()),
  overrides: Partial<RemoteShotModelOptions> = {},
) {
  const timers = manualTimers();
  const pairs: ModelPair[] = [];
  const fallbacks: ComputeFallbackEvent[] = [];
  const remote = remoteShotModel({
    start: async () => {
      const pair = modelPair(open);
      pairs.push(pair);
      return ok(pair.channel);
    },
    modelDir: async () => '/components/transnetv2',
    idleMs: IDLE,
    startMs: START,
    expectedBackend: 'webgpu',
    onFallback: (event) => fallbacks.push(event),
    timers,
    ...overrides,
  });
  const lease = async () => {
    const loaded = await remote.load();
    if (!loaded.ok) throw new Error(loaded.error.code);
    return loaded.value;
  };
  return { remote, timers, pairs, fallbacks, lease };
}

describe('remoteShotModel', () => {
  it('starts nothing until the first window, then serves every job from one process', async () => {
    const { pairs, lease } = harness();
    const [a, b] = [await lease(), await lease()];
    expect(pairs).toHaveLength(0);
    expect(a.backend).toBe('webgpu');
    const windows = [grayWindow([0, 0, 200]), grayWindow([90, 90, 90, 0])];
    const expected = await Promise.all(windows.map((w) => pictureChangeModel().predict(w)));
    const outputs = await Promise.all([a.predict(windows[0]!), b.predict(windows[1]!)]);
    expect(outputs).toEqual(expected);
    expect(outputs[0]?.ok && outputs[0].value.single[1]).toBe(1);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.sent.map((m) => m.type)).toEqual(['open', 'predict', 'predict']);
    expect(pairs[0]?.sent[0]).toEqual({ type: 'open', modelDir: '/components/transnetv2' });
    // The provider the process opened on, once it said so.
    expect([a.id, a.backend]).toEqual(['transnetv2', 'cpu']);
  });

  it("asks the process to open on the devices this process's probe chose", async () => {
    const { pairs, lease } = harness(undefined, {
      runtime: async () => ({ devices: ['cuda', 'webgpu', 'cpu'], cudaDeviceId: 1 }),
    });
    const model = await lease();
    await model.predict(grayWindow([0, 200]));
    expect(pairs[0]?.sent[0]).toEqual({
      type: 'open',
      modelDir: '/components/transnetv2',
      devices: ['cuda', 'webgpu', 'cpu'],
      cudaDeviceId: 1,
    });
  });

  it('is not there without its component, looked up again at the next job', async () => {
    let lookups = 0;
    const { remote, pairs } = harness(undefined, {
      modelDir: async () => {
        lookups += 1;
        return null;
      },
    });
    const loaded = await remote.load();
    expect(!loaded.ok && [loaded.error.code, loaded.error.detail]).toEqual([
      'vision.shot_model_failed',
      'transnetv2 is not installed',
    ]);
    await remote.load();
    expect([lookups, pairs.length]).toEqual([2, 0]);
  });

  it('ends after idleMs without a window, and the next window starts another', async () => {
    const { pairs, timers, lease } = harness();
    const model = await lease();
    expect((await model.predict(grayWindow([]))).ok).toBe(true);
    timers.advance(IDLE - 1);
    await settle();
    expect(pairs[0]?.sent.map((m) => m.type)).toEqual(['open', 'predict']);
    timers.advance(1);
    expect(await pairs[0]?.served).toBe('released');
    await settle();
    expect(pairs[0]?.closed).toBe(true);
    // The same job's next window (or the next job's) starts a new process.
    expect((await model.predict(grayWindow([]))).ok).toBe(true);
    expect(pairs).toHaveLength(2);
  });

  it('keeps the process while a window is in flight', async () => {
    const { pairs, timers, lease } = harness(async () => ok(stuckModel(pictureChangeModel())));
    const model = await lease();
    void model.predict(grayWindow([]));
    await settle();
    timers.advance(10 * IDLE);
    await settle();
    expect(pairs[0]?.sent.map((m) => m.type)).toEqual(['open', 'predict']);
    expect(pairs[0]?.closed).toBe(false);
  });

  it('fails the windows of a process lost mid-run, and that job’s later ones; the next job starts again', async () => {
    let opens = 0;
    const { pairs, lease } = harness(async () => {
      opens += 1;
      return ok(opens === 1 ? stuckModel(pictureChangeModel()) : pictureChangeModel());
    });
    const job = await lease();
    const running = job.predict(grayWindow([]));
    await settle();
    pairs[0]?.crash();
    const lost = await running;
    expect(!lost.ok && [lost.error.code, lost.error.detail]).toEqual([
      'vision.shot_model_failed',
      'the model port closed',
    ]);
    const later = await job.predict(grayWindow([]));
    expect(!later.ok && later.error.code).toBe('vision.shot_model_failed');
    expect(pairs).toHaveLength(1);
    const next = await lease();
    expect((await next.predict(grayWindow([]))).ok).toBe(true);
    expect(pairs).toHaveLength(2);
  });

  it('fails the window when the process can’t start, and tries again at the next job', async () => {
    let starts = 0;
    const { lease } = harness(undefined, {
      start: async () => {
        starts += 1;
        if (starts === 1) return err(ShotModelFailed(undefined, { detail: 'no utility process' }));
        return ok(modelPair(async () => ok(pictureChangeModel())).channel);
      },
    });
    const first = await (await lease()).predict(grayWindow([]));
    expect(!first.ok && [first.error.code, first.error.detail]).toEqual([
      'vision.shot_model_failed',
      'no utility process',
    ]);
    expect((await (await lease()).predict(grayWindow([]))).ok).toBe(true);
    expect(starts).toBe(2);
  });

  it('stops waiting for a process that never says it is ready, and lets it go', async () => {
    const { pairs, timers, lease } = harness(() => new Promise(() => undefined));
    const running = (await lease()).predict(grayWindow([]));
    await settle();
    timers.advance(START);
    const out = await running;
    expect(!out.ok && [out.error.code, out.error.detail]).toEqual([
      'vision.shot_model_failed',
      `the model did not say it was ready within ${START} ms`,
    ]);
    expect(pairs[0]?.closed).toBe(true);
    expect(await pairs[0]?.served).toBe('gone');
  });

  it('gives a model that fails to open as the model failing', async () => {
    const { lease } = harness(async () => err(ShotModelFailed(undefined, { detail: 'bad graph' })));
    const out = await (await lease()).predict(grayWindow([]));
    expect(!out.ok && [out.error.code, out.error.detail]).toEqual(['vision.shot_model_failed', 'bad graph']);
  });

  it('stops waiting for a cancelled window at once and sends nothing more for it', async () => {
    const { pairs, lease } = harness(async () => ok(stuckModel(pictureChangeModel())));
    const model = await lease();
    const aborted = new AbortController();
    aborted.abort();
    const before = await model.predict(grayWindow([]), aborted.signal);
    expect(!before.ok && before.error.code).toBe('core.cancelled');
    expect(pairs).toHaveLength(0);
    const later = new AbortController();
    const running = model.predict(grayWindow([]), later.signal);
    await settle();
    later.abort();
    const during = await running;
    expect(!during.ok && during.error.code).toBe('core.cancelled');
    // The process stays for the next job: nothing is killed for a cancel.
    expect(pairs[0]?.sent.map((m) => m.type)).toEqual(['open', 'predict']);
    expect(pairs[0]?.closed).toBe(false);
  });

  it('stops waiting for a cancelled window while its process is still starting', async () => {
    let answer: (channel: ReturnType<typeof modelPair>['channel']) => void = () => undefined;
    const { lease } = harness(undefined, {
      start: () => new Promise((resolve) => (answer = (channel) => resolve(ok(channel)))),
    });
    const starting = new AbortController();
    const first = (await lease()).predict(grayWindow([]), starting.signal);
    starting.abort();
    expect(await first).toEqual(err(expect.objectContaining({ code: 'core.cancelled' })));
    // Started, but the model not ready yet.
    const pair = modelPair(() => new Promise(() => undefined));
    answer(pair.channel);
    const opening = new AbortController();
    const second = (await lease()).predict(grayWindow([]), opening.signal);
    await settle();
    opening.abort();
    expect(await second).toEqual(err(expect.objectContaining({ code: 'core.cancelled' })));
    expect(pair.sent.map((m) => m.type)).toEqual(['open']);
  });

  it('ends a process whose only window was cancelled while it started, once idle', async () => {
    let answer: (channel: ReturnType<typeof modelPair>['channel']) => void = () => undefined;
    const { timers, lease } = harness(undefined, {
      start: () => new Promise((resolve) => (answer = (channel) => resolve(ok(channel)))),
    });
    const cancel = new AbortController();
    const window = (await lease()).predict(grayWindow([]), cancel.signal);
    cancel.abort();
    await window;
    const pair = modelPair(async () => ok(pictureChangeModel()));
    answer(pair.channel);
    await settle();
    timers.advance(IDLE);
    expect(await pair.served).toBe('released');
  });

  it('puts the process’s CPU fallback on the bus, and drops a process that sends anything else', async () => {
    const { pairs, fallbacks, lease } = harness(async () => ok(stuckModel(pictureChangeModel())));
    const running = (await lease()).predict(grayWindow([]));
    await settle();
    const event: ComputeFallbackEvent = {
      operation: 'vision.shotBoundaries',
      wanted: ['webgpu'],
      reason: 'no_accelerator',
    };
    pairs[0]?.post({ type: 'fallback', event });
    pairs[0]?.post({ type: 'output', id: 'one' });
    const out = await running;
    expect(fallbacks).toEqual([event]);
    expect(!out.ok && out.error.code).toBe('vision.shot_model_failed');
    expect(pairs[0]?.closed).toBe(true);
  });

  it('releases the running process on close', async () => {
    const { remote, pairs, lease } = harness();
    await (await lease()).predict(grayWindow([]));
    await remote.close();
    expect(await pairs[0]?.served).toBe('released');
    expect(pairs[0]?.closed).toBe(true);
  });
});

/** A channel whose start rejects: the window still fails as the model failing. */
describe('remoteShotModel with a start that throws', () => {
  it('fails the window as the model failing', async () => {
    const remote = remoteShotModel({
      start: () => Promise.reject(new Error('fork failed')),
      modelDir: async () => '/m',
      idleMs: IDLE,
      startMs: START,
      expectedBackend: 'webgpu',
      timers: manualTimers(),
    });
    const loaded = await remote.load();
    if (!loaded.ok) throw new Error(loaded.error.code);
    const out = await loaded.value.predict(grayWindow([]));
    expect(!out.ok && out.error.detail).toBe("the model process didn't start: Error: fork failed");
  });
});
