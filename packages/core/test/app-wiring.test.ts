// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The pieces together, as apps/desktop will wire them: the renderer calls the
 * app contract on one port to main; main serves theme and events itself and
 * forwards commands to the agent process. The agent's command bus reports
 * changes as events, which reach the renderer through main.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  APP_ROUTES,
  MAIN_SERVICE_CONTRACTS,
  appContract,
  bridgeEvents,
  commandsRouter,
  connectRpc,
  createEventBus,
  diagnosticsRouter,
  eventsRouter,
  forwardCommandEvents,
  implementContract,
  mainDiagnosticsRouter,
  routeAppContract,
  serveRpc,
  systemClock,
  unwrap,
  UTILITY_CONTRACTS,
  UTILITY_NAMES,
  type AppClient,
  type RoutedTo,
  type TaalcutEvent,
  type UtilityClients,
  type UtilityContracts,
  type UtilityName,
} from '@taalcut/core';
import { setupBus } from './helpers/bus';
import { createFakeTheme, notServed, themeRouter } from './helpers/fixtures';
import { channel, mainChannel, tick } from './helpers/ports';

/** The agent's namespaces this test doesn't call; each has its own test. */
const AGENT_ELSEWHERE = [
  'creation',
  'models',
  'usage',
  'traces',
  'chat',
  'consents',
  'runs',
  'credentials',
  'system',
  'templates',
  'timelines',
  'acknowledgements',
  'budget',
  'privacy',
  'onboarding',
  'speech',
  'interfaceSounds',
  'telemetry',
  'telemetryIngest',
  'debugBundle',
  'library',
  'projects',
  'backgroundModels',
  'styles',
  'hub',
  'mcp',
  'mcpGateway',
  'mcpSessions',
  'memory',
  'comments',
  'workspace',
  'products',
  'productPublishing',
  'productWake',
] as const;
/** Main's own namespaces this test doesn't call. */
const MAIN_ELSEWHERE = [
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
] as const;

async function startDesktop() {
  // Agent process: command bus + event bus, serving its contract.
  const agent = setupBus();
  const agentEvents = createEventBus({ clock: systemClock });
  forwardCommandEvents(agent.bus, agentEvents);
  const os = implementContract(UTILITY_CONTRACTS.agent);
  const agentRouter = os.router({
    diagnostics: diagnosticsRouter({ process: 'agent', pid: 101, clock: systemClock }),
    commands: commandsRouter(agent.bus),
    events: eventsRouter(agentEvents),
    ...notServed(...AGENT_ELSEWHERE),
  });
  const agentPorts = mainChannel();
  serveRpc(agentRouter, agentPorts.port1, { context: { caller: 'main' } });
  const agentClient = connectRpc(UTILITY_CONTRACTS.agent, agentPorts.port2, { peer: 'agent' }).client;

  // Main: its own bus fed by the agent's, theme handled locally, the rest forwarded.
  const mainEvents = createEventBus({ clock: systemClock });
  unwrap(await bridgeEvents(agentClient.events, mainEvents));
  const utility = ((process: UtilityName) => {
    if (process === 'agent') return agentClient;
    throw new Error(`The ${process} process is not part of this test`);
  }) as UtilityClients;
  const mainRouter = routeAppContract(
    {
      theme: themeRouter(createFakeTheme('dark')),
      events: eventsRouter(mainEvents),
      diagnostics: mainDiagnosticsRouter({ pid: 100, clock: systemClock }, utility),
      ...notServed(...MAIN_ELSEWHERE),
    },
    utility,
  );
  const rendererPorts = channel();
  serveRpc(mainRouter, rendererPorts.port1, { context: { caller: 'renderer' } });
  const renderer: AppClient = connectRpc(appContract, rendererPorts.port2, { peer: 'main' }).client;
  return { renderer, agent };
}

