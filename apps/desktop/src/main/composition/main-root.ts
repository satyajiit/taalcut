// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's composition root. In order: open and migrate the library database
 * (before any utility process can open it), apply the saved theme (before
 * the first window), set the app menu, start the utility processes with
 * their ports, bridge their events into main's bus, and serve the app
 * contract to every window that asks for its port. A database that can't be
 * opened ends the launch with an error box: nothing else can work without it.
 */
import {
  callRpc,
  ClockToken,
  createContainer,
  EventBusToken,
  PluginServiceToken,
  SETTINGS_COMMANDS,
  SettingsStoreToken,
  unwrapRpc,
  windowRouter,
  type Container,
  type WindowService,
} from '@taalcut/core';
import { buildRecoveryReport, saveOpenClips } from '@taalcut/library';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  MessageChannelMain,
  systemPreferences,
  webContents,
} from 'electron';
import { LibraryDatabaseToken } from '../../shared/tokens';
import { watchCrashConsent } from '../crash/consent';
import { reportUtilityExit } from '../crash/reporting';
import { electronFilesRouter } from '../files/electron-files';
import { createDesktopImports, ImportRuntimeToken } from '../imports/runtime';
import { createDesktopFeedback } from '../debug/desktop-feedback';
import { startDesktopMcp } from '../mcp/mcp-electron';
import { createOpenClips, type OpenClips } from '../open-clips';
import { startAppLanguage } from '../locale/app-language';
import { serveRendererConnections, type RendererContext } from '../rpc/renderer-connections';
import type { UtilityHost } from '../rpc/utility-host';
import { setupTheme } from '../theme';
import { startDesktopDownloadsNotifications } from '../downloads/downloads-notify-electron';
import { startDesktopRenderNotifications } from '../render/render-notify-electron';
import { createDesktopLanLifecycle } from '../transfer/lan-bridge';
import { noteRecoveryOffered } from '../telemetry/session';
import { createUpdateHost } from '../update/router';
import { VoiceCaptureStoreToken } from '../voice/register';
import { voiceCaptureRouter } from '../voice/voice-capture-router';
import { createWindowService } from '../window-controls';
import { accountsRouter, recoveryRouter } from './main-routers';
import { createRecoveryState, watchAgentRestarts } from './run-recovery';
import {
  AccountsToken,
  AuthBrokerToken,
  registerMain,
  SecretStoreToken,
  type MainRootOptions,
} from './main-register';
import {
  appRouter,
  bridgeUtilityEvents,
  forwardPower,
  logSupervisor,
  PowerStateToken,
  UtilityHostToken,
} from './main-wiring';
import { themeSetting } from './theme-setting';
import { pluginsRouter, pluginsSetupRouter } from '../plugins/plugin-routers';
import { watchPluginPrivacy } from '../plugins/plugin-privacy';
import { createDesktopProductBackground } from '../background/composition';
import { ProductBackgroundToken, type ProductBackground } from '../background/product-background';
import { productBackgroundRouter } from '../background/router';

export { libraryPath, type MainRootOptions } from './main-register';

export interface MainRoot {
  readonly background: ProductBackground;
  readonly container: Container;
  readonly host: UtilityHost;
  /** Every window is watched (open-clips.ts): the clip it shows stays in the media cache. */
  readonly openClips: OpenClips;
}

/** The window whose page owns the connection, as a WindowService (one per window). */
function ownWindow(readDoubleClick: () => string | null) {
  const services = new WeakMap<BrowserWindow, WindowService>();
  return ({ webContentsId }: RendererContext): WindowService | null => {
    const contents = webContents.fromId(webContentsId);
    const win = contents ? BrowserWindow.fromWebContents(contents) : null;
    if (!win || win.isDestroyed()) return null;
    let service = services.get(win);
    if (!service) {
      service = createWindowService(win, readDoubleClick, () => BrowserWindow.getAllWindows());
      services.set(win, service);
    }
    return service;
  };
}

