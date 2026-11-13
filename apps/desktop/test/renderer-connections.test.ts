// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A window's port to main: the preload bridge asks, main checks the sender
 * and answers with a port serving the app router, and the page binds it
 * with connectToMain. Electron's ipc, frames and channels are fakes; the
 * oRPC traffic is real.
 */
import { EventEmitter } from 'node:events';
import type { MessagePort } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bridgeEvents,
  connectRpc,
  connectToMain,
  createEventBus,
  eventsContract,
  eventsRouter,
  isMainPortMessage,
  jobsContract,
  jobsRouter,
  newId,
  ok,
  serveRpc,
  systemClock,
  unwrap,
  windowRouter,
  type EventBus,
  type JobQueue,
  type JobSnapshot,
  type MainWorldLike,
  type RecoveryReport,
  type TaalcutError,
  type ThemeService,
  type ThemeState,
  type WindowMessageLike,
} from '@taalcut/core';
import { appRouter } from '../src/main/composition/main-wiring';
import {
  isTrustedFrame,
  serveRendererConnections,
  type ConnectEvent,
  type RendererContext,
} from '../src/main/rpc/renderer-connections';
import { createWindowService } from '../src/main/window-controls';
import { fakeWindow } from './helpers/fake-window';
import { createRpcBridge } from '../src/preload/rpc-bridge';
import { isNonce, isUtilityConnectMessage, RPC_IPC } from '../src/shared/rpc-ipc';
import { closeAllPorts, fakeHost, nodeChannel } from './helpers/fake-utility';
import { recoveryRouter } from '../src/main/composition/main-routers';
import { createUpdateHost } from '../src/main/update/router';
import { composeStub } from '../src/utility/roots/stub-root';

const NOTHING_TO_RECOVER = {
  restoredFromBackup: null,
  unfinishedRuns: [],
  reclaimedJobs: [],
  lastCommands: [],
  needsAttention: false,
};

const ORIGINS = ['app://taalcut'];
afterEach(() => closeAllPorts());

function fakeTheme(): ThemeService {
  let state: ThemeState = { preference: 'system', resolved: 'dark' };
  const listeners = new Set<(next: ThemeState) => void>();
  return {
    get: () => state,
    set(preference) {
      state = { preference, resolved: preference === 'light' ? 'light' : 'dark' };
      for (const listener of listeners) listener(state);
      return state;
    },
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
  };
}

interface Wiring {
  readonly report?: RecoveryReport;
  readonly events?: EventBus;
  /** Stands in for the jobs process's client (main forwards `jobs` to it). */
  readonly jobs?: unknown;
}

/** main + one window: ipcMain, a web contents with one frame, the preload and the page. */
function desktop(url = 'app://taalcut/', parent: unknown = null, wiring: Wiring = {}) {
  const ipcMain = new EventEmitter();
  const contents = Object.assign(new EventEmitter(), { id: 7 });
  const listeners = new Set<(event: WindowMessageLike) => void>();
  const page: MainWorldLike & { postMessage(message: unknown, origin: string, transfer: unknown[]): void } = {
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
    postMessage: (data, _origin, ports) => {
      for (const listener of [...listeners]) listener({ data, source: page, ports: ports as MessagePort[] });
    },
  };
  const preloadIpc = new EventEmitter();
  const frame = {
    url,
    parent,
    postMessage: (channel: string, message: unknown, transfer: MessagePort[]) =>
      preloadIpc.emit(channel, { ports: transfer }, message),
  };
  const bridge = createRpcBridge(
    {
      send: (channel, ...args) => ipcMain.emit(channel, { sender: contents, senderFrame: frame }, ...args),
      on: (channel, listener) => preloadIpc.on(channel, listener),
    },
    page,
  );
  Object.assign(page, { taalcutRpc: bridge });
  const { host: utilities } = fakeHost(() => (config) => composeStub(config));
  const jobs = wiring.jobs;
  const host = jobs
    ? { client: (name: string) => (name === 'jobs' ? jobs : utilities.client(name as never)) }
    : utilities;
  // Web contents 7 is this page's; any other id is someone else's window.
  const ownWin = fakeWindow();
  const own = createWindowService(ownWin, () => 'Minimize');
  const router = appRouter({
    theme: fakeTheme(),
    events: wiring.events ?? createEventBus({ clock: systemClock }),
    host: host as typeof utilities,
    clock: systemClock,
    // Accounts has its own test (accounts.test.ts).
    accounts: {} as never,
    recovery: recoveryRouter({
      state: { report: () => wiring.report ?? NOTHING_TO_RECOVER, seen: () => undefined },
      resume: async () => undefined,
    }),
    window: windowRouter<RendererContext>(({ webContentsId }) => (webContentsId === 7 ? own : null)),
    updates: createUpdateHost({ version: '0.0.0', channel: null, enabled: false }),
    feedback: {
      dsn: '',
      localOnly: () => false,
      build: async () => ({
        fileName: 'bundle.json.gz',
        json: '{}',
        gzip: Buffer.alloc(0),
        sections: [],
        totalBytes: 0,
      }),
      scan: () => ok(undefined),
      choose: async () => null,
      version: '0.0.0',
      channel: '',
    },
    pid: 42,
  });
  const log = vi.fn();
  const connections = serveRendererConnections({
    router,
    trustedOrigins: ORIGINS,
    ipc: {
      on: (channel, listener) => ipcMain.on(channel, listener),
      removeListener: (channel, listener) => ipcMain.removeListener(channel, listener),
    },
    createChannel: nodeChannel,
    log,
  });
  return { page, contents, connections, log, ipcMain, ownWin };
}

