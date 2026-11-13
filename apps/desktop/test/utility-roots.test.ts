// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The utility composition roots and runtime: what each process registers,
 * that lazy services construct, that the database main migrated opens in a
 * utility process, and how runUtility treats connect messages.
 */
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuditLogStoreToken,
  CommandBusToken,
  connectRpc,
  createToken,
  EventBusToken,
  fromRpcError,
  JobQueueToken,
  ok,
  serveRpc,
  SettingsStoreToken,
  taalcutEventSchema,
  THEME_SETTING,
  UTILITY_CONTRACTS,
  type TaalcutEvent,
} from '@taalcut/core';
import { defineJob } from '@taalcut/jobs';
import { openDatabase } from '@taalcut/library';
import {
  ComponentManagerToken,
  JobEngineToken,
  LibraryDatabaseToken,
  ModelClientToken,
  ModelProfilesToken,
  ToolRegistryToken,
  UtilityConfigToken,
} from '../src/shared/tokens';
import { AgentToken, ConsentStoreToken } from '../src/utility/roots/agent-loop';
import { composeStub } from '../src/utility/roots/stub-root';
import { runUtility } from '../src/utility/runtime';
import type { UtilityConfig } from '../src/shared/rpc-ipc';
import type { UtilityRoot } from '../src/utility/runtime';
import { countKind, M3_INFO, testAgent, testConfig, testJobs } from './helpers/roots';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Serves a root's router on one end of a fresh channel and returns the other. */
function serve(root: UtilityRoot): MessagePort {
  const { port1, port2 } = new MessageChannel();
  serveRpc(root.router, port1, { context: { caller: 'main' } });
  return port2;
}

const config = (process: UtilityConfig['process'], dbPath = ':memory:') => testConfig(process, dbPath);

