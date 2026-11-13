// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The model's channel over a Node child process's IPC channel (IX2-S2): the evals' and tests' model process (the
 * app's goes over an Electron MessagePort, apps/desktop). Typed structurally.
 *
 * A child forked with `serialization: 'advanced'` gets each window as a Float32Array (a copy: a buffer can't be
 * handed to another process). It ends when its IPC channel closes, which also happens when its parent dies, so
 * it never outlives the process that started it.
 */
import type { ModelPort } from './model-serve';
import type { ModelChannel } from './model-session';

/** Calls `listener` once, with the first reason. */
function goneOnce(listener: (detail: string) => void): (detail: string) => void {
  let told = false;
  return (detail) => {
    if (told) return;
    told = true;
    listener(detail);
  };
}

/** A `ChildProcess` forked with an IPC channel, as the client uses it. */
export interface ModelChild {
  readonly connected: boolean;
  send(message: unknown): boolean;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number | null, signal: string | null) => void): unknown;
  on(event: 'error', listener: (cause: Error) => void): unknown;
  disconnect(): void;
}

export function childChannel(child: ModelChild): ModelChannel {
  return {
    send(message) {
      if (child.connected) child.send(message);
    },
    onMessage: (listener) => void child.on('message', listener),
    onGone(listener) {
      const gone = goneOnce(listener);
      child.on('exit', (code, signal) => gone(`the model process exited (${signal ?? String(code)})`));
      child.on('error', (cause) => gone(`the model process failed: ${cause.message}`));
    },
    close() {
      // The child ends when its channel closes; nothing is killed.
      if (child.connected) child.disconnect();
    },
  };
}

/** `process` inside the child: its IPC channel to the parent. */
export interface ModelParentProcess {
  send?(message: unknown): boolean;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'disconnect', listener: () => void): unknown;
}

export function parentProcessPort(parent: ModelParentProcess): ModelPort {
  return {
    send: (message) => void parent.send?.(message),
    onMessage: (listener) => void parent.on('message', listener),
    onGone: (listener) => void parent.on('disconnect', listener),
  };
}
