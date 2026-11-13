// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Test builds only: Chromium's own requests (the window's pages, Electron's `net`), which the Node recorder
 * in main can't see, into the same network log (shared/test-network-log.ts) as process `chromium`. Every
 * session, the default one and any created later, reports each http(s) and ws(s) request it sends. index.ts
 * reaches this module only inside `__TAALCUT_FLAVOUR__ === 'test'` through import().
 */
import { app, session, type Session } from 'electron';
import { isLoopbackHost } from '@taalcut/models/node';
import { appendNetworkLog, networkLogDir } from '../shared/test-network-log';

const NETWORK_URLS = ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'];

function watch(target: Session, dir: string): void {
  target.webRequest.onSendHeaders({ urls: NETWORK_URLS }, (details) => {
    const url = new URL(details.url);
    const port = url.port === '' ? null : Number(url.port);
    appendNetworkLog(dir, {
      kind: 'attempt',
      process: 'chromium',
      api: `chromium.${details.resourceType}`,
      host: url.hostname,
      port,
      allowed: isLoopbackHost(url.hostname),
      at: Date.now(),
      stack: `${details.method} ${url.origin}${url.pathname}`,
    });
  });
}

/** After ready: watches every session's requests when the network log is on. */
export function watchSessionRequests(): void {
  const dir = networkLogDir();
  if (!dir) return;
  watch(session.defaultSession, dir);
  app.on('session-created', (created) => watch(created, dir));
  appendNetworkLog(dir, { kind: 'installed', process: 'chromium', pid: process.pid, at: Date.now() });
}