describe('agent root', () => {
  it('registers the bus, models, the tool modules, the agent and chat, all of which construct', async () => {
    const root = testAgent(config('agent'), { pid: 11 });
    const { container } = root;
    expect(container.resolve(UtilityConfigToken).process).toBe('agent');
    expect(container.has(AuditLogStoreToken)).toBe(true);
    expect(typeof container.resolve(ModelClientToken).complete).toBe('function');
    const tools = container
      .resolve(ToolRegistryToken)
      .catalogue()
      .map((tool) => tool.name);
    expect(tools).toEqual(
      expect.arrayContaining(['library.addSource', 'media.probe', 'vision.describeFrame']),
    );
    expect(typeof container.resolve(AgentToken).start).toBe('function');
    expect(
      container
        .resolve(CommandBusToken)
        .list()
        .map((command) => command.name),
    ).toEqual(
      expect.arrayContaining([
        'library.addSource',
        'library.removeSource',
        'models.clearModuleOverride',
        'models.restore',
        'models.setModuleOverride',
        'models.setProfile',
        'models.useRecommended',
        'settings.openSignInWarning',
        'settings.setTheme',
      ]),
    );
    await container.dispose();
  });

  it('serves model settings for this machine, and model commands undo in one step', async () => {
    const root = testAgent(config('agent'));
    await root.start?.();
    const client = connectRpc(UTILITY_CONTRACTS.agent, serve(root), { peer: 'agent' }).client;
    const profiles = root.container.resolve(ModelProfilesToken);
    await vi.waitFor(() => expect(profiles.tier()).not.toBe('minimum'));
    const settings = await client.models.settings();
    expect(settings.modules.map((module) => module.module)).toEqual([
      'agent',
      'router',
      'vision',
      'embeddings',
      'speech',
      'voice',
      'music',
      'images',
    ]);
    expect(settings.profiles.length).toBeGreaterThan(0);
    const before = settings.activeProfileId;
    const other = settings.profiles.find((profile) => profile.id !== before)!.id;
    await client.commands.dispatch({ name: 'models.setProfile', payload: { profileId: other } });
    expect((await client.models.settings()).activeProfileId).toBe(other);
    await client.commands.undo({ projectId: null, source: 'shortcut' });
    expect((await client.models.settings()).activeProfileId).toBe(before);
    // ⌘K's list: models.restore is internal (undo runs it, a person can't), the UI commands carry shortcuts.
    const listed = await client.commands.list();
    expect(listed.find((command) => command.name === 'models.restore')).toMatchObject({ internal: true });
    expect(listed.find((command) => command.name === 'go.library')).toMatchObject({ shortcut: 'mod+2' });
    expect(listed.find((command) => command.name === 'edit.redo')).toMatchObject({ shortcut: 'mod+shift+z' });
    const restore = { activeProfileId: before, overrides: {} };
    await expect(
      client.commands.dispatch({ name: 'models.restore', payload: restore }),
    ).rejects.toMatchObject({
      data: { code: 'core.internal_command' },
    });
    const options = await client.models.options({ module: 'vision' });
    expect(options.length).toBeGreaterThan(0);
    expect(M3_INFO.chip).toBe('Apple M3 Pro');
    // Settings → About: this Mac, what its local modules run on, and (with no jobs process here) no components.
    expect(await client.system.hardware()).toMatchObject({ info: { chip: 'Apple M3 Pro' }, tier: 'high' });
    const compute = await client.system.compute();
    expect(compute.gpu).toEqual({ name: 'Apple M3 Pro', cores: 18, api: 'Metal 3' });
    for (const row of compute.modules) expect(row.backend).not.toBe('cpu');
    expect(await client.system.components()).toEqual([]);
    await root.container.dispose();
  });

  it('settings.setTheme is saved in the settings store and undoes', async () => {
    const root = testAgent(config('agent'));
    const client = connectRpc(UTILITY_CONTRACTS.agent, serve(root), { peer: 'agent' }).client;
    const settings = root.container.resolve(SettingsStoreToken);
    await client.commands.dispatch({ name: 'settings.setTheme', payload: { preference: 'dark' } });
    expect(await settings.get(THEME_SETTING)).toEqual({ ok: true, value: 'dark' });
    await client.commands.undo({ projectId: null, source: 'ui' });
    expect(await settings.get(THEME_SETTING)).toEqual({ ok: true, value: 'system' });
    expect(await client.chat.listConversations()).toEqual([]);
    expect(await client.usage.list({})).toMatchObject({ records: [], totals: { calls: 0 } });
    expect(await client.traces.runs({})).toEqual([]);
    await root.container.dispose();
  });

  it('lists the standing upload consents and revokes one, in Settings, idempotently', async () => {
    const root = testAgent(config('agent'));
    const client = connectRpc(UTILITY_CONTRACTS.agent, serve(root), { peer: 'agent' }).client;
    expect(await client.consents.list()).toEqual([]);
    // What "Always allow" on a consent card stores.
    const consents = root.container.resolve(ConsentStoreToken);
    await consents.grant({ id: 'c-1', module: 'vision', providers: ['google'], grantedAt: 5 });
    expect(await client.consents.list()).toEqual([{ module: 'vision', providers: ['google'], grantedAt: 5 }]);
    expect(await client.consents.revoke({ module: 'vision' })).toEqual({ module: 'vision', revoked: true });
    expect(await client.consents.revoke({ module: 'vision' })).toEqual({ module: 'vision', revoked: false });
    expect(await client.consents.list()).toEqual([]);
    expect(await consents.get('vision')).toBeUndefined();
    await root.container.dispose();
  });
});

