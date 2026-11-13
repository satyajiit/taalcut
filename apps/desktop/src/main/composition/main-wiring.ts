// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Electron-free half of main's composition: the router every window is
 * served, the event bridge from the utility processes, supervisor logging
 * and power forwarding. Unit-tested with a fake UtilityHost.
 */
import {
  bridgeEvents,
  createToken,
  eventsRouter,
  filesContract,
  importsContract,
  mainDiagnosticsRouter,
  mcpSetupContract,
  pluginsContract,
  pluginsSetupContract,
  productBackgroundContract,
  notServedRouter,
  routeAppContract,
  themeRouter,
  type AppContract,
  type Clock,
  type EventBus,
  type MainRouters,
  type RpcRouter,
  type ThemeService,
  type UtilityClients,
  type UtilityName,
} from '@taalcut/core';
import type { PowerState } from '../power/power-state';
import type { RendererContext } from '../rpc/renderer-connections';
import type { UtilityHost } from '../rpc/utility-host';
import { trackDevicesWatch, watchLanDevices, watchLanEvents } from '../transfer/lan-bridge';
import type { LanLifecycle } from '../transfer/lan-lifecycle';
import { crashesRouter } from '../crash/reporting';
import { feedbackRouter, type FeedbackDeps } from '../debug/feedback';
import { updatesRouter, type UpdateHost } from '../update/router';
import type { localeRouter } from '../locale/locale-host';
import { mainPhase3Routers } from './phase3-namespaces';

export const UtilityHostToken = createToken<UtilityHost>('desktop.utilityHost');
/** Desktop only: battery and thermal state from powerMonitor (main only). */
export const PowerStateToken = createToken<PowerState & { dispose(): void }>('desktop.powerState');

type Host = Pick<UtilityHost, 'client' | 'onConnected'>;

export interface AppRouterDeps {
  readonly productBackground?: MainRouters<RendererContext>['productBackground'];
  readonly theme: ThemeService;
  readonly events: EventBus;
  readonly host: Pick<UtilityHost, 'client'>;
  readonly clock: Clock;
  /** Settings → Accounts (accountsRouter over the AuthBroker). */
  readonly accounts: MainRouters<RendererContext>['accounts'];
  /** This launch's crash-recovery report (recoveryRouter). */
  readonly recovery: MainRouters<RendererContext>['recovery'];
  /** The caller's own window, for the window bar (windowRouter over window-controls.ts). */
  readonly window: MainRouters<RendererContext>['window'];
  /** Settings → About (P2-X6). The same host startAutoUpdate feeds. */
  readonly updates: UpdateHost;
  /** Help → Send feedback and the debug bundle (P2-X5). */
  readonly feedback: FeedbackDeps;
  /** The app's language (P3-L2, locale/locale-host.ts). Default: not served (tests). */
  readonly locale?: ReturnType<typeof localeRouter>;
  /** Open panels, Finder and System Settings (files-router.ts). Default: not served (tests). */
  readonly files?: MainRouters<RendererContext>['files'];
  readonly imports?: MainRouters<RendererContext>['imports'];
  /** Recording a voice consent (voice/voice-capture-router.ts). Default: not served (tests). */
  readonly voiceCapture?: MainRouters<RendererContext>['voiceCapture'];
  /** Settings › External agents: sessions and their setup text (main/mcp). Default: not served (tests). */
  readonly mcpSetup?: MainRouters<RendererContext>['mcpSetup'];
  readonly plugins?: MainRouters<RendererContext>['plugins'];
  readonly pluginsSetup?: MainRouters<RendererContext>['pluginsSetup'];
  /** Starts the lan utility on a transfer.* call (cancels a pending 60s stop). */
  readonly onTransferCall?: () => void;
  readonly wrapTransferClient?: <C extends object>(client: C) => C;
  /** True while a window iterates transfer.devices, false when that iteration ends. */
  readonly onDevicesWatch?: (open: boolean) => void;
  /** Starts the render utility (on demand) on a renders.* call; nothing if it runs. */
  readonly onRenderCall?: () => void;
  readonly pid?: number;
}

/**
 * What each window's port serves: theme, its own window, events,
 * diagnostics, accounts and recovery here, the rest forwarded (APP_ROUTES).
 */
