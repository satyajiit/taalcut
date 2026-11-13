// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The JobRunner port in process (createDirectJobRunner) and across a port
 * (jobRunnerRouter + jobRunnerOverRpc): progress streams through, the output
 * is validated by the caller's kind, cancelling the caller cancels the job,
 * and an unknown kind or a failed job is a typed error. Component installs
 * cross a port the same way.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CancelledError,
  componentInstallerContract,
  componentInstallerOverRpc,
  componentInstallerRouter,
  connectRpc,
  createDirectJobRunner,
  defineJobKind,
  err,
  forwardJobProgress,
  isId,
  NotFoundError,
  jobRunnerContract,
  jobRunnerOverRpc,
  jobRunnerRouter,
  ok,
  registerJob,
  serveRpc,
  ValidationError,
  type ComponentInstallerPort,
  type ComponentsPort,
  type InstalledComponentRef,
  type Downloads,
  type JobProgress,
  type JobRunner,
} from '@taalcut/core';
import { channel, tick } from './helpers/ports';

const countKind = defineJobKind({
  kind: 'test.count',
  input: z.object({ to: z.int().positive(), slow: z.boolean().optional() }),
  output: z.object({ counted: z.int() }),
  resource: 'cpu',
});

const failKind = defineJobKind({ kind: 'test.fail', input: z.object({}), output: z.null(), resource: 'cpu' });

const unregistered = defineJobKind({
  kind: 'test.missing',
  input: z.object({}),
  output: z.null(),
  resource: 'io',
});

function registrations(seen: { cancelled: number }) {
  return [
    registerJob(countKind, async ({ to, slow }, context) => {
      for (let i = 1; i <= to; i++) {
        if (context.signal.aborted) {
          seen.cancelled++;
          return err(CancelledError());
        }
        context.progress({ fraction: i / to, stageKey: 'counting' });
        if (slow) await tick(10);
      }
      return ok({ counted: to });
    }),
    registerJob(failKind, async () => err(ValidationError({ field: 'nothing' }))),
  ];
}

function overRpc(seen: { cancelled: number }): JobRunner {
  const registered = registrations(seen);
  const local = createDirectJobRunner(registered);
  const { port1, port2 } = channel();
  serveRpc(jobRunnerRouter(local, registered), port1, { context: {}, exposeDetail: true });
  const client = connectRpc(jobRunnerContract, port2, { peer: 'jobs' }).client;
  return jobRunnerOverRpc(() => client);
}

describe.each([
  ['in process', (seen: { cancelled: number }) => createDirectJobRunner(registrations(seen))],
  ['over IPC', overRpc],
] as const)('JobRunner %s', (_name, make) => {
  it('returns the output and reports progress', async () => {
    const runner = make({ cancelled: 0 });
    const progress: JobProgress[] = [];
    const result = await runner.run(countKind, { to: 3 }, { onProgress: (p) => progress.push(p) });
    expect(result).toEqual({ ok: true, value: { counted: 3 } });
    expect(progress.map((p) => p.fraction)).toEqual([1 / 3, 2 / 3, 1]);
  });

  it('names the job once it is enqueued, before its progress', async () => {
    const runner = make({ cancelled: 0 });
    const order: string[] = [];
    const result = await runner.run(
      countKind,
      { to: 2 },
      {
        onEnqueued: (jobId) => order.push(`enqueued:${isId(jobId)}`),
        onProgress: (p) => order.push(`progress:${p.fraction}`),
      },
    );
    expect(result.ok).toBe(true);
    expect(order).toEqual(['enqueued:true', 'progress:0.5', 'progress:1']);
  });

  it('fails with the job error, a bad input, or an unknown kind', async () => {
    const runner = make({ cancelled: 0 });
    expect(await runner.run(failKind, {})).toMatchObject({ ok: false, error: { code: 'core.validation' } });
    const bad = await runner.run(countKind, { to: -1 });
    expect(!bad.ok && bad.error.code).toBe('core.validation');
    const unknown = await runner.run(unregistered, {});
    expect(!unknown.ok && unknown.error).toMatchObject({
      code: 'core.not_found',
      params: { id: 'test.missing' },
    });
  });

  it('cancels the job when the caller aborts', async () => {
    const seen = { cancelled: 0 };
    const runner = make(seen);
    const controller = new AbortController();
    const running = runner.run(countKind, { to: 50, slow: true }, { signal: controller.signal });
    await tick(25);
    controller.abort();
    expect(await running).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    await tick(30);
    expect(seen.cancelled).toBe(1);
    const already = await runner.run(countKind, { to: 1 }, { signal: controller.signal });
    expect(!already.ok && already.error.code).toBe('core.cancelled');
  });
});

