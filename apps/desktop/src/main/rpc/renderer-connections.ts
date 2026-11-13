// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Gives each window its port to main. A page asks with RPC_IPC.connect; main
 * checks the sender (checklist 17: the app's own top-level page only),
 * serves the app router on a new MessageChannelMain and posts the other end
 * back to that frame. One connection per web contents: asking again (a
 * reload) replaces it, and it closes when the web contents is destroyed.
 * Electron is injected so the rules are unit-tested.
 */
import {
  serveRpc,
  type AnyContractRouter,
  type PortLike,
  type RpcRouter,
  type RpcServer,
} from '@taalcut/core';
import { isTrustedUrl } from '../runtime';
import { isNonce, RPC_IPC } from '../../shared/rpc-ipc';

export interface RendererContext {
  readonly caller: 'renderer';
  readonly webContentsId: number;
}

/** WebFrameMain. `Remote` is MessagePortMain. */
export interface SenderFrame<Remote = unknown> {
  readonly url: string;
  readonly parent: unknown;
  postMessage(channel: string, message: unknown, transfer: Remote[]): void;
}

export interface SenderContents {
  readonly id: number;
  once(event: 'destroyed', listener: () => void): unknown;
}

export interface ConnectEvent<Remote = unknown> {
  readonly sender: SenderContents;
  readonly senderFrame: SenderFrame<Remote> | null;
}

export interface RendererConnectionDeps<Remote> {
  readonly router: RpcRouter<AnyContractRouter, RendererContext>;
  readonly trustedOrigins: readonly string[];
  /** ipcMain. */
  readonly ipc: {
    on(channel: string, listener: (event: ConnectEvent<Remote>, ...args: unknown[]) => void): unknown;
    removeListener(
      channel: string,
      listener: (event: ConnectEvent<Remote>, ...args: unknown[]) => void,
    ): unknown;
  };
  /** new MessageChannelMain(): `local` is served here, `remote` goes to the page. */
  readonly createChannel: () => { readonly local: PortLike; readonly remote: Remote };
  readonly log?: (message: string) => void;
}

/** Checklist 17: only the app's own top-level pages get a port. */
export function isTrustedFrame(
  frame: Pick<SenderFrame, 'url' | 'parent'> | null,
  trustedOrigins: readonly string[],
): boolean {
  if (!frame || frame.parent !== null) return false;
  return isTrustedUrl(frame.url, trustedOrigins);
}

export interface RendererConnections {
  /** Open connections, by web contents id. */
  readonly size: number;
  /** Stops accepting and closes every connection. */
  close(): void;
}

export function serveRendererConnections<Remote>(deps: RendererConnectionDeps<Remote>): RendererConnections {
  const servers = new Map<number, RpcServer>();
  const watched = new Set<number>();

  const onConnect = (event: ConnectEvent<Remote>, nonce: unknown): void => {
    const frame = event.senderFrame;
    if (!isNonce(nonce) || !frame || !isTrustedFrame(frame, deps.trustedOrigins)) {
      deps.log?.(`[rpc] refused a connection from ${frame?.url ?? 'a destroyed frame'}`);
      return;
    }
    const id = event.sender.id;
    servers.get(id)?.close();
    const { local, remote } = deps.createChannel();
    const server = serveRpc(deps.router, local, { context: { caller: 'renderer', webContentsId: id } });
    servers.set(id, server);
    server.onClose(() => {
      if (servers.get(id) === server) servers.delete(id);
    });
    if (!watched.has(id)) {
      watched.add(id);
      event.sender.once('destroyed', () => {
        watched.delete(id);
        servers.get(id)?.close();
      });
    }
    frame.postMessage(RPC_IPC.port, nonce, [remote]);
  };

  deps.ipc.on(RPC_IPC.connect, onConnect);
  return {
    get size() {
      return servers.size;
    },
    close() {
      deps.ipc.removeListener(RPC_IPC.connect, onConnect);
      for (const server of [...servers.values()]) server.close();
    },
  };
}