export function appRouter(deps: AppRouterDeps): RpcRouter<AppContract, RendererContext> {
  const devicesNote = deps.onDevicesWatch ? trackDevicesWatch(deps.onDevicesWatch) : undefined;
  const utility: UtilityClients = (process) => {
    if (process === 'lan') deps.onTransferCall?.();
    if (process === 'render') deps.onRenderCall?.();
    const raw = deps.host.client(process);
    const client = process === 'lan' && deps.wrapTransferClient ? deps.wrapTransferClient(raw) : raw;
    if (process !== 'lan' || devicesNote === undefined) return client;
    return watchLanDevices(client, devicesNote);
  };
  return routeAppContract<RendererContext>(
    {
      theme: themeRouter(deps.theme),
      window: deps.window,
      events: eventsRouter(deps.events),
      diagnostics: mainDiagnosticsRouter({ pid: deps.pid ?? process.pid, clock: deps.clock }, utility),
      accounts: deps.accounts,
      productBackground:
        deps.productBackground ??
        notServedRouter<typeof productBackgroundContract, RendererContext>(
          productBackgroundContract,
          'productBackground',
        ),
      plugins:
        deps.plugins ?? notServedRouter<typeof pluginsContract, RendererContext>(pluginsContract, 'plugins'),
      pluginsSetup:
        deps.pluginsSetup ??
        notServedRouter<typeof pluginsSetupContract, RendererContext>(pluginsSetupContract, 'pluginsSetup'),
      recovery: deps.recovery,
      // Desktop's Phase 2 work packages (P2-X5 crash reports and feedback, P2-X6 updates, P2-X4 files).
      feedback: feedbackRouter(deps.feedback),
      updates: updatesRouter(deps.updates),
      crashes: crashesRouter(),
      imports:
        deps.imports ?? notServedRouter<typeof importsContract, RendererContext>(importsContract, 'imports'),
      files: deps.files ?? notServedRouter<typeof filesContract, RendererContext>(filesContract, 'files'),
      ...mainPhase3Routers({
        ...(deps.locale ? { locale: deps.locale } : {}),
        ...(deps.voiceCapture ? { voiceCapture: deps.voiceCapture } : {}),
      }),
      mcpSetup:
        deps.mcpSetup ??
        notServedRouter<typeof mcpSetupContract, RendererContext>(mcpSetupContract, 'mcpSetup'),
    },
    utility,
  );
}

/**
 * Republishes each utility process's events on main's bus, so windows see
 * them; subscribes again after every restart. A bridge that ends because
 * the process died is expected; anything else is logged.
 */
export function bridgeUtilityEvents(
  host: Host,
  events: EventBus,
  log: (message: string) => void = (message) => console.warn(message),
  lan?: Pick<LanLifecycle, 'onSession' | 'onFile'> & Partial<Pick<LanLifecycle, 'onDeviceRun'>>,
): () => void {
  const stopLan = lan ? watchLanEvents(events, lan) : () => undefined;
  const onConnected = async (process: UtilityName): Promise<void> => {
    const bridge = await bridgeEvents(host.client(process).events, events);
    if (!bridge.ok) {
      if (bridge.error.code !== 'core.process_restarted') log(`[events] ${process}: ${bridge.error.code}`);
      return;
    }
    const done = await bridge.value.done;
    if (!done.ok && done.error.code !== 'core.process_restarted')
      log(`[events] ${process}: ${done.error.code}`);
  };
  const stopBridge = host.onConnected((process) => void onConnected(process));
  return () => {
    stopBridge();
    stopLan();
  };
}

/** Supervisor events to the log: crashes, restarts, failed forks, SIGKILLs after a stop. */
export function logSupervisor(
  host: Pick<UtilityHost, 'supervisor'>,
  log: Pick<Console, 'warn' | 'error'> = console,
): () => void {
  return host.supervisor.on((event) => {
    if (event.type === 'exited' && !event.expected) {
      log.warn(`[utility] ${event.name} exited with code ${event.code}`);
    } else if (event.type === 'restart-scheduled') {
      log.warn(`[utility] restarting ${event.name} in ${event.delayMs} ms (attempt ${event.attempt + 1})`);
    } else if (event.type === 'spawn-failed') {
      log.error(`[utility] could not start ${event.name}: ${event.detail}`);
    } else if (event.type === 'kill-escalated') {
      log.warn(`[utility] ${event.name} did not exit after SIGTERM; sent SIGKILL to pid ${event.pid}`);
    }
  });
}

/**
 * Sends the jobs process the current power snapshot each time it connects,
 * and every change after. A jobs process that is down misses nothing: it gets
 * the current snapshot when it is back.
 */
export function forwardPower(host: Host, power: PowerState): () => void {
  const send = (): void => {
    void host
      .client('jobs')
      .power.update(power.current())
      .catch(() => undefined);
  };
  const offConnected = host.onConnected((process) => {
    if (process === 'jobs') send();
  });
  const offChange = power.onChange(send);
  return () => {
    offConnected();
    offChange();
  };
}
