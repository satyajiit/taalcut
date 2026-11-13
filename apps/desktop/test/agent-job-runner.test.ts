// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's job runner across a jobs-process restart (gate criterion 9): a
 * keyed job is asked for again until the jobs process answers; an unkeyed one
 * fails as before, since asking again would run it twice.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  defineJobKind,
  err,
  ok,
  ProcessRestartedError,
  ValidationError,
  type AsyncResult,
  type JobKind,
  type JobRunner,
  type JobRunOptions,
} from '@taalcut/core';
import { restartingJobRunner } from '../src/utility/roots/agent-job-runner';

const keyed = defineJobKind({
  kind: 'test.keyed',
  input: z.object({ n: z.number() }),
  output: z.number(),
  resource: 'cpu',
  idempotencyKey: (input) => `n:${input.n}`,
});
const unkeyed = defineJobKind({
  kind: 'test.unkeyed',
  input: z.object({ n: z.number() }),
  output: z.number(),
  resource: 'cpu',
});

/** Answers process_restarted `away` times, then the input doubled; counts the asks. */
function flaky(away: number): JobRunner & { asks: number } {
  const runner = {
    asks: 0,
    async run<I, O>(_kind: JobKind<I, O>, input: NoInfer<I>, _options?: JobRunOptions): AsyncResult<O> {
      runner.asks += 1;
      if (runner.asks <= away) return err(ProcessRestartedError({ process: 'jobs' }));
      return ok(((input as { n: number }).n * 2) as O);
    },
  };
  return runner;
}

const instant = { sleep: async () => undefined };

describe('restartingJobRunner', () => {
  it('asks for a keyed job again while the jobs process restarts, and returns its result', async () => {
    const inner = flaky(2);
    const result = await restartingJobRunner(inner, instant).run(keyed, { n: 21 });
    expect(result).toEqual(ok(42));
    expect(inner.asks).toBe(3);
  });

  it("asks again for an unkeyed kind's job only when the caller gives a key", async () => {
    const inner = flaky(1);
    const failed = await restartingJobRunner(inner, instant).run(unkeyed, { n: 1 });
    expect(!failed.ok && failed.error.code).toBe('core.process_restarted');
    expect(inner.asks).toBe(1);
    const again = flaky(1);
    expect(await restartingJobRunner(again, instant).run(unkeyed, { n: 1 }, { idempotencyKey: 'k' })).toEqual(
      ok(2),
    );
  });

  it('passes other errors through at once', async () => {
    let asks = 0;
    const inner: JobRunner = {
      run: async () => {
        asks += 1;
        return err(ValidationError({ field: 'n' }));
      },
    };
    const result = await restartingJobRunner(inner, instant).run(keyed, { n: 1 });
    expect(!result.ok && result.error.code).toBe('core.validation');
    expect(asks).toBe(1);
  });

  it('gives up when the jobs process stays away, and stops when the caller cancels', async () => {
    let clock = 0;
    const away = flaky(Number.POSITIVE_INFINITY);
    const timed = restartingJobRunner(away, {
      waitMs: 1_000,
      retryMs: 250,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
    });
    const gaveUp = await timed.run(keyed, { n: 1 });
    expect(!gaveUp.ok && gaveUp.error.code).toBe('core.process_restarted');
    expect(away.asks).toBe(5);

    const controller = new AbortController();
    const cancelled = await restartingJobRunner(flaky(Number.POSITIVE_INFINITY), {
      sleep: async () => controller.abort(),
    }).run(keyed, { n: 1 }, { signal: controller.signal });
    expect(!cancelled.ok && cancelled.error.code).toBe('core.cancelled');
  });
});
