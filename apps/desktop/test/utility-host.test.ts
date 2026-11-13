// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main ↔ utility RPC across restarts (P1-B2), with the real utility runtime
 * and composition roots running in-process: each start gets a fresh port,
 * an exit fails calls in flight with core.process_restarted (even while the
 * dead process's port still looks open), the restarted process answers, and
 * main's event bridge subscribes again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEventBus,
  EventBusToken,
  fromRpcError,
  JobRunnerToken,
  systemClock,
  type JobProgress,
  type TaalcutEvent,
  type UtilityName,
} from '@taalcut/core';
import { bridgeUtilityEvents, logSupervisor } from '../src/main/composition/main-wiring';
import { AgentMainServicesToken } from '../src/shared/tokens';
import { UtilityHost } from '../src/main/rpc/utility-host';
import { utilityProcessTable } from '../src/main/utility/process-table';
import { closeAllPorts, fakeHost, nodeChannel, type FakeUtility } from './helpers/fake-utility';
import { countKind, testConfig, testRoots } from './helpers/roots';

const roots = testRoots;
const codeOf = (cause: unknown) => fromRpcError(cause).code;
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, timeoutMs = 1000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value) || Date.now() > deadline) return value;
    await tick(5);
  }
}

const pingCode = (host: UtilityHost, name: UtilityName) =>
  host
    .client(name)
    .diagnostics.ping()
    .then((pong) => pong.process as string, codeOf);

afterEach(() => closeAllPorts());

