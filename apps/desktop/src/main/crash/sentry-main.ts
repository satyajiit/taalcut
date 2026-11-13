// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Loaded from bootCrashReporting when process.versions.electron is set, so
 * tests and the renderer never pull the SDK in. The SDK itself is a static
 * import in sentry-entry.ts, which is what the bundler inlines.
 * @sentry/core 11 dropped sendDefaultPii; dataCollection turns the same
 * collection off.
 *
 * No native crash dumps (P2-X5): neither minidump integration runs, so
 * nothing calls Electron's crashReporter.start and Crashpad never starts in
 * any process. A dump holds the process's environment and memory, which no
 * scrubber can be shown to clean.
 */
import { crashReportingLive } from './live';
import { scrubCrashEvent, type ScrubOptions } from './scrub-event';

/** Dumps, sessions on a schedule, screenshots, console and network records, source lines, local variables. */
const DROPPED = new Set([
  'SentryMinidump',
  'ElectronMinidump',
  'MainProcessSession',
  'PreloadInjection',
  'Screenshots',
  'ChildProcess',
  'Console',
  'ElectronNet',
  'NodeFetch',
  'RendererEventLoopBlock',
  'ContextLines',
  'LocalVariables',
  'LocalVariablesAsync',
]);
/** scrubCrashEvent keeps only Electron's lifecycle breadcrumbs; the rest aren't recorded at all. */
const KEEP_CRUMB = 'electron';

export interface MainSentryOptions {
  readonly dsn: string;
  readonly release: string;
  readonly environment: string;
  /** Read at every event: the keychain's values change while the app runs. */
  readonly scrub: () => ScrubOptions;
}

// Module instance type. A value import would load Electron; import type cannot name it.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type SentryMain = typeof import('@sentry/electron/main');

type SentryMainApi = Pick<SentryMain, 'init' | 'makeElectronOfflineTransport' | 'captureEvent' | 'flush'>;

let sdk: Promise<SentryMainApi> | undefined;

function loadSdk(): Promise<SentryMainApi> {
  if (!process.versions.electron) return Promise.reject(new Error('sentry main is electron-only'));
  sdk ??= import('./sentry-entry');
  return sdk;
}

export async function initMainSentry(options: MainSentryOptions): Promise<void> {
  if (!process.versions.electron) return;
  const Sentry = await loadSdk();
  Sentry.init({
    dsn: options.dsn,
    release: options.release,
    environment: options.environment,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    includeLocalVariables: false,
    attachScreenshot: false,
    sendClientReports: false,
    beforeSend(event) {
      if (!crashReportingLive()) return null;
      return scrubCrashEvent(event, options.scrub());
    },
    beforeBreadcrumb(breadcrumb) {
      return breadcrumb.category === KEEP_CRUMB ? breadcrumb : null;
    },
    integrations(defaults) {
      return defaults.filter((integration) => !DROPPED.has(integration.name));
    },
    transport(transportOptions) {
      const inner = Sentry.makeElectronOfflineTransport()(transportOptions);
      return {
        send(envelope) {
          if (!crashReportingLive()) return Promise.resolve({});
          return inner.send(envelope);
        },
        flush: (timeout) => inner.flush(timeout),
      };
    },
  });
}

export async function captureMainEvent(event: unknown): Promise<void> {
  if (!process.versions.electron || !crashReportingLive()) return;
  const Sentry = await loadSdk();
  Sentry.captureEvent(event as Parameters<SentryMain['captureEvent']>[0]);
  await Sentry.flush(2000);
}