describe('forwardJobProgress', () => {
  it("maps a job's progress onto part of a tool's bar and names the stage", () => {
    const reports: [number, string | undefined][] = [];
    const forward = forwardJobProgress((fraction, note) => reports.push([fraction, note]), {
      from: 0.5,
      to: 1,
      notes: { decoding: 'Decoding' },
    });
    forward({ fraction: 0.5, stageKey: 'decoding' });
    forward({ fraction: null });
    forward({ fraction: 1, stageKey: 'other' });
    expect(reports).toEqual([
      [0.75, 'Decoding'],
      [0.75, undefined],
      [1, 'other'],
    ]);
  });
});

const READY: Downloads = {
  state: 'ready',
  components: [],
  counts: { installed: 0, downloading: 0, queued: 0, paused: 0, failed: 0, missing: 0 },
  bytesTotal: 0,
  bytesDone: 0,
  bytesPerSecond: 0,
  requiredBytes: 0,
};

describe('component installs across a port', () => {
  function installer(): ComponentsPort {
    const installed = new Map<string, InstalledComponentRef>();
    return {
      async install(id, options = {}) {
        if (id !== 'local-llm-runtime') return err(NotFoundError({ entity: 'component', id }));
        await tick(20);
        if (options.signal?.aborted) return err(CancelledError());
        const ref = {
          id,
          version: 'b1',
          path: `/components/${id}`,
          file: `/components/${id}/llama-server`,
          notice: `/components/${id}/TAALCUT-NOTICE.txt`,
        };
        installed.set(id, ref);
        return ok(ref);
      },
      get: async (id) => installed.get(id),
      list: async () => [],
      downloads: async () => READY,
      startDownloads: async () => ok(READY),
      pauseDownloads: async () => READY,
      cancelDownloads: async () => READY,
    };
  }

  function overRpc(): ComponentInstallerPort {
    const { port1, port2 } = channel();
    serveRpc(componentInstallerRouter(installer()), port1, { context: {}, exposeDetail: true });
    const client = connectRpc(componentInstallerContract, port2, { peer: 'jobs' }).client;
    return componentInstallerOverRpc(() => client);
  }

  it('installs, then finds it; an unknown id is not found', async () => {
    const remote = overRpc();
    expect(await remote.get('local-llm-runtime')).toBeUndefined();
    const ref = { id: 'local-llm-runtime', version: 'b1', path: '/components/local-llm-runtime' };
    const file = '/components/local-llm-runtime/llama-server';
    // Its licence notice's path crosses the port with it (round 3).
    const notice = '/components/local-llm-runtime/TAALCUT-NOTICE.txt';
    expect(await remote.install('local-llm-runtime')).toEqual(ok({ ...ref, file, notice }));
    expect(await remote.get('local-llm-runtime')).toEqual({ ...ref, file, notice });
    const missing = await remote.install('nope');
    expect(!missing.ok && missing.error).toMatchObject({ code: 'core.not_found', params: { id: 'nope' } });
  });

  it('cancels with the caller', async () => {
    const controller = new AbortController();
    const running = overRpc().install('local-llm-runtime', { signal: controller.signal });
    controller.abort();
    expect(await running).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
  });
});
