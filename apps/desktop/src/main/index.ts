// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main process entry: the composition root. It stays thin (PRD 6.1): it
 * hardens Electron, serves the renderer over app://, owns the theme,
 * supervises the utility processes and checks for updates. Heavy work never
 * runs here.
 *
 * Test-only code sits behind `__TAALCUT_FLAVOUR__ === 'test'` and is loaded
 * with import(), so release bundles don't contain it.
 */
import { join } from 'node:path';
import { EventBusToken, SettingsStoreToken, type Container, type ProductId } from '@taalcut/core';
import type { ModelRuntimeOptions } from '@taalcut/models';
import { app, powerMonitor, session, type BrowserWindow as MainWindow } from 'electron';
import { hostPlatform, PlatformServicesToken } from '../platform';
import { mediaCacheRoot } from '../shared/media-cache';
import { styleAssetsDir, templateAssetsDir } from '../shared/template-assets';
import { sweepCompileCache } from './compile-cache/start';
import { bootCrashReporting, endCrashReportingRun, reportRenderProcessGone } from './crash/reporting';
import { machineNames } from './crash/scrub-sources';
import { composeMain } from './composition/main-root';
import { createGpuInfo, logCpuFallbacks } from './gpu/gpu-info';
import { ImportRuntimeToken } from './imports/runtime';
import type { ImportPreviewHandler } from './protocol/import-previews';
import { handleAppScheme, registerAppScheme } from './protocol/app-protocol';
import { libraryOriginals } from './protocol/original-media';
import { libraryTemplateReels } from './protocol/template-reel';
import { previewCspFor } from './render/preview-protocol';
import { resolveRuntime } from './runtime';
import { hardenAllWebContents, hardenSession, refuseUnsafeSwitches } from './security/harden';
import { recordSessionShown } from './telemetry/session';
import { channelInForce } from './update/channel-setting';
import { resolveUpdateFeed } from './update/feed';
import { checkUpdateLaunch, refuseRealProfileInTestBuild, watchUpdateLaunch } from './update/launch-guard';
import { DEFAULT_SCHEDULE } from './update/updater';
import { createMicrophoneGate } from './voice/microphone-gate';
import { VoiceCaptureStoreToken } from './voice/register';
import { createMainWindow } from './window';
import { backgroundLaunchIntents, foregroundWindow, isBackgroundLaunch } from './background/lifecycle';

// Bundled layout: out/main/index.mjs, out/preload/index.cjs, out/utility/<process>.mjs, out/renderer/.
const OUT_DIR = join(import.meta.dirname, '..');
const PRELOAD = join(OUT_DIR, 'preload', 'index.cjs');
const RENDERER_DIR = join(OUT_DIR, 'renderer');
const UTILITY_DIR = join(OUT_DIR, 'utility');

// First, before Chromium starts its DevTools server.
if (!refuseUnsafeSwitches()) {
  if (__TAALCUT_FLAVOUR__ === 'test' && app.commandLine.hasSwitch('taalcut-self-test')) {
    void runSelfTest();
  } else {
    startApp();
  }
}

