// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Per-device session guard for a `DeviceBridge`. Ensures one bridge instance never
 * opens a second session on the same physical phone while an earlier session is
 * still open or releasing its USB / helper handle.
 */
import { CancelledError, createSerialQueue, err, type AsyncResult } from '@taalcut/core';
import type { BridgeDeviceRef, BridgeSession, DeviceBridge } from './bridge';
import { DeviceGone } from './errors';

interface LiveEntry {
  readonly session: BridgeSession;
  readonly close: () => Promise<void>;
}

export function guardBridgeSessions(bridge: DeviceBridge): DeviceBridge {
  const turns = new Map<string, ReturnType<typeof createSerialQueue>>();
  const active = new Map<string, LiveEntry>();
  const closing = new Map<string, Promise<void>>();

  function turnFor(key: string): ReturnType<typeof createSerialQueue> {
    let queue = turns.get(key);
    if (!queue) {
      queue = createSerialQueue();
      turns.set(key, queue);
    }
    return queue;
  }

  function trackSession(key: string, session: BridgeSession): BridgeSession {
    const rawClose = session.close.bind(session);
    let closePromise: Promise<void> | null = null;
    const wrappedClose = (): Promise<void> => {
      if (closePromise) return closePromise;
      if (active.get(key)?.session === session) active.delete(key);
      closePromise = startClose(rawClose, key, closing);
      return closePromise;
    };
    (session as { close: () => Promise<void> }).close = wrappedClose;
    active.set(key, { session, close: wrappedClose });
    return session;
  }

  return {
    kind: bridge.kind,
    claims: (device) => bridge.claims(device),
    watch: (signal) => bridge.watch(signal),
    open(ref: BridgeDeviceRef, signal: AbortSignal): AsyncResult<BridgeSession> {
      const key = ref.identity.length > 0 ? ref.identity : ref.handle;
      return turnFor(key).run(async () => {
        if (signal.aborted) {
          return err(ref.bridge === 'adb' ? CancelledError() : DeviceGone());
        }
        const existing = active.get(key);
        if (existing) await existing.close().catch(() => undefined);
        const pendingClose = closing.get(key);
        if (pendingClose) await raceAbort(pendingClose, signal);
        if (signal.aborted) {
          return err(ref.bridge === 'adb' ? CancelledError() : DeviceGone());
        }
        const opened = await bridge.open(ref, signal);
        if (!opened.ok) return opened;
        return { ok: true, value: trackSession(key, opened.value) };
      });
    },
  };
}

function startClose(
  rawClose: () => Promise<void>,
  key: string,
  closing: Map<string, Promise<void>>,
): Promise<void> {
  let promise: Promise<void>;
  try {
    promise = Promise.resolve(rawClose());
  } catch (cause) {
    promise = Promise.reject(cause);
  }
  const tracked = promise.finally(() => {
    if (closing.get(key) === tracked) closing.delete(key);
  });
  closing.set(key, tracked);
  return tracked;
}

function raceAbort(promise: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => {
      signal.removeEventListener('abort', finish);
      resolve();
    };
    signal.addEventListener('abort', finish, { once: true });
    void promise.then(finish, finish);
  });
}