describe('jobs root', () => {
  it('serves the job engine over the library jobs table, throttled by main power snapshots', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'taalcut-jobs-'));
    dirs.push(userData);
    const root = testJobs({ ...config('jobs'), userData }, 12);
    await root.start?.();
    const engine = root.container.resolve(JobEngineToken);
    const queue = root.container.resolve(JobQueueToken);
    const events: TaalcutEvent[] = [];
    root.container.resolve(EventBusToken).onAny((event) => events.push(event));
    const ran = vi.fn();
    engine.register(
      defineJob({
        kind: 'demo.wait',
        resourceClass: 'cpu',
        handler: async (payload: unknown) => (ran(payload), ok({ done: true })),
      }),
    );
    const queued = await queue.enqueue({ kind: 'demo.wait', input: { n: 1 }, priority: 'high' });
    if (!queued.ok) throw new Error(queued.error.code);
    // The library's pipeline also follows job events, so the engine may have started it by the time the
    // snapshot is read; its event sequence below is exact.
    expect(queued.value).toMatchObject({ kind: 'demo.wait', priority: 'high' });
    expect(['queued', 'running']).toContain(queued.value.state);
    await engine.whenIdle();
    expect(ran).toHaveBeenCalledWith({ n: 1 });
    expect(await queue.get(queued.value.id)).toMatchObject({ ok: true, value: { state: 'succeeded' } });
    // The library's daily housekeeping (staging sweep, collect) is queued at start too.
    expect(await queue.list({ kind: 'demo.wait' })).toMatchObject({
      ok: true,
      value: [{ id: queued.value.id }],
    });
    const mine = (event: TaalcutEvent) =>
      event.type === 'job.stateChanged' && event.payload.jobId === queued.value.id;
    expect(events.filter(mine).map((event) => event.payload)).toEqual([
      expect.objectContaining({ from: null, to: 'queued' }),
      expect.objectContaining({ from: 'queued', to: 'running' }),
      expect.objectContaining({ from: 'running', to: 'succeeded' }),
    ]);
    for (const event of events) expect(taalcutEventSchema.safeParse(event).success, event.type).toBe(true);
    expect(await queue.retry(queued.value.id)).toMatchObject({ ok: false, error: { code: 'core.conflict' } });

    const before = engine.limits();
    const client = connectRpc(UTILITY_CONTRACTS.jobs, serve(root), { peer: 'jobs' }).client;
    await client.power.update({ onBattery: true, thermalState: 'critical' });
    expect(engine.limits()).not.toEqual(before);
    // No manifest where the test config points, so the download manager knows no components.
    expect(await root.container.resolve(ComponentManagerToken).list()).toEqual([]);
    expect(await client.components.list()).toEqual([]);
    expect(await client.components.get({ id: 'local-llm-runtime' })).toBeNull();
    // The agent's runner: a registered kind by name, its progress, then its output.
    await client.power.update({ onBattery: false, thermalState: 'nominal' });
    const run = async (kind: string, input: unknown) => {
      const items = [];
      for await (const item of await client.runner.run({ kind, input })) items.push(item);
      return items;
    };
    expect((await run(countKind.kind, { to: 2 })).at(-1)).toEqual({ type: 'done', output: { counted: 2 } });
    await expect(run('test.nothing', {})).rejects.toMatchObject({ data: { code: 'core.not_found' } });
    const components = root.container.resolve(ComponentManagerToken);
    await root.container.dispose();
    // Quit closes the component manager with the rest: nothing under userData/components changes after.
    const cancelled = { ok: false, error: { code: 'core.cancelled' } };
    expect(await components.updateAll()).toMatchObject(cancelled);
    expect(await components.remove('local-llm-runtime')).toMatchObject(cancelled);
  });
});

