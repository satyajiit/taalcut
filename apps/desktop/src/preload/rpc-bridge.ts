// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * window.taalcutRpc: the page's one way to reach main. connect(nonce) asks
 * main for a port; main answers on RPC_IPC.port and this forwards the port
 * to the page as a window message (a MessagePort can't cross contextBridge).
 * Everything after that is oRPC on the port, validated by main's contracts.
 * Nothing here hands out ipcRenderer or lets the page pick a channel.
 */
import { MAIN_PORT_MESSAGE, type MainPortMessage, type RpcBridge } from '@taalcut/core';
import { isNonce, RPC_IPC } from '../shared/rpc-ipc';

/** The parts of ipcRenderer used here. */
export interface PreloadIpc {
  send(channel: string, ...args: unknown[]): void;
  on(
    channel: string,
    listener: (event: { readonly ports: readonly unknown[] }, ...args: unknown[]) => void,
  ): unknown;
}

/** The page's window, from the preload's isolated world. */
export interface PageWindow {
  postMessage(message: unknown, targetOrigin: string, transfer: unknown[]): void;
}

export function createRpcBridge(ipc: PreloadIpc, page: PageWindow): RpcBridge {
  // Only main sends on this channel. Same window, so '*' can't leak the port to another origin.
  ipc.on(RPC_IPC.port, (event, nonce) => {
    if (!isNonce(nonce) || event.ports.length !== 1) return;
    const message: MainPortMessage = { type: MAIN_PORT_MESSAGE, nonce };
    page.postMessage(message, '*', [...event.ports]);
  });
  return {
    connect(nonce) {
      if (isNonce(nonce)) ipc.send(RPC_IPC.connect, nonce);
    },
  };
}
