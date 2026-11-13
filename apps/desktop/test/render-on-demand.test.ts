// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The render process starts on demand (packages/render SPEC section 1): a
 * window's first renders.* call, or a forwarded worker call from the jobs or
 * agent process, brings it up, and the call reaches it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appContract,
  connectRpc,
  createEventBus,
  MAIN_SERVICE_CONTRACTS,
  newId,
  ok,
  serveRpc,
  systemClock,
  windowRouter,
} from '@taalcut/core';
import { appRouter } from '../src/main/composition/main-wiring';
import { mainServicesRouter, recoveryRouter } from '../src/main/composition/main-routers';
import { createUpdateHost } from '../src/main/update/router';
import type { RendererContext } from '../src/main/rpc/renderer-connections';
import { composeStub } from '../src/utility/roots/stub-root';
import { closeAllPorts, fakeHost, nodeChannel } from './helpers/fake-utility';

afterEach(() => closeAllPorts());

const noCredentials = {
  get: async () => ok(undefined),
  invalidate: () => undefined,
  statuses: async () => ok([]),
};
const codeOf = (error: unknown) => (error as { data?: { code?: string } }).data?.code;

function renderHost() {
  return fakeHost(() => (config) => composeStub(config));
}

describe('render on demand', () => {
  it('starts the render process on a window’s renders.* call and forwards the call to it', async () => {
    const { host } = renderHost();
    const start = vi.spyOn(host, 'start');
    const router = appRouter({
      theme: {
        get: () => ({ preference: 'system', resolved: 'dark' }),
        set: () => ({ preference: 'system', resolved: 'dark' }),
        subscribe: () => () => undefined,
      },
      events: createEventBus({ clock: systemClock }),
      host,
      clock: systemClock,
      accounts: {} as never,
      recovery: recoveryRouter({
        state: {
          report: () => ({
            restoredFromBackup: null,
            unfinishedRuns: [],
            reclaimedJobs: [],
            lastCommands: [],
            needsAttention: false,
          }),
          seen: () => undefined,
        },
        resume: async () => undefined,
      }),
      window: windowRouter<RendererContext>(() => null),
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
      onRenderCall: () => host.start('render'),
    });
    const { local, remote } = nodeChannel();
    serveRpc(router, local, { context: { caller: 'renderer' as const, webContentsId: 7 } });
    const client = connectRpc(appContract, remote, { peer: 'main' }).client;

    expect(host.supervisor.pid('render')).toBeUndefined();
    // The stub render process answers core.not_implemented: the call got there, it wasn't dropped.
    expect(await client.renders.presets().catch(codeOf)).toBe('core.not_implemented');
    expect(start).toHaveBeenCalledWith('render');
    expect(host.supervisor.pid('render')).toBeDefined();
    // Other namespaces don't start it.
    start.mockClear();
    await client.theme.get();
    expect(start).not.toHaveBeenCalled();
    await host.stopAll();
  });

  it('starts it for the jobs process’s forwarded render worker (the export job)', async () => {
    const { host } = renderHost();
    const { local, remote } = nodeChannel();
    serveRpc(mainServicesRouter('jobs', { broker: noCredentials, host }), local, { context: {} });
    const client = connectRpc(MAIN_SERVICE_CONTRACTS.jobs, remote, { peer: 'main' }).client;
    const input = {
      projectId: newId<'Project'>(),
      timelineId: newId<'Timeline'>(),
      frame: 0,
      source: { kind: 'preview' as const },
    };
    expect(await client.render.captureFrame(input).catch(codeOf)).toBe('core.not_implemented');
    expect(host.supervisor.pid('render')).toBeDefined();
    await host.stopAll();
  });

  it('starts it for the agent’s forwarded render worker (frame captures)', async () => {
    const { host } = renderHost();
    const { local, remote } = nodeChannel();
    serveRpc(mainServicesRouter('agent', { broker: noCredentials, host }), local, { context: {} });
    const client = connectRpc(MAIN_SERVICE_CONTRACTS.agent, remote, { peer: 'main' }).client;
    const input = {
      projectId: newId<'Project'>(),
      timelineId: newId<'Timeline'>(),
      frame: 3,
      source: { kind: 'preview' as const },
    };
    expect(await client.render.captureFrame(input).catch(codeOf)).toBe('core.not_implemented');
    expect(host.supervisor.pid('render')).toBeDefined();
    await host.stopAll();
  });

  it('without start (older callers) still forwards to whatever render process runs', async () => {
    const { host } = renderHost();
    const { local, remote } = nodeChannel();
    serveRpc(
      mainServicesRouter('jobs', { broker: noCredentials, host: { client: (name) => host.client(name) } }),
      local,
      {
        context: {},
      },
    );
    const client = connectRpc(MAIN_SERVICE_CONTRACTS.jobs, remote, { peer: 'main' }).client;
    const input = {
      projectId: newId<'Project'>(),
      timelineId: newId<'Timeline'>(),
      frame: 0,
      source: { kind: 'preview' as const },
    };
    expect(await client.render.captureFrame(input).catch(codeOf)).toBe('core.process_restarted');
  });
});