function startApp(): void {
  if (refuseRealProfileInTestBuild()) return;
  // Tests isolate userData with Chromium's --user-data-dir switch, which Electron honours.
  const runtime = resolveRuntime(process.env, app.isPackaged);
  const backgroundLaunch = isBackgroundLaunch(process.argv);
  const intents = backgroundLaunchIntents();
  let backgroundEnabled = () => false;
  let pendingProduct: ProductId | undefined;
  // This OS's services (platform/), chosen once and handed to everything below that differs by OS.
  const platform = hostPlatform();
  // Before ready: Chromium reads its switches when it starts. Only ones measured as needed (desktop SPEC).
  for (const { name, value } of platform.electronSwitches) app.commandLine.appendSwitch(name, value);

  // Everything up to whenReady must happen before 'ready'.
  registerAppScheme();
  app.enableSandbox();
  hardenAllWebContents(runtime);

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  // P3-B9: count a new version's launches before anything can crash; the guard may take over from here.
  const launch = checkUpdateLaunch({ background: backgroundLaunch });
  if (!launch) return;
  app.on('second-instance', (_event, argv) => intents.receive(argv));
  // Background scheduling keeps the process alive after the last window closes.
  app.on('window-all-closed', () => {
    if (platform.menu.quitWhenAllWindowsClosed && !backgroundEnabled()) app.quit();
  });
  // ADR 0002: hardware acceleration is never disabled. Created before ready to catch the GPU's first report;
  // Settings → About and the hardware tier will get it with the oRPC wiring (P1-C3).
  const gpu = createGpuInfo(app, app.commandLine);

  // Crash consent is read before ready, before the library opens. A quit is a run that ended normally.
  const dsn = crashDsn();
  app.on('will-quit', () => endCrashReportingRun());
  void bootCrashReporting({
    userData: app.getPath('userData'),
    dsn,
    version: app.getVersion(),
    channel: __TAALCUT_UPDATE_CHANNEL__,
    homeDir: app.getPath('home'),
    crashesDirectory: app.getPath('crashDumps'),
    env: process.env,
    names: machineNames(),
  })
    .then(() => app.whenReady())
    .then(async () => {
      // Test builds: main's network recorder and Chromium's requests, before the library or a process starts; and
      // every process's output to the folder TAALCUT_TEST_LOG_DIR names (the e2e's artifacts).
      if (__TAALCUT_FLAVOUR__ === 'test') await testNetworkLog();
      if (__TAALCUT_FLAVOUR__ === 'test') await testProcessLogs();
      // The microphone stays refused until main has the capture store (and a consent recording under way).
      const microphone = createMicrophoneGate();
      hardenSession(session.defaultSession, runtime, microphone);
      // The clip page's originals that are their own proxies: answered once the library is open (below).
      const originals = libraryOriginals();
      // BRK1: a template's kept reel for the review's player, answered once the library is open too.
      const reels = libraryTemplateReels(app.getPath('userData'));
      const importRuntime: { previews?: ImportPreviewHandler } = {};
      handleAppScheme(session.defaultSession.protocol, RENDERER_DIR, {
        importPreviews: (request) => importRuntime.previews?.(request) ?? Promise.resolve(undefined),
        originals: originals.resolve,
        templateReels: reels.resolve,
        mediaRoot: mediaCacheRoot(app.getPath('userData'), platform),
        templateAssets: templateAssetsDir(app.getPath('userData')),
        styleAssets: styleAssetsDir(app.getPath('userData')),
        deviceThumbs: join(app.getPath('userData'), 'transfer/usb/thumbs'),
        previewCsp: previewCspFor(runtime),
      });
      // The mac helper's Core ML compiles of component versions this app no longer has (IX3-B6), before any helper runs.
      await sweepCompileCache({
        userData: app.getPath('userData'),
        cache: platform.compileCache(app.getPath('home')),
        log: (line) => console.warn(line),
      });
      // Library, then theme (before the first window), menu, utility processes, each window's port to main.
      const root = await composeMain({
        openProduct: (productId) => {
          pendingProduct = productId;
          intents.receive([]);
        },
        runtime,
        platform,
        userData: app.getPath('userData'),
        utilityDir: UTILITY_DIR,
        resourcesPath: process.resourcesPath,
        gpu,
        crashDsn: dsn,
        ...(__TAALCUT_FLAVOUR__ === 'test' ? await testModelServers() : {}),
        // Test builds: the title-bar double-click setting from a switch, so e2e never touches the system's.
        ...(__TAALCUT_FLAVOUR__ === 'test' && app.commandLine.hasSwitch('taalcut-double-click')
          ? { doubleClick: () => app.commandLine.getSwitchValue('taalcut-double-click') }
          : {}),
      });
      if (!root) return;
      backgroundEnabled = () => root.background.enabled();
      importRuntime.previews = root.container.resolve(ImportRuntimeToken).previews;
      originals.bind(root.container);
      reels.bind(root.container);
      // Test builds: the indexing bench's record of every CPU fallback (IX3-B4).
      if (__TAALCUT_FLAVOUR__ === 'test') await testFallbackLog(root.container);
      microphone.bind(root.container.resolve(VoiceCaptureStoreToken));
      const openWindow = (productId?: ProductId): MainWindow => {
        void app.dock?.show();
        const initial = productId
          ? { ...runtime, startUrl: new URL(`/products/${productId}`, runtime.startUrl).href }
          : runtime;
        const opened = createMainWindow(initial, PRELOAD, platform.window);
        watchRenderer(opened);
        root.openClips.watch(opened);
        return opened;
      };
      const foreground = foregroundWindow({
        create: openWindow,
        focusItem: (productId: ProductId) =>
          root.container
            .resolve(EventBusToken)
            .emit('ui.action', { action: 'products.open', args: { productId } }),
      });
      const settings = root.container.resolve(SettingsStoreToken);
      const channel = __TAALCUT_UPDATE_CHANNEL__ || null;
      let firstWindow = true;
      const showWindow = () => {
        const productId = pendingProduct;
        pendingProduct = undefined;
        const { window: win, created } = foreground.show(productId);
        if (!created || !firstWindow) return;
        firstWindow = false;
        // A background wake neither counts update failures nor starts an automatic install. Prove UI health
        // only when the person opens a window, with a fresh deadline after potentially hours in the background.
        const interactiveLaunch = backgroundLaunch ? checkUpdateLaunch({ startedAt: Date.now() }) : launch;
        if (interactiveLaunch)
          watchUpdateLaunch(interactiveLaunch, { host: root.host, settings, window: win, channel });
        startUpdates(root.container);
        win.once('ready-to-show', () => {
          void channelInForce(settings, __TAALCUT_UPDATE_CHANNEL__).then((sessionChannel) =>
            recordSessionShown(root.host, {
              appVersion: app.getVersion(),
              channel: sessionChannel,
              packaged: runtime.packaged,
              env: process.env,
              preferred: app.getPreferredSystemLanguages(),
            }),
          );
          if (__TAALCUT_FLAVOUR__ === 'test') void armForcedCrash(win);
        });
      };
      const wake = () => {
        void root.background.wake();
      };
      intents.bind({ open: showWindow, wake });
      if (backgroundLaunch) {
        if (firstWindow) app.dock?.hide();
        if (firstWindow && !root.background.enabled()) app.quit();
        else wake();
      } else showWindow();
      app.on('activate', showWindow);
      powerMonitor.on('resume', wake);
      app.once('will-quit', () => powerMonitor.removeListener('resume', wake));
      void gpu.read().then((report) => logCpuFallbacks(report));
    });
}

