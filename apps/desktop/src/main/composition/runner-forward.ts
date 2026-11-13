// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's job runner, forwarded to the jobs process (P2-M13, gate
 * criterion 9). A call cut off because the agent process went (its port to
 * main closed) leaves the job running: main reads the job's stream to its
 * end, so the jobs process still has a waiter and doesn't cancel the job,
 * and the resumed run's tool joins it by its key instead of starting it again
 * (a render the Editor's draft started, a breakdown). The agent cancelling a
 * call (its tool's signal, the port still open) cancels the job as before.
 */
import {
  implementContract,
  jobRunnerContract,
  renderWorkerContract,
  type JobRunItem,
  type JobRunnerItem,
  type RpcClient,
} from '@taalcut/core';

/** Reads a stream nobody waits on any more to its end. */
async function drain(iterator: AsyncIterator<unknown>): Promise<void> {
  try {
    while (!(await iterator.next()).done);
  } catch {
    // The peer went too: its queue or store takes the work over.
  }
}

export function agentRunnerForward(
  jobs: () => RpcClient<typeof jobRunnerContract>,
  callerGone: () => boolean,
) {
  const os = implementContract(jobRunnerContract);
  return os.router({
    run: os.run.handler(async function* ({ input, signal }) {
      const forwarded = new AbortController();
      // The port closes before its calls see their signal fire: by then callerGone() says so.
      const cancel = () => {
        if (!callerGone()) forwarded.abort();
      };
      signal?.addEventListener('abort', cancel, { once: true });
      let iterator: AsyncIterator<unknown> | undefined;
      let done = false;
      try {
        iterator = (await jobs().run(input, { signal: forwarded.signal }))[Symbol.asyncIterator]();
        // Not for-await: leaving it early would end the jobs process's stream, and with it the job.
        for (;;) {
          const next = await iterator.next();
          if (next.done) {
            done = true;
            return;
          }
          yield next.value as JobRunnerItem;
        }
      } catch (cause) {
        done = true;
        throw cause;
      } finally {
        signal?.removeEventListener('abort', cancel);
        if (iterator && !done) {
          if (callerGone()) void drain(iterator);
          else await iterator.return?.();
        }
      }
    }),
  });
}

/**
 * The jobs process's render worker, forwarded to the render process. When the
 * jobs process dies mid-export (`callerGone()`), main drains the render
 * stream instead of aborting it, so the render process keeps rendering and
 * the reclaimed job in the restarted jobs process joins the in-flight export.
 */
export function renderWorkerForward(
  worker: () => RpcClient<typeof renderWorkerContract>,
  callerGone: () => boolean,
) {
  const os = implementContract(renderWorkerContract);
  return os.router({
    export: os.export.handler(async function* ({ input, signal }) {
      const forwarded = new AbortController();
      const cancel = () => {
        if (!callerGone()) forwarded.abort();
      };
      signal?.addEventListener('abort', cancel, { once: true });
      let iterator: AsyncIterator<unknown> | undefined;
      let done = false;
      try {
        iterator = (await worker().export(input, { signal: forwarded.signal }))[Symbol.asyncIterator]();
        for (;;) {
          const next = await iterator.next();
          if (next.done) {
            done = true;
            return;
          }
          yield next.value as JobRunItem;
        }
      } catch (cause) {
        done = true;
        throw cause;
      } finally {
        signal?.removeEventListener('abort', cancel);
        if (iterator && !done) {
          if (callerGone()) void drain(iterator);
          else await iterator.return?.();
        }
      }
    }),
    captureFrame: os.captureFrame.handler(({ input, signal }) =>
      worker().captureFrame(input, signal ? { signal } : {}),
    ),
    coverImage: os.coverImage.handler(({ input, signal }) =>
      worker().coverImage(input, signal ? { signal } : {}),
    ),
    // HFW1: the Designer's stills of a workspace composition, drawn in the render process.
    workspaceFrames: os.workspaceFrames.handler(({ input, signal }) =>
      worker().workspaceFrames(input, signal ? { signal } : {}),
    ),
  });
}
