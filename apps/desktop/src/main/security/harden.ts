// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Attaches the security policy to Electron: every web contents (including
 * ones created later, by anything) and the default session. The decisions
 * themselves live in policy.ts and are unit-tested there.
 */
import { app, type Session, type WebContents } from 'electron';
import { type Runtime } from '../runtime';
import type { MicrophoneGate } from '../voice/microphone-gate';
import { devServerCsp } from './csp';
import { isFrameNavigationAllowed, isPermissionGranted, windowOpenDecision } from './policy';
import { refusalMessage, refusedSwitches } from './switches';

/**
 * The flag guard (switches.ts): packaged release builds refuse switches that
 * weaken them, such as --remote-debugging-port, --no-sandbox or --js-flags.
 * Must run first in main: Chromium starts its DevTools server, and launches
 * its child processes, only after the entry script has run. So the switches
 * are removed here and the app exits with code 1 and a message on stderr
 * before any of that happens (checked on Electron 44).
 * Returns true if the app is exiting.
 */
export function refuseUnsafeSwitches(): boolean {
  const refused = refusedSwitches({
    packaged: app.isPackaged,
    flavour: __TAALCUT_FLAVOUR__,
    argv: process.argv,
    env: process.env,
  });
  if (refused.length === 0) return false;
  for (const { name, source } of refused) if (source === 'argv') app.commandLine.removeSwitch(name);
  console.error(refusalMessage(refused));
  app.exit(1);
  return true;
}

/** Call before app ready, so no web contents escapes it. */
export function hardenAllWebContents(runtime: Runtime): void {
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents, runtime.trustedOrigins));
}

export function hardenWebContents(contents: WebContents, trustedOrigins: readonly string[]): void {
  contents.setWindowOpenHandler(windowOpenDecision);

  // Covers the main frame and subframes, including location changes made by script. Subframes may
  // only be render's preview player (app://preview).
  contents.on('will-frame-navigate', (event) => {
    if (!isFrameNavigationAllowed(event.url, event.isMainFrame, trustedOrigins)) event.preventDefault();
  });
  contents.on('will-redirect', (event) => {
    if (!isFrameNavigationAllowed(event.url, event.isMainFrame, trustedOrigins)) event.preventDefault();
  });

  // webviewTag is off already; this is the belt to that pair of braces (checklist 12).
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

export function hardenSession(session: Session, runtime: Runtime, microphone: MicrophoneGate): void {
  const { trustedOrigins } = runtime;

  // Checklist 5: deny by default; GRANTED_PERMISSIONS is the allow-list, and `media` is the microphone only,
  // while a consent recording is under way (SV-6).
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
    const recording = microphone.isOpen();
    callback(
      isPermissionGranted(
        permission,
        details.requestingUrl,
        trustedOrigins,
        mediaTypes ? { mediaTypes, recording } : { recording },
      ),
    );
  });
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    const recording = microphone.isOpen();
    return isPermissionGranted(
      permission,
      requestingOrigin,
      trustedOrigins,
      details.mediaType ? { mediaType: details.mediaType, recording } : { recording },
    );
  });
  session.setDevicePermissionHandler(() => false);

  // Pages can't start downloads; exports are written by main through a command.
  session.on('will-download', (event) => event.preventDefault());

  // The Vite dev server sends no CSP of its own, so add the dev policy to it.
  const devOrigin = runtime.devServerOrigin;
  if (devOrigin) {
    const csp = devServerCsp(devOrigin);
    session.webRequest.onHeadersReceived({ urls: [`${devOrigin}/*`] }, (details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
    });
  }
}