function watchRenderer(win: MainWindow): void {
  win.webContents.on('render-process-gone', (_event, details) => {
    void reportRenderProcessGone(details.reason);
  });
}

/** Test builds: the network recorder in main and every session's requests in its log (P3-B10). */
async function testNetworkLog(): Promise<void> {
  await (await import('../shared/test-network-log')).installNetworkLog('main');
  (await import('./test-network-sessions')).watchSessionRequests();
}

/** Test builds: main's console and each utility's stderr to TAALCUT_TEST_LOG_DIR (test-process-logs.ts). */
async function testProcessLogs(): Promise<void> {
  (await import('./test-process-logs')).writeProcessLogs({ env: process.env });
}

/** Test builds: `compute.fallback` events to the file TAALCUT_COMPUTE_FALLBACK_LOG names (compute-fallback-log.ts). */
async function testFallbackLog(container: Container): Promise<void> {
  const { logComputeFallbacks } = await import('./compute-fallback-log');
  logComputeFallbacks({ events: container.resolve(EventBusToken), env: process.env });
}

/** Test builds may point crash reports at a loopback ingest. Release builds ignore the switch. */
function crashDsn(): string {
  if (__TAALCUT_FLAVOUR__ === 'test') {
    const override = app.commandLine.getSwitchValue('taalcut-crash-dsn');
    if (override) return override;
  }
  return __TAALCUT_CRASH_DSN__;
}

