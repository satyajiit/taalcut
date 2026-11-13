// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's job runner across a jobs-process restart (P2-M13, gate
 * criterion 9). A call over main ends with core.process_restarted when the
 * jobs process goes; its supervisor starts it again and the queue takes the
 * dead process's jobs over (a resumable kind runs again). A job with an
 * idempotency key (the caller's, or its kind's) is asked for again until the
 * jobs process answers, so the tool joins its job by the key and waits on
 * instead of failing. A kind without a key fails as before: asking again
 * would run it twice.
 */
import {
  CancelledError,
  err,
  type AsyncResult,
  type JobKind,
  type JobRunner,
  type JobRunOptions,
} from '@taalcut/core';

const PROCESS_RESTARTED = 'core.process_restarted';

export interface RestartingJobRunnerOptions {
  /** How long the jobs process has to come back. Default 60 s. */
  readonly waitMs?: number;
  /** Between asks while it is away. Default 250 ms. */
  readonly retryMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function restartingJobRunner(inner: JobRunner, options: RestartingJobRunnerOptions = {}): JobRunner {
  const waitMs = options.waitMs ?? 60_000;
  const retryMs = options.retryMs ?? 250;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? pause;
  return {
    async run<I, O>(kind: JobKind<I, O>, input: NoInfer<I>, runOptions: JobRunOptions = {}): AsyncResult<O> {
      let result = await inner.run(kind, input, runOptions);
      const keyed = runOptions.idempotencyKey !== undefined || kind.idempotencyKey !== undefined;
      if (!keyed) return result;
      const until = now() + waitMs;
      while (!result.ok && result.error.code === PROCESS_RESTARTED && now() < until) {
        await sleep(retryMs);
        if (runOptions.signal?.aborted) return err(CancelledError());
        result = await inner.run(kind, input, runOptions);
      }
      return result;
    },
  };
}
