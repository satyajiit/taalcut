// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The only webPreferences any Taalcut window gets. Every security-relevant
 * key is spelled out, even where it matches Electron's default, so an
 * Electron upgrade that changes a default can't loosen it silently. The
 * launch test reads them back with webContents.getLastWebPreferences().
 */
import type { WebPreferences } from 'electron';

export function secureWebPreferences(options: { preload: string; devTools: boolean }): WebPreferences {
  return {
    preload: options.preload,
    // Checklist 2-4: no Node in the renderer, isolated preload world, OS sandbox.
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    // Checklist 6, 8, 9, 10: keep the same-origin policy and Chromium's defaults.
    // enableBlinkFeatures is never set.
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    // Checklist 11: no <webview>.
    webviewTag: false,
    // Dropping a file on the window must not navigate it to file://.
    navigateOnDragDrop: false,
    // A page can't trap the user in a loop of alert() dialogs.
    safeDialogs: true,
    devTools: options.devTools,
  };
}
