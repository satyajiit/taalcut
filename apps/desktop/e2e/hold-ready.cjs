// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Preloaded (electron -r) by e2e/launch.ts into the unpackaged app: holds
 * Electron's 'ready' until Playwright has attached, so the first window is
 * created after Playwright watches for page targets, not while it attaches.
 *
 * Playwright's own loader does the same, but it only injects it when it
 * resolves Electron itself (we pass executablePath), and it adds Chromium
 * switches (disabled features) we don't want in the app under test; launch.ts
 * adds the one we do, the mock keychain. The contract is Playwright's: once connected it evaluates
 * `__playwright_run()` in main (ElectronApplication.initialize). Test-only;
 * never packaged.
 */
'use strict';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- electron -r preloads CommonJS, before the app's ESM main
const { app } = require('electron');

const RELEASE_ANYWAY_MS = 10_000;
const realWhenReady = app.whenReady();
const realEmit = app.emit.bind(app);
let readyArgs = [];
let ready = false;
let releasing = false;
let resolveHeld;
const held = new Promise((resolve) => {
  resolveHeld = resolve;
});

// Electron emits 'ready' once; keep it (and whenReady) back until release().
app.emit = (event, ...args) => {
  if (event !== 'ready') return realEmit(event, ...args);
  readyArgs = args;
  return app.listenerCount('ready') > 0;
};
app.isReady = () => ready;
app.whenReady = () => held;

async function release() {
  if (releasing) return;
  releasing = true;
  const launchInfo = await realWhenReady;
  ready = true;
  resolveHeld(launchInfo);
  realEmit('ready', ...readyArgs);
}

globalThis.__playwright_run = release;

// Should a Playwright upgrade stop calling __playwright_run, say so and start instead of waiting forever.
setTimeout(() => {
  if (releasing) return;
  process.stderr.write(
    `e2e hold-ready: Playwright did not release 'ready' in ${RELEASE_ANYWAY_MS} ms; starting anyway\n`,
  );
  void release();
}, RELEASE_ANYWAY_MS).unref();