describe('a window connecting to main', () => {
  it('gets one port, served with the app router', async () => {
    const { page, connections } = desktop();
    const main = await connectToMain(page, { timeoutMs: 1000 });
    if (!main.ok || !main.value) throw new Error('no connection');
    expect(await main.value.client.theme.get()).toEqual({ preference: 'system', resolved: 'dark' });
    expect(await main.value.client.diagnostics.main.ping()).toMatchObject({ process: 'main', pid: 42 });
    expect(await main.value.client.recovery.report()).toEqual(NOTHING_TO_RECOVER);
    expect(
      await main.value.client.diagnostics.agent
        .ping()
        .catch((e: { data?: { code?: string } }) => e.data?.code),
    ).toBe('core.process_restarted');
    expect(connections.size).toBe(1);
  });

  it('serves the window namespace for the page’s own window, found from the connection', async () => {
    const { page, ownWin } = desktop();
    const main = await connectToMain(page, { timeoutMs: 1000 });
    if (!main.ok || !main.value) throw new Error('no connection');
    const { window } = main.value.client;
    expect(await window.state()).toMatchObject({ focused: true, edited: false, doubleClick: 'minimize' });
    await window.zoom();
    expect(ownWin.isMaximized()).toBe(true);
    await window.doubleClick();
    expect(ownWin.isMinimized()).toBe(true);
  });

  it('replaces the connection when the page asks again, and drops it with the web contents', async () => {
    const { page, contents, connections } = desktop();
    const first = await connectToMain(page, { timeoutMs: 1000 });
    const second = await connectToMain(page, { timeoutMs: 1000 });
    if (!first.ok || !first.value || !second.ok || !second.value) throw new Error('no connection');
    await expect(first.value.client.theme.get()).rejects.toBeDefined();
    expect(await second.value.client.theme.get()).toMatchObject({ preference: 'system' });
    expect(connections.size).toBe(1);
    contents.emit('destroyed');
    expect(connections.size).toBe(0);
  });

  it('refuses frames that are not the app top-level page, and bad nonces', async () => {
    for (const [url, parent] of [
      ['https://example.com/', null],
      ['app://taalcut/', {}],
    ] as const) {
      const { page, log, connections } = desktop(url, parent);
      expect(await connectToMain(page, { timeoutMs: 30 })).toMatchObject({
        ok: false,
        error: { code: 'core.timeout' },
      });
      expect(log).toHaveBeenCalledWith(`[rpc] refused a connection from ${url}`);
      expect(connections.size).toBe(0);
    }
    const { ipcMain, log } = desktop();
    ipcMain.emit(
      RPC_IPC.connect,
      { sender: { id: 1, once: () => undefined }, senderFrame: null } satisfies ConnectEvent,
      'x',
    );
    expect(log).toHaveBeenCalledWith('[rpc] refused a connection from a destroyed frame');
  });

  it('stops accepting after close()', async () => {
    const { page, connections } = desktop();
    connections.close();
    expect(await connectToMain(page, { timeoutMs: 30 })).toMatchObject({ ok: false });
  });
});

