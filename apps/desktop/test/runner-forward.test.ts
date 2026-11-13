// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's forward of the agent's job runner (gate criterion 9): a call cut off
 * because the agent process went leaves the job running, so the resumed run
 * joins it; the agent cancelling a call still cancels the job.
 */
import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CancelledError,
  connectRpc,
  defineJobKind,
  err,
  jobRunnerContract,
  jobRunnerOverRpc,
  jobRunnerRouter,
  newId,
  ok,
  registerJob,
  renderWorkerContract,
  renderWorkerOverRpc,
  renderWorkerRouter,
  serveRpc,
  type AsyncResult,
  type JobKind,
  type JobRunner,
  type JobRunOptions,
  type ProjectId,
  type RenderId,
  type RenderWorker,
  type RpcServer,
  type TimelineId,
} from '@taalcut/core';
import { agentRunnerForward, renderWorkerForward } from '../src/main/composition/runner-forward';

const slow = defineJobKind({
  kind: 'test.slow',
  input: z.object({ n: z.number() }),
  output: z.number(),
  resource: 'cpu',
});

/** The jobs process's runner: each job waits until released, or its signal fires. */
function heldJobs() {
  const state = { started: 0, aborted: 0, finished: 0, release: () => undefined as void };
  const released = new Promise<void>((resolve) => {
    state.release = resolve;
  });
  const runner: JobRunner = {
    async run<I, O>(_kind: JobKind<I, O>, input: NoInfer<I>, options?: JobRunOptions): AsyncResult<O> {
      state.started += 1;
      const signal = options?.signal;
      const aborted = new Promise<'aborted'>((resolve) =>
        signal?.addEventListener('abort', () => resolve('aborted'), { once: true }),
      );
      if ((await Promise.race([released.then(() => 'released' as const), aborted])) === 'aborted') {
        state.aborted += 1;
        return err(CancelledError());
      }
      state.finished += 1;
      return ok(((input as { n: number }).n * 2) as O);
    },
  };
  return { state, runner };
}

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const { port1, port2 } of channels.splice(0)) {
    port1.close();
    port2.close();
  }
});

function channel(): MessageChannel {
  const made = new MessageChannel();
  channels.push(made);
  return made;
}

/** jobs ⇄ main ⇄ agent, as in the app. Returns the agent's runner and its end of the port to main. */
function wire(runner: JobRunner) {
  const jobs = channel();
  serveRpc(jobRunnerRouter(runner, [registerJob(slow, async () => ok(0))]), jobs.port1, {
    context: {},
    exposeDetail: true,
  });
  const jobsClient = connectRpc(jobRunnerContract, jobs.port2, { peer: 'jobs' }).client;
  const agent = channel();
  const served: RpcServer = serveRpc(
    agentRunnerForward(
      () => jobsClient,
      () => served.closed,
    ),
    agent.port1,
    { context: {}, exposeDetail: true },
  );
  const agentClient = connectRpc(jobRunnerContract, agent.port2, { peer: 'main' }).client;
  return { runner: jobRunnerOverRpc(() => agentClient), agentPort: agent.port2 };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(check()).toBe(true);
};

describe('agentRunnerForward', () => {
  it('passes the result through', async () => {
    const held = heldJobs();
    const { runner } = wire(held.runner);
    const result = runner.run(slow, { n: 4 });
    await until(() => held.state.started === 1);
    held.state.release();
    expect(await result).toEqual(ok(8));
  });

  it('leaves the job running when the agent process goes', async () => {
    const held = heldJobs();
    const { runner, agentPort } = wire(held.runner);
    void runner.run(slow, { n: 1 });
    await until(() => held.state.started === 1);
    agentPort.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    held.state.release();
    await until(() => held.state.finished === 1);
    expect(held.state.aborted).toBe(0);
  });

  it('cancels the job when the agent cancels the call', async () => {
    const held = heldJobs();
    const { runner } = wire(held.runner);
    const controller = new AbortController();
    const result = runner.run(slow, { n: 1 }, { signal: controller.signal });
    await until(() => held.state.started === 1);
    controller.abort();
    expect((await result).ok).toBe(false);
    await until(() => held.state.aborted === 1);
  });
});

function heldRenderWorker() {
  const state = { started: 0, aborted: 0, finished: 0, release: () => undefined as void };
  const released = new Promise<void>((resolve) => {
    state.release = resolve;
  });
  const worker: RenderWorker = {
    async export(input, options) {
      state.started += 1;
      options?.onProgress?.({ fraction: 0.25 });
      const signal = options?.signal;
      const aborted = new Promise<'aborted'>((resolve) =>
        signal?.addEventListener('abort', () => resolve('aborted'), { once: true }),
      );
      if ((await Promise.race([released.then(() => 'released' as const), aborted])) === 'aborted') {
        state.aborted += 1;
        return err(CancelledError());
      }
      state.finished += 1;
      return ok({
        renderId: input.renderId as RenderId,
        status: 'ready',
        qa: null,
      });
    },
    async captureFrame() {
      return err(CancelledError());
    },
  };
  const renderChan = channel();
  serveRpc(renderWorkerRouter(worker), renderChan.port1, { context: {}, exposeDetail: true });
  const renderClient = connectRpc(renderWorkerContract, renderChan.port2, { peer: 'render' }).client;
  const jobsChan = channel();
  const served: RpcServer = serveRpc(
    renderWorkerForward(
      () => renderClient,
      () => served.closed,
    ),
    jobsChan.port1,
    { context: {}, exposeDetail: true },
  );
  const jobsClient = connectRpc(renderWorkerContract, jobsChan.port2, { peer: 'main' }).client;
  return { state, worker: renderWorkerOverRpc(() => jobsClient), jobsPort: jobsChan.port2 };
}

const sampleExportInput = () => ({
  renderId: newId<'Render'>() as RenderId,
  request: {
    projectId: newId<'Project'>() as ProjectId,
    timelineId: newId<'Timeline'>() as TimelineId,
    presetId: 'reels' as const,
    captions: { burnIn: false, sidecars: [] },
    notify: false,
  },
});

describe('renderWorkerForward', () => {
  it('leaves the export running in the render process when the jobs process goes', async () => {
    const held = heldRenderWorker();
    void held.worker.export(sampleExportInput());
    await until(() => held.state.started === 1);
    held.jobsPort.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    held.state.release();
    await until(() => held.state.finished === 1);
    expect(held.state.aborted).toBe(0);
  });

  it('aborts the export when the jobs process cancels the call', async () => {
    const held = heldRenderWorker();
    const controller = new AbortController();
    const result = held.worker.export(sampleExportInput(), { signal: controller.signal });
    await until(() => held.state.started === 1);
    controller.abort();
    expect((await result).ok).toBe(false);
    await until(() => held.state.aborted === 1);
  });
});