describe('UtilityHost', () => {
  it('connects each eager process and reaches it through its client', async () => {
    const { host, children } = fakeHost(roots);
    host.startEager();
    expect(children.map((child) => child.spec.name)).toEqual(['agent', 'jobs']);
    expect(await host.client('agent').diagnostics.ping()).toMatchObject({ process: 'agent' });
    expect(await host.client('jobs').diagnostics.echo({ text: 'hi' })).toEqual({
      text: 'hi',
      process: 'jobs',
    });
    expect((await host.client('agent').commands.list()).map((command) => command.name)).toEqual(
      expect.arrayContaining(['models.setProfile', 'settings.setTheme', 'library.addSource']),
    );
    expect(await host.client('jobs').jobs.list()).toEqual([]);
    await host.stopAll();
  });

  it("runs the agent's jobs and component installs in the jobs process, through main", async () => {
    const { host, latest } = fakeHost(roots);
    host.startEager();
    await until(
      () => pingCode(host, 'jobs'),
      (value) => value === 'jobs',
    );
    const agent = await (latest('agent') as FakeUtility).handle.root;
    const runner = agent!.container.resolve(JobRunnerToken);
    const progress: JobProgress[] = [];
    const counted = await runner.run(countKind, { to: 2 }, { onProgress: (p) => progress.push(p) });
    expect(counted).toEqual({ ok: true, value: { counted: 2 } });
    expect(await host.client('jobs').jobs.list()).toMatchObject([{ kind: 'test.count', state: 'succeeded' }]);
    // Component installs go the same way (no manifest in tests, so nothing is installed).
    const main = agent!.container.resolve(AgentMainServicesToken);
    expect(await main().components.get({ id: 'local-llm-runtime' })).toBeNull();
    await host.stopAll();
  });

  it('fails fast before an on-demand process starts, then serves it', async () => {
    const { host } = fakeHost(roots);
    expect(await pingCode(host, 'render')).toBe('core.process_restarted');
    host.start('render');
    host.start('lan');
    expect(await pingCode(host, 'render')).toBe('render');
    expect(await pingCode(host, 'lan')).toBe('lan');
    await host.stop('lan');
    expect(await pingCode(host, 'lan')).toBe('core.process_restarted');
    await host.stopAll();
  });

  it('rejects calls in flight with ProcessRestarted on exit, then the restarted process answers', async () => {
    const { host, latest, children } = fakeHost(roots);
    host.startEager();
    const first = latest('jobs') as FakeUtility;
    const pending = host.client('jobs').diagnostics.echo({ text: 'slow', delayMs: 10_000 });
    const stream = await host.client('jobs').diagnostics.ticks({ count: 100, intervalMs: 5 });
    expect((await stream.next()).value).toEqual({ process: 'jobs', seq: 0 });

    first.crash(1);
    expect(await pending.catch(codeOf)).toBe('core.process_restarted');
    expect(await stream.next().catch(codeOf)).toBe('core.process_restarted');
    expect(await pingCode(host, 'jobs')).toBe('core.process_restarted');

    expect(
      await until(
        () => pingCode(host, 'jobs'),
        (value) => value === 'jobs',
      ),
    ).toBe('jobs');
    expect(children.filter((child) => child.spec.name === 'jobs')).toHaveLength(2);
    await host.stopAll();
  });

  it('re-bridges each process events into main after a restart', async () => {
    const { host, latest } = fakeHost(roots);
    const mainBus = createEventBus({ clock: systemClock });
    const seen: TaalcutEvent[] = [];
    mainBus.onAny((event) => seen.push(event));
    const log = vi.fn();
    bridgeUtilityEvents(host, mainBus, log);
    host.startEager();

    const idsSeen = () => new Set(seen.map((event) => (event.payload as { ids: string[] }).ids[0]));
    /** Emits on the current agent's bus until main has it: the bridge subscribes after the agent composes. */
    const emitFromAgent = async (id: string) => {
      for (let tries = 0; tries < 200 && !idsSeen().has(id); tries += 1) {
        const root = await (latest('agent') as FakeUtility).handle.root;
        root?.container
          .resolve(EventBusToken)
          .emit('library.changed', { projectId: null, entity: 'project', change: 'created', ids: [id] });
        await tick(10);
      }
    };
    await emitFromAgent('first');

    (latest('agent') as FakeUtility).crash(1);
    await until(
      () => pingCode(host, 'agent'),
      (value) => value === 'agent',
    );
    await emitFromAgent('second');
    expect([...idsSeen()]).toEqual(['first', 'second']);
    expect(log).not.toHaveBeenCalled();
    await host.stopAll();
  });

  it('tells the lan lifecycle about bridged transfer sessions and files', () => {
    const { host } = fakeHost(roots);
    const mainBus = createEventBus({ clock: systemClock });
    const lan = { onSession: vi.fn(), onFile: vi.fn() };
    const stop = bridgeUtilityEvents(host, mainBus, vi.fn(), lan);
    mainBus.emit('transfer.session', { state: 'stopped' } as never);
    mainBus.emit('transfer.file', { id: 'up', state: 'checking' } as never);
    expect(lan.onSession).toHaveBeenCalledWith(expect.objectContaining({ state: 'stopped' }));
    expect(lan.onFile).toHaveBeenCalledWith(expect.objectContaining({ id: 'up', state: 'checking' }));
    stop();
    mainBus.emit('transfer.session', { state: 'listening' } as never);
    expect(lan.onSession).toHaveBeenCalledTimes(1);
  });

  it('logs crashes, restarts and failed forks', async () => {
    const warn = vi.fn();
    const error = vi.fn();
    let attempts = 0;
    const host = new UtilityHost({
      specs: utilityProcessTable('/x.mjs'),
      fork: () => {
        attempts += 1;
        throw new Error('ENOENT');
      },
      createChannel: nodeChannel,
      config: (process) => testConfig(process),
      backoff: { initialMs: 5, factor: 1, maxMs: 5, stableAfterMs: 1000 },
    });
    logSupervisor(host, { warn, error });
    host.start('render');
    await tick(20);
    expect(attempts).toBeGreaterThan(1);
    expect(error).toHaveBeenCalledWith('[utility] could not start render: Error: ENOENT');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[utility\] restarting render in 5 ms/));
    await host.stopAll();

    const crashing = fakeHost(roots);
    logSupervisor(crashing.host, { warn, error });
    crashing.host.start('lan');
    (crashing.latest('lan') as FakeUtility).crash(9);
    expect(warn).toHaveBeenCalledWith('[utility] lan exited with code 9');
    await crashing.host.stopAll();
  });

  it('kills a child it could not hand a port to', async () => {
    const kill = vi.fn(() => true);
    const host = new UtilityHost({
      specs: utilityProcessTable('/x.mjs'),
      fork: () => ({
        pid: 1,
        kill,
        once: () => undefined,
        postMessage: () => {
          throw new Error('port already transferred');
        },
      }),
      createChannel: nodeChannel,
      config: (process) => testConfig(process),
      backoff: { initialMs: 1000, factor: 1, maxMs: 1000, stableAfterMs: 1000 },
    });
    const events: string[] = [];
    host.supervisor.on((event) => events.push(event.type));
    host.start('render');
    expect(kill).toHaveBeenCalledOnce();
    expect(events).toEqual(['spawn-failed', 'restart-scheduled']);
    await host.stopAll();
  });
});