describe('jobs root at quit', () => {
  it('stops the engine before the container closes what a running job uses: the job is handed back', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'taalcut-jobs-quit-'));
    dirs.push(userData);
    const parent = new EventEmitter();
    const handle = runUtility('jobs', (c) => testJobs(c, 16), { on: (event, fn) => parent.on(event, fn) });
    parent.emit('message', {
      data: { type: 'taalcut:connect', config: { ...config('jobs'), userData } },
      ports: [new MessageChannel().port1],
    });
    const root = await handle.root;
    if (!root) throw new Error('the jobs process did not compose');
    const moves: string[] = [];
    root.container.resolve(EventBusToken).onAny((event) => {
      if (event.type === 'job.stateChanged' && event.payload.kind === 'demo.quit')
        moves.push(event.payload.to);
    });
    // Like the audio runtime's whisper-server pool: made by the first job that uses it, so newer than the
    // engine and disposed before it; a job still using it when it closes fails for good.
    const PoolToken = createToken<{ closed: Promise<void> }>('test.quitPool');
    let closePool = () => {};
    const closed = new Promise<void>((resolve) => (closePool = resolve));
    root.container.factory(PoolToken, () => ({ closed }), { dispose: () => closePool() });
    let running = () => {};
    const started = new Promise<void>((resolve) => (running = resolve));
    root.container.resolve(JobEngineToken).register(
      defineJob({
        kind: 'demo.quit',
        resourceClass: 'cpu',
        maxAttempts: 1,
        handler: async (_payload: unknown, signal: AbortSignal) => {
          const pool = root.container.resolve(PoolToken);
          running();
          const aborted = new Promise<'aborted'>((resolve) =>
            signal.addEventListener('abort', () => resolve('aborted')),
          );
          if ((await Promise.race([pool.closed.then(() => 'closed'), aborted])) === 'closed')
            throw new Error('the pool closed under the job');
          return ok({ stopped: true });
        },
      }),
    );
    const queued = await root.container
      .resolve(JobQueueToken)
      .enqueue({ kind: 'demo.quit', input: {}, priority: 'high' });
    if (!queued.ok) throw new Error(queued.error.code);
    await started;
    await handle.dispose();
    expect(moves).toEqual(['queued', 'running', 'queued']);
  });
});

describe('utility database', () => {
  it('opens the database main created and migrated, and closes it on dispose', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'taalcut-db-'));
    dirs.push(dir);
    const dbPath = join(dir, 'catalog', 'library.sqlite');
    const main = openDatabase({ path: dbPath });
    if (!main.ok) throw new Error(main.error.code);
    const version = main.value.schemaVersion();
    main.value.close();

    const root = composeStub(config('render', dbPath), 13);
    const db = root.container.resolve(LibraryDatabaseToken);
    expect(db.schemaVersion()).toBe(version);
    await root.container.dispose();
    expect(() => db.schemaVersion()).toThrow();
  });

  it('throws when it can not open the database', () => {
    const root = composeStub(config('lan', '/dev/null/nope/library.sqlite'), 14);
    expect(() => root.container.resolve(LibraryDatabaseToken)).toThrow(/Can't open the library/);
  });
});

describe('runUtility', () => {
  it('composes once on the first connect message and serves every port it is given', async () => {
    const parent = new EventEmitter();
    const compose = vi.fn((c: UtilityConfig) => composeStub(c, 15));
    const handle = runUtility('render', compose, { on: (event, listener) => parent.on(event, listener) });
    const message = { type: 'taalcut:connect', config: config('render') };

    parent.emit('message', { data: message, ports: [] });
    parent.emit('message', {
      data: { ...message, config: config('lan') },
      ports: [new MessageChannel().port1],
    });
    parent.emit('message', { data: 'ping', ports: [new MessageChannel().port1] });
    expect(handle.root).toBeUndefined();

    const clients = [new MessageChannel(), new MessageChannel()].map(({ port1, port2 }) => {
      parent.emit('message', { data: message, ports: [port1] });
      return connectRpc(UTILITY_CONTRACTS.render, port2, { peer: 'render' });
    });
    for (const { client } of clients) expect(await client.diagnostics.ping()).toMatchObject({ pid: 15 });
    expect(compose).toHaveBeenCalledOnce();
    for (const connection of clients) connection.close();
    await handle.dispose();
  });

  it('reports a process that can not compose', async () => {
    const parent = new EventEmitter();
    const onFatal = vi.fn();
    const handle = runUtility(
      'jobs',
      () => {
        throw new Error('no library');
      },
      { on: (event, listener) => parent.on(event, listener) },
      onFatal,
    );
    parent.emit('message', {
      data: { type: 'taalcut:connect', config: config('jobs') },
      ports: [new MessageChannel().port1],
    });
    await handle.root?.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({ message: 'no library' }));
    await expect(handle.dispose()).resolves.toBeUndefined();
    expect(fromRpcError(new Error('x')).code).toBe('core.unknown');
  });
});