/**
 * `--taalcut-test-crash` crashes that process 2s after the window is shown; `main-error` leaves a rejection
 * unhandled in main instead, naming the home folder and the account (the crash e2e checks they are scrubbed).
 */
async function armForcedCrash(win: MainWindow): Promise<void> {
  const { armTestCrash, TEST_CRASH_SWITCH } = await import('./test-hooks');
  const { postToUtility } = await import('./composition/main-register');
  const { userInfo } = await import('node:os');
  armTestCrash(
    () => app.commandLine.getSwitchValue(TEST_CRASH_SWITCH) || undefined,
    (name) => {
      if (name === 'main') process.crash();
      else if (name === 'main-error') {
        const where = `${app.getPath('home')}/Movies/beach.mov for ${userInfo().username}`;
        void Promise.reject(new Error(`test error: could not open ${where}`));
      } else if (name === 'renderer') crashRenderer(win);
      else postToUtility(name, { type: TEST_CRASH_SWITCH });
    },
  );
}

/** A real renderer crash. The page is sandboxed, with no process.crash(); DevTools' Page.crash is one. */
function crashRenderer(win: MainWindow): void {
  win.webContents.debugger.attach('1.3');
  void win.webContents.debugger.sendCommand('Page.crash').then(
    () => undefined,
    (cause: unknown) => console.warn(`[test] Page.crash: ${String(cause)}`),
  );
}

/**
 * Only builds with a baked-in feed, and test builds, contain the updater; and only an OS whose updates install
 * themselves runs it (PlatformAbilities.selfUpdate: Squirrel.Mac and latest-mac.yml are macOS's).
 */
function startUpdates(container: Container): void {
  if (__TAALCUT_UPDATE_FEED__ === '' && __TAALCUT_FLAVOUR__ !== 'test') return;
  if (!container.resolve(PlatformServicesToken).abilities.selfUpdate) return;
  const testFeed =
    __TAALCUT_FLAVOUR__ === 'test' ? app.commandLine.getSwitchValue('taalcut-update-feed') : '';
  const feed = resolveUpdateFeed({
    packaged: app.isPackaged,
    flavour: __TAALCUT_FLAVOUR__,
    bakedFeed: __TAALCUT_UPDATE_FEED__,
    testFeed,
  });
  if (!feed) return;
  const schedule = testFeed ? { ...DEFAULT_SCHEDULE, initialDelayMs: 0 } : DEFAULT_SCHEDULE;
  const settings = container.resolve(SettingsStoreToken);
  const deps = { schedule, settings, events: container.resolve(EventBusToken) };
  void import('./update/start').then(({ startAutoUpdate }) => startAutoUpdate(feed, deps));
}

/** Test builds: providers and Sign in with ChatGPT at local mock servers, when asked for. */
async function testModelServers(): Promise<{ modelRuntime?: ModelRuntimeOptions }> {
  const servers = (await import('../shared/test-model-servers')).testModelServers();
  return servers ? { modelRuntime: servers } : {};
}

/** Test builds: run one self-test (test-hooks.ts) instead of the app, then exit with its code. */
async function runSelfTest(): Promise<void> {
  const gpu = createGpuInfo(app, app.commandLine);
  const hooks = await import('./test-hooks');
  await app.whenReady();
  const name = app.commandLine.getSwitchValue(hooks.SELF_TEST_SWITCH);
  const context = { workDir: app.getPath('userData'), gpu, packaged: app.isPackaged };
  app.exit(await hooks.runSelfTest(name, context));
}
