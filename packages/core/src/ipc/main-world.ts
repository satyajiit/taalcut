// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How a renderer page gets its port to main. A MessagePort can't cross
 * contextBridge, so:
 *
 *   page ── window.taalcutRpc.connect(nonce) ──▶ preload ── ipcRenderer.send ──▶ main
 *   main: checks the sender, creates a MessageChannelMain, serves the app contract on one end
 *   main ── webContents.postMessage(port) ──▶ preload ── window.postMessage(port) ──▶ page
 *
 * The nonce ties the port to this request, so a stale or foreign message is
 * ignored. Typed structurally: core has no DOM types.
 */
import { newId } from '../basics/ids';
import { TimeoutError } from '../basics/errors';
import { err, ok, type AsyncResult } from '../basics/result';
import type { AppContract } from './app-contract';
import { appContract } from './app-contract';
import { connectRpc, type RpcConnection } from './client';
import type { PortLike } from './port';

/** The window property the preload exposes. */
export const RPC_BRIDGE_KEY = 'taalcutRpc';
/** `type` of the window message that carries the port from the preload to the page. */
export const MAIN_PORT_MESSAGE = 'taalcut:main-port';

/** All the preload exposes: ask main for a port. The reply arrives as a window message. */
export interface RpcBridge {
  connect(nonce: string): void;
}

export interface MainPortMessage {
  readonly type: typeof MAIN_PORT_MESSAGE;
  readonly nonce: string;
}

export function isMainPortMessage(data: unknown): data is MainPortMessage {
  const message = data as Partial<MainPortMessage> | null;
  return (
    typeof message === 'object' && message?.type === MAIN_PORT_MESSAGE && typeof message.nonce === 'string'
  );
}

export interface WindowMessageLike {
  readonly data: unknown;
  readonly source: unknown;
  readonly ports: readonly PortLike[];
}

/** The parts of `window` connectToMain uses. */
export interface MainWorldLike {
  readonly taalcutRpc?: RpcBridge;
  addEventListener(type: 'message', listener: (event: WindowMessageLike) => void): void;
  removeEventListener(type: 'message', listener: (event: WindowMessageLike) => void): void;
}

export type MainConnection = RpcConnection<AppContract>;

/**
 * Connects the page to main. Ok(null) when there is no preload bridge (a
 * plain browser, the renderer's own e2e); core.timeout if main never answers.
 */
export function connectToMain(
  win: MainWorldLike,
  options: { readonly timeoutMs?: number } = {},
): AsyncResult<MainConnection | null> {
  const bridge = win[RPC_BRIDGE_KEY];
  if (!bridge) return Promise.resolve(ok(null));
  const nonce = newId<'Nonce'>();
  const timeoutMs = options.timeoutMs ?? 10_000;
  return new Promise((resolve) => {
    const onMessage = (event: WindowMessageLike): void => {
      if (event.source !== win || !isMainPortMessage(event.data) || event.data.nonce !== nonce) return;
      const [port] = event.ports;
      if (!port) return;
      done();
      resolve(ok(connectRpc(appContract, port, { peer: 'main' })));
    };
    const timer = setTimeout(() => {
      done();
      resolve(err(TimeoutError({ ms: timeoutMs }, { detail: 'main did not send a port' })));
    }, timeoutMs);
    const done = (): void => {
      clearTimeout(timer);
      win.removeEventListener('message', onMessage);
    };
    win.addEventListener('message', onMessage);
    bridge.connect(nonce);
  });
}