describe('what a window gets of an error', () => {
  const failed: TaalcutError = {
    code: 'jobs.download_failed',
    messageKey: 'errors.jobs.download_failed',
    retryable: true,
    detail: 'HTTP 404 from https://models.example/private/x.gguf',
  };
  const { detail: _detail, ...shown } = failed;

  /** The jobs process's side of its port to main: its event bus and its jobs, served as runUtility serves them. */
  function jobsProcess(job: JobSnapshot) {
    const bus = createEventBus({ clock: systemClock });
    const queue = { get: async () => ok(job), list: async () => ok([job]) } as unknown as JobQueue;
    const contract = { events: eventsContract, jobs: jobsContract };
    const { local, remote } = nodeChannel();
    serveRpc({ events: eventsRouter(bus), jobs: jobsRouter(queue) }, local, {
      context: { caller: 'main' },
      exposeDetail: true,
    });
    return { bus, client: connectRpc(contract, remote, { peer: 'jobs' }).client };
  }

  it('has no detail: not on a failed job, its event, or a library restored from a backup', async () => {
    const job: JobSnapshot = {
      id: newId<'Job'>(),
      kind: 'components.install',
      state: 'failed',
      priority: 'normal',
      resource: 'network',
      projectId: null,
      idempotencyKey: null,
      parentId: null,
      attempt: 3,
      maxAttempts: 3,
      progress: null,
      error: failed,
      createdAt: 1,
      updatedAt: 2,
      startedAt: 1,
      finishedAt: 2,
      nextAttemptAt: null,
    };
    const jobs = jobsProcess(job);
    const events = createEventBus({ clock: systemClock });
    const bridge = unwrap(await bridgeEvents(jobs.client.events, events));
    const report: RecoveryReport = {
      ...NOTHING_TO_RECOVER,
      restoredFromBackup: {
        reason: 'corrupt',
        detail: 'quick_check: database disk image is malformed (/Users/someone/Library/library.db)',
        quarantinedPath: null,
        restoredFrom: { path: '/b/1.db', createdAt: 1, schemaVersion: 4, reason: 'daily' },
      },
      needsAttention: true,
    };
    const { page } = desktop('app://taalcut/', null, { report, events, jobs: jobs.client });
    const main = await connectToMain(page, { timeoutMs: 1000 });
    if (!main.ok || !main.value) throw new Error('no connection');
    const window = main.value.client;

    const controller = new AbortController();
    const stream = await window.events.subscribe(
      { types: ['job.stateChanged'] },
      { signal: controller.signal },
    );
    jobs.bus.emit('job.stateChanged', {
      jobId: job.id,
      kind: job.kind,
      projectId: null,
      from: 'running',
      to: 'failed',
      attempt: 3,
      error: failed,
    });
    for await (const event of stream) {
      expect(event.type === 'job.stateChanged' && event.payload.error).toEqual(shown);
      break;
    }
    controller.abort();
    bridge.stop();

    expect((await window.jobs.get({ id: job.id })).error).toEqual(shown);
    expect((await window.jobs.list()).map((listed) => listed.error)).toEqual([shown]);
    const restored = (await window.recovery.report()).restoredFromBackup;
    expect(restored).toMatchObject({ reason: 'corrupt', quarantinedPath: null });
    expect(restored).not.toHaveProperty('detail');
  });
});

describe('IPC guards', () => {
  it('accepts only top-level frames from trusted origins', () => {
    expect(isTrustedFrame({ url: 'app://taalcut/x', parent: null }, ORIGINS)).toBe(true);
    expect(isTrustedFrame({ url: 'app://evil/', parent: null }, ORIGINS)).toBe(false);
    expect(isTrustedFrame(null, ORIGINS)).toBe(false);
  });

  it('checks nonces and messages', () => {
    expect(isNonce('01J0000000000000000000000Z')).toBe(true);
    expect(isNonce('01j0000000000000000000000z')).toBe(false);
    expect(isNonce('x'.repeat(26))).toBe(false);
    expect(isNonce(42)).toBe(false);
    const config = {
      process: 'jobs',
      dbPath: '/db',
      userData: '/u',
      resourcesPath: '/r',
      packaged: true,
      componentManifest: '/r/manifest.signed.json',
    };
    expect(isUtilityConnectMessage({ type: 'taalcut:connect', config })).toBe(true);
    expect(isUtilityConnectMessage({ type: 'taalcut:connect', config: { ...config, dbPath: 1 } })).toBe(
      false,
    );
    expect(isUtilityConnectMessage({ type: 'taalcut:connect', config: { ...config, packaged: 'yes' } })).toBe(
      false,
    );
    expect(isUtilityConnectMessage('taalcut:connect')).toBe(false);
  });

  it('the preload forwards only well-formed port messages and drops bad nonces', () => {
    const preloadIpc = new EventEmitter();
    const send = vi.fn();
    const posted: unknown[] = [];
    const bridge = createRpcBridge(
      { send, on: (channel, listener) => preloadIpc.on(channel, listener) },
      { postMessage: (message) => posted.push(message) },
    );
    bridge.connect('not a nonce');
    expect(send).not.toHaveBeenCalled();
    bridge.connect('01J0000000000000000000000Z');
    expect(send).toHaveBeenCalledWith(RPC_IPC.connect, '01J0000000000000000000000Z');
    preloadIpc.emit(RPC_IPC.port, { ports: [] }, '01J0000000000000000000000Z');
    preloadIpc.emit(RPC_IPC.port, { ports: [{}] }, 'bad');
    preloadIpc.emit(RPC_IPC.port, { ports: [{}] }, '01J0000000000000000000000Z');
    expect(posted).toHaveLength(1);
    expect(isMainPortMessage(posted[0])).toBe(true);
  });
});