export async function composeMain(options: MainRootOptions): Promise<MainRoot | undefined> {
  const container = createContainer();
  registerMain(container, options);
  let db;
  try {
    db = container.resolve(LibraryDatabaseToken);
  } catch (cause) {
    console.error('[main] could not open the library', cause);
    dialog.showErrorBox('Taalcut could not open its library', String((cause as Error).message));
    app.exit(1);
    return undefined;
  }
  // The clips the windows show, whose files the jobs process's media cache keeps, across its restarts too: written
  // empty now, before any utility process starts (open-clips.ts).
  const openClips = createOpenClips((assetIds) => {
    const saved = saveOpenClips(db, assetIds);
    if (!saved.ok) console.warn(`[library] the open clips weren't saved: ${saved.error.code}`);
    return saved.ok;
  });
  const events = container.resolve(EventBusToken);
  const host = container.resolve(UtilityHostToken);
  const clock = container.resolve(ClockToken);
  const lan = createDesktopLanLifecycle(host, clock);
  const imports = createDesktopImports(container, options, host, lan);
  container.value(ImportRuntimeToken, imports);

  // The theme: saved in the library, changed through the bus, shown before the first window.
  const themeStore = themeSetting({
    settings: container.resolve(SettingsStoreToken),
    events,
    dispatch: (preference) =>
      host.client('agent').commands.dispatch({
        name: SETTINGS_COMMANDS.setTheme,
        payload: { preference },
        source: 'ui',
      }),
  });
  const saved = await themeStore.read();
  const { platform } = options;
  const theme = setupTheme(
    saved.ok ? saved.value : 'system',
    (preference) => themeStore.save(preference),
    platform.window,
  );
  themeStore.watch((preference) => theme.apply(preference));
  theme.subscribe((state) => events.emit('theme.changed', state));

  // The app's language (P3-L2): main resolves it, serves it to every window and builds its menu in it.
  const language = await startAppLanguage({
    words: platform.words,
    settings: container.resolve(SettingsStoreToken),
    events,
    preferred: () => app.getPreferredSystemLanguages(),
    menu: {
      appName: app.name,
      development: options.runtime.devTools,
      packaged: options.runtime.packaged,
      env: process.env,
      policy: platform.menu,
      show: (template) => Menu.setApplicationMenu(Menu.buildFromTemplate(template)),
    },
  });

  const background = await createDesktopProductBackground({
    settings: container.resolve(SettingsStoreToken),
    host,
    i18n: language.i18n,
    userData: options.userData,
    packaged: options.runtime.packaged,
    openProduct: options.openProduct ?? (() => undefined),
  });
  container.value(ProductBackgroundToken, background);

  // The user's own servers (Advanced), registered for key and server tests here.
  const accounts = container.resolve(AccountsToken);
  void accounts.service.load().then((loaded) => {
    if (!loaded.ok) console.warn(`[accounts] local servers not loaded: ${loaded.error.code}`);
  });

  logSupervisor(host);
  // "Notify me": a system notification when a render the user asked about finishes (render.finished).
  startDesktopRenderNotifications(events, language.i18n);
  // UX2-DOWNLOADER: one when the download of everything this Mac needs has finished.
  startDesktopDownloadsNotifications(events, language.i18n);
  bridgeUtilityEvents(host, events, undefined, lan);
  const stopPluginPrivacy = watchPluginPrivacy(events, container.resolve(PluginServiceToken));
  // Runs an agent crash cuts off are offered again, as at launch (P1-D5).
  const recovery = createRecoveryState({
    initial: db.opened.recovery,
    read: () => buildRecoveryReport(db, null, { reclaimJobs: 'none' }),
    events,
  });
  watchAgentRestarts(host.supervisor, () => recovery.agentRestarted());
  noteRecoveryOffered(host, recovery.report());
  const stopRecoveryTelemetry = events.on('recovery.changed', () =>
    noteRecoveryOffered(host, recovery.report()),
  );
  const feedback = createDesktopFeedback({
    host,
    userData: options.userData,
    homeDir: app.getPath('home'),
    version: app.getVersion(),
    channel: __TAALCUT_UPDATE_CHANNEL__,
    flavour: __TAALCUT_FLAVOUR__,
    osLabel: platform.label,
    dsn: options.crashDsn ?? __TAALCUT_CRASH_DSN__,
    gpu: options.gpu,
    recovery: () => recovery.report(),
  });
  const stopConsent = watchCrashConsent({
    settings: container.resolve(SettingsStoreToken),
    events,
    userData: options.userData,
    onMirror: (mirror) => feedback.notePrivacy(mirror),
  });
  const secrets = container.resolve(SecretStoreToken);
  void feedback.refreshSecrets(secrets);
  const stopSecrets = container.resolve(AuthBrokerToken).onChange(() => {
    void feedback.refreshSecrets(secrets);
  });
  // External agents (P3-V4): the mcp process while the setting is on, and Settings' session setup.
  const mcp = startDesktopMcp(container, { host, vault: secrets, events, options, i18n: language.i18n });
  const stopExitReports = host.supervisor.on((event) => {
    if (event.type !== 'exited') return;
    void reportUtilityExit({ name: event.name, code: event.code, expected: event.expected });
  });
  // powerMonitor exists only in main; the job engine in the jobs process throttles on it.
  forwardPower(host, container.resolve(PowerStateToken));
  const bakedChannel =
    __TAALCUT_UPDATE_FEED__ !== '' && __TAALCUT_UPDATE_CHANNEL__ !== '' ? __TAALCUT_UPDATE_CHANNEL__ : null;
  const updates = createUpdateHost({
    version: app.getVersion(),
    channel: bakedChannel,
    // Updates install themselves on a Mac alone (Squirrel.Mac, latest-mac.yml): elsewhere About says none run.
    enabled: __TAALCUT_UPDATE_FEED__ !== '' && platform.abilities.selfUpdate,
  });
  const connections = serveRendererConnections({
    router: appRouter({
      productBackground: productBackgroundRouter(background),
      theme,
      events,
      host,
      clock,
      onTransferCall: () => lan.onTransferCall(),
      onDevicesWatch: (open) => lan.onDevicesWatch(open),
      onRenderCall: () => host.start('render'),
      accounts: accountsRouter(accounts),
      plugins: pluginsRouter(container.resolve(PluginServiceToken)),
      pluginsSetup: pluginsSetupRouter(container.resolve(PluginServiceToken), clipboard),
      recovery: recoveryRouter({
        state: recovery,
        resume: async (runIds) =>
          unwrapRpc(await callRpc(host.client('agent').runs.resume({ runIds: [...runIds] }))),
      }),
      // The system's title-bar double-click setting (macOS's; none elsewhere), or a test build's switch.
      window: windowRouter<RendererContext>(
        ownWindow(options.doubleClick ?? (() => platform.titleBarDoubleClick(systemPreferences))),
      ),
      updates,
      feedback: feedback.deps,
      files: electronFilesRouter(container, host),
      imports: imports.router,
      wrapTransferClient: imports.wrapTransferClient,
      mcpSetup: mcp.router,
      locale: language.router,
      voiceCapture: voiceCaptureRouter(
        container.resolve(VoiceCaptureStoreToken),
        platform.microphone(systemPreferences),
      ),
    }),
    trustedOrigins: options.runtime.trustedOrigins,
    ipc: ipcMain,
    createChannel: () => {
      const { port1, port2 } = new MessageChannelMain();
      return { local: port1, remote: port2 };
    },
    log: (message) => console.warn(message),
  });
  host.startEager();

  // Quitting kills the children; they must not be restarted on the way out.
  let importsClosed = false;
  let importsClosing = false;
  app.on('before-quit', (event) => {
    background.dispose();
    if (!importsClosed) {
      event.preventDefault();
      if (!importsClosing) {
        importsClosing = true;
        void imports
          .close()
          .finally(async () => {
            lan.dispose();
            await host.stopAll();
          })
          .finally(() => {
            importsClosed = true;
            app.quit();
          })
          .catch(() => console.error('[imports] shutdown did not finish cleanly'));
      }
      return;
    }
  });
  app.on('will-quit', () => {
    stopRecoveryTelemetry();
    stopPluginPrivacy();
    stopConsent();
    stopSecrets();
    stopExitReports();
    mcp.stop();
    language.stop();
    connections.close();
    void container.dispose();
  });
  return { container, host, openClips, background };
}
