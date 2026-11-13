// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One adapter for every MessagePort Taalcut meets, typed structurally so core
 * never imports Electron or the DOM:
 *
 * - DOM MessagePort (renderer) and Node's worker_threads MessagePort (tests):
 *   addEventListener; the listener gets an event with `.data`. A DOM port only
 *   delivers after start(), which addEventListener does not call.
 * - Electron MessagePortMain (main, utility processes): an EventEmitter; `on`
 *   listeners get `{ data, ports }`; messages queue until start().
 *
 * oRPC's message-port adapters call neither start() nor any way to detach, so
 * Taalcut hands them this adapter instead of the raw port. It starts the port
 * when oRPC first listens, reports the remote end closing (so pending calls
 * reject instead of hanging), and can be closed from our side.
 */

export interface MessageEventLike {
  readonly data?: unknown;
}

/** DOM MessagePort, Node's worker_threads MessagePort. */
export interface EventTargetPort {
  postMessage(message: unknown): void;
  addEventListener(type: 'message' | 'close', listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: 'message' | 'close', listener: (event: MessageEventLike) => void): void;
  start?(): void;
  close?(): void;
}

/** Electron MessagePortMain. */
export interface EmitterPort {
  postMessage(message: unknown): void;
  on(type: 'message' | 'close', listener: (event?: MessageEventLike) => void): unknown;
  removeListener?(type: 'message' | 'close', listener: (event?: MessageEventLike) => void): unknown;
  start?(): void;
  close?(): void;
}

export type PortLike = EventTargetPort | EmitterPort;

type Listener = (event?: { data: unknown }) => void;

/** The shape oRPC's adapters accept (its `MessagePortMainLike`). */
export interface OrpcPort {
  on(type: string, listener: Listener): void;
  postMessage(data: unknown): void;
}

export interface PortAdapter {
  readonly port: OrpcPort;
  /** True once either end has closed. */
  readonly closed: boolean;
  /** True when this side closed the port (as opposed to the remote end going away). */
  readonly closedLocally: boolean;
  /** Called once when either end closes. Returns an unsubscribe function. */
  onClose(listener: () => void): () => void;
  /**
   * Detaches, fails pending calls and closes the underlying port. Idempotent.
   * 'peer-exited' is for when we learn some other way that the other process
   * died (a supervisor's exit event): the port closes as if the remote end had.
   */
  close(reason?: CloseReason): void;
}

/** Why a connection closed: we closed it, or the process on the other end went away. */
export type CloseReason = 'local' | 'peer-exited';

function isEventTarget(port: PortLike): port is EventTargetPort {
  return 'addEventListener' in port && typeof port.addEventListener === 'function';
}

export function adaptPort(port: PortLike): PortAdapter {
  const listeners = { message: new Set<Listener>(), close: new Set<Listener>() };
  let started = false;
  let closed = false;
  let closedLocally = false;

  const onMessage = (event?: MessageEventLike): void => {
    for (const listener of listeners.message) listener({ data: event?.data });
  };
  const onRemoteClose = (): void => finish('peer-exited');

  const attach = (): void => {
    if (isEventTarget(port)) {
      port.addEventListener('message', onMessage);
      port.addEventListener('close', onRemoteClose);
    } else {
      port.on('message', onMessage);
      port.on('close', onRemoteClose);
    }
  };
  const detach = (): void => {
    if (isEventTarget(port)) {
      port.removeEventListener('message', onMessage);
      port.removeEventListener('close', onRemoteClose);
    } else {
      port.removeListener?.('message', onMessage);
      port.removeListener?.('close', onRemoteClose);
    }
  };

  function finish(reason: CloseReason, closePort = false): void {
    if (closed) return;
    closed = true;
    closedLocally = reason === 'local';
    detach();
    for (const listener of [...listeners.close]) listener();
    listeners.message.clear();
    listeners.close.clear();
    if (closePort) port.close?.();
  }

  attach();

  return {
    port: {
      on(type, listener) {
        if (closed) {
          if (type === 'close') listener();
          return;
        }
        if (type === 'message' || type === 'close') listeners[type].add(listener);
        // Start only once someone listens, so no message arrives to an empty room.
        if (type === 'message' && !started) {
          started = true;
          port.start?.();
        }
      },
      postMessage(data) {
        if (!closed) port.postMessage(data);
      },
    },
    get closed() {
      return closed;
    },
    get closedLocally() {
      return closedLocally;
    },
    onClose(listener) {
      if (closed) {
        listener();
        return () => undefined;
      }
      const wrapped: Listener = () => listener();
      listeners.close.add(wrapped);
      return () => listeners.close.delete(wrapped);
    },
    close(reason = 'local') {
      finish(reason, true);
    },
  };
}