describe('app wiring', () => {
  it('routes every namespace the renderer calls to a process', () => {
    expect(Object.keys(APP_ROUTES).sort()).toEqual(Object.keys(appContract).sort());
  });

  it('every namespace routed to a utility process is in that process contract, unchanged', () => {
    expectTypeOf<UtilityContracts['agent']>().toExtend<RoutedTo<'agent'>>();
    expectTypeOf<UtilityContracts['jobs']>().toExtend<RoutedTo<'jobs'>>();
    expectTypeOf<UtilityContracts['render']>().toExtend<RoutedTo<'render'>>();
    expectTypeOf<UtilityContracts['lan']>().toExtend<RoutedTo<'lan'>>();
    expectTypeOf<UtilityContracts['mcp']>().toExtend<RoutedTo<'mcp'>>();
    for (const [namespace, owner] of Object.entries(APP_ROUTES)) {
      if (owner === 'main') continue;
      const served = UTILITY_CONTRACTS[owner] as Record<string, unknown>;
      expect(served[namespace]).toBe(appContract[namespace as keyof typeof appContract]);
    }
  });

  it('routes the Phase 3 namespaces and serves the mcp and lan processes what they need', () => {
    expect(APP_ROUTES).toMatchObject({
      styles: 'agent',
      hub: 'agent',
      mcp: 'agent',
      mcpSetup: 'main',
      locale: 'main',
      voiceCapture: 'main',
    });
    // The gateway is never a window's: the agent serves it, main forwards it to the mcp process.
    expect(Object.keys(appContract)).not.toContain('mcpGateway');
    expect(UTILITY_CONTRACTS.agent.mcpGateway).toBe(MAIN_SERVICE_CONTRACTS.mcp.gateway);
    expect(Object.keys(UTILITY_CONTRACTS.mcp).sort()).toEqual(['diagnostics', 'events']);
    expect(Object.keys(MAIN_SERVICE_CONTRACTS.lan).sort()).toEqual(['deviceKeys', 'telemetry']);
    expect(Object.keys(MAIN_SERVICE_CONTRACTS.agent)).toContain('voiceCaptureFiles');
    expect(UTILITY_NAMES).toContain('mcp');
  });

  it('answers diagnostics in main and forwards them to the agent', async () => {
    const { renderer } = await startDesktop();
    expect(await renderer.diagnostics.main.ping()).toMatchObject({ process: 'main', pid: 100 });
    expect(await renderer.diagnostics.agent.ping()).toMatchObject({ process: 'agent', pid: 101 });
    expect(await renderer.diagnostics.agent.echo({ text: 'namaste' })).toEqual({
      text: 'namaste',
      process: 'agent',
    });
    const ticks = [];
    for await (const tick of await renderer.diagnostics.agent.ticks({ count: 3 })) ticks.push(tick.seq);
    expect(ticks).toEqual([0, 1, 2]);
    await expect(renderer.diagnostics.jobs.ping()).rejects.toMatchObject({
      data: { code: 'core.unknown' },
    });
  });

  it('renames a project from the renderer through main to the agent, and the change event comes back', async () => {
    const { renderer, agent } = await startDesktop();
    const controller = new AbortController();
    const events: TaalcutEvent[] = [];
    const stream = await renderer.events.subscribe(
      { types: ['command.changed'] },
      { signal: controller.signal },
    );
    const reading = (async () => {
      for await (const event of stream) events.push(event);
    })();

    expect(await renderer.theme.get()).toEqual({ preference: 'system', resolved: 'dark' });
    const receipt = await renderer.commands.dispatch({
      name: 'project.rename',
      payload: { projectId: agent.projectId, name: 'Trip to Goa' },
    });
    expect(agent.projects.nameOf(agent.projectId)).toBe('Trip to Goa');
    await renderer.commands.undo({ projectId: agent.projectId, source: 'shortcut' });
    expect(agent.projects.nameOf(agent.projectId)).toBe('Untitled');

    await tick(30);
    controller.abort();
    await reading.catch(() => undefined);
    expect(events.map((event) => event.payload)).toMatchObject([
      { kind: 'executed', id: receipt.id, source: 'ui', actor: 'user' },
      { kind: 'undone', id: receipt.id, source: 'shortcut' },
    ]);
    expect(agent.store.entries()[0]).toMatchObject({ source: 'ui', actor: 'user', undone: true });
  });
});
