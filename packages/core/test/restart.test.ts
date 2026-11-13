// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A utility process dies with calls in flight: main closes its connection as
 * 'peer-exited' (the supervisor saw the exit), so every pending call and
 * stream through main rejects with core.process_restarted; the restarted
 * process's connection then serves new calls.
 */
import { describe, expect, it } from 'vitest';
import {
  appContract,
  connectRpc,
  createEventBus,
  diagnosticsRouter,
  eventsRouter,
  fromRpcError,
  implementContract,
  mainDiagnosticsRouter,
  powerRouter,
  routeAppContract,
  serveRpc,
  systemClock,
  UTILITY_CONTRACTS,
  type RpcConnection,
  type UtilityClients,
} from '@taalcut/core';
import { createFakeTheme, notServed, themeRouter } from './helpers/fixtures';
import { channel, mainChannel, tick } from './helpers/ports';

type JobsConnection = RpcConnection<typeof UTILITY_CONTRACTS.jobs>;

function startJobs(pid: number): { connection: JobsConnection; stop: () => void } {
  const os = implementContract(UTILITY_CONTRACTS.jobs);
  const router = os.router({
    diagnostics: diagnosticsRouter({ process: 'jobs', pid, clock: systemClock }),
    events: eventsRouter(createEventBus({ clock: systemClock })),
    power: powerRouter(() => undefined),
    ...notServed('jobs', 'runner', 'components', 'embeddings', 'queue', 'debugBundle', 'indexing'),
  });
  const { port1, port2 } = mainChannel();
  const server = serveRpc(router, port1, { context: {} });
  return {
    connection: connectRpc(UTILITY_CONTRACTS.jobs, port2, { peer: 'jobs' }),
    stop: () => server.close(),
  };
}

function startMain() {
  let jobs = startJobs(1);
  const utility = (() => jobs.connection.client) as unknown as UtilityClients;
  const router = routeAppContract(
    {
      theme: themeRouter(createFakeTheme()),
      events: eventsRouter(createEventBus({ clock: systemClock })),
      diagnostics: mainDiagnosticsRouter({ pid: 0, clock: systemClock }, utility),
      ...notServed(
        'productBackground',
        'plugins',
        'pluginsSetup',
        'recovery',
        'accounts',
        'window',
        'feedback',
        'updates',
        'crashes',
        'files',
        'mcpSetup',
        'locale',
        'voiceCapture',
        'imports',
      ),
    },
    utility,
  );
  const { port1, port2 } = channel();
  serveRpc(router, port1, { context: {} });
  return {
    renderer: connectRpc(appContract, port2, { peer: 'main' }).client,
    /** What main does on the supervisor's 'exited' and then 'started' events. */
    crashJobs() {
      jobs.stop();
      jobs.connection.close('peer-exited');
    },
    restartJobs() {
      jobs = startJobs(2);
    },
  };
}

const codeOf = (cause: unknown): string => fromRpcError(cause).code;

describe('utility process restart', () => {
  it('rejects in-flight calls and streams with core.process_restarted, then serves the new process', async () => {
    const app = startMain();
    expect(await app.renderer.diagnostics.jobs.ping()).toMatchObject({ pid: 1 });

    const pending = app.renderer.diagnostics.jobs.echo({ text: 'slow', delayMs: 10_000 });
    const stream = await app.renderer.diagnostics.jobs.ticks({ count: 100, intervalMs: 20 });
    const first = await stream.next();
    expect(first.value).toEqual({ process: 'jobs', seq: 0 });
    await tick(5);

    app.crashJobs();
    await expect(pending.catch(codeOf)).resolves.toBe('core.process_restarted');
    await expect(stream.next().catch(codeOf)).resolves.toBe('core.process_restarted');
    // Until the new process is up, calls fail fast instead of waiting.
    await expect(app.renderer.diagnostics.jobs.ping().catch(codeOf)).resolves.toBe('core.process_restarted');

    app.restartJobs();
    expect(await app.renderer.diagnostics.jobs.ping()).toMatchObject({ process: 'jobs', pid: 2 });
  });

  it('names the process that went away', async () => {
    const app = startMain();
    const pending = app.renderer.diagnostics.jobs.echo({ text: 'slow', delayMs: 10_000 });
    await tick(5);
    app.crashJobs();
    const error = await pending.then(() => undefined, fromRpcError);
    expect(error).toMatchObject({
      code: 'core.process_restarted',
      retryable: true,
      params: { process: 'jobs' },
    });
  });

  it('closing locally still means cancelled', async () => {
    const jobs = startJobs(3);
    const pending = jobs.connection.client.diagnostics.echo({ text: 'slow', delayMs: 10_000 });
    await tick(5);
    jobs.connection.close();
    await expect(pending.catch(codeOf)).resolves.toBe('core.cancelled');
    jobs.stop();
  });

  it('echo honours the caller abort signal', async () => {
    const jobs = startJobs(4);
    const controller = new AbortController();
    const pending = jobs.connection.client.diagnostics.echo(
      { text: 'slow', delayMs: 10_000 },
      { signal: controller.signal },
    );
    await tick(5);
    controller.abort();
    await expect(pending.catch(codeOf)).resolves.toBe('core.cancelled');
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      jobs.connection.client.diagnostics
        .echo({ text: 'x', delayMs: 5 }, { signal: aborted.signal })
        .catch(codeOf),
    ).resolves.toBe('core.cancelled');
    jobs.stop();
  });
});
