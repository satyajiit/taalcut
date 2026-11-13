// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Serialises closing and opening of USB bridge sessions per physical device so a
 * new open never races a still-releasing handle from Taalcut itself, and an
 * aborted caller never cancels a shared open that another caller still awaits.
 */
import { err, toTaalcutError, type AsyncResult, type DeviceView } from '@taalcut/core';
import type { BridgeDeviceRef, BridgeKind, BridgeSession } from './bridge';
import { DeviceGone } from './errors';
import type { LiveDevice } from './hub-record';
import type { Schedule } from './schedule';

export interface SessionDropper {
  drop(key: string, session: BridgeSession): void;
  wait(key: string, signal: AbortSignal): Promise<void>;
  drain(): Promise<void>;
}

export function createSessionDropper(log?: { info(line: string): void }): SessionDropper {
  const closing = new Map<string, Promise<void>>();

  return {
    drop(key, session) {
      const prior = closing.get(key);
      const start = (): Promise<void> => {
        try {
          return Promise.resolve(session.close());
        } catch (cause) {
          return Promise.reject(cause);
        }
      };
      const task = (prior ? prior.catch(() => undefined).then(start) : start())
        .catch((cause: unknown) => {
          log?.info(`usb ${key} close failed ${toTaalcutError(cause).code}`);
        })
        .finally(() => {
          if (closing.get(key) === task) closing.delete(key);
        });
      closing.set(key, task);
    },
    async wait(key, signal) {
      for (;;) {
        const pending = closing.get(key);
        if (!pending || signal.aborted) return;
        await raceAbort(pending, signal);
      }
    },
    async drain() {
      while (closing.size > 0) {
        await Promise.all([...closing.values()]);
      }
    },
  };
}

export interface OpenFlights {
  run(
    key: string,
    signal: AbortSignal,
    open: (sharedSignal: AbortSignal) => AsyncResult<DeviceView>,
  ): AsyncResult<DeviceView>;
  cancel(key: string): void;
  cancelAll(): void;
}

interface Flight {
  readonly controller: AbortController;
  readonly waiters: Set<() => void>;
  readonly promise: AsyncResult<DeviceView>;
}

export function createOpenFlights(): OpenFlights {
  const flights = new Map<string, Flight>();

  return {
    run(key, signal, open) {
      if (signal.aborted) return Promise.resolve(err(DeviceGone()));
      let flight = flights.get(key);
      if (!flight) {
        const controller = new AbortController();
        const waiters = new Set<() => void>();
        const promise = open(controller.signal).finally(() => {
          if (flights.get(key)?.controller === controller) flights.delete(key);
        });
        flight = { controller, waiters, promise };
        flights.set(key, flight);
      }
      const activeFlight = flight;
      return new Promise((resolve) => {
        let done = false;
        const leave = (): void => {
          activeFlight.waiters.delete(onForceCancel);
          signal.removeEventListener('abort', onCallerAbort);
        };
        const onCallerAbort = (): void => {
          if (done) return;
          done = true;
          leave();
          if (activeFlight.waiters.size === 0) activeFlight.controller.abort();
          resolve(err(DeviceGone()));
        };
        const onForceCancel = (): void => {
          if (done) return;
          done = true;
          leave();
          resolve(err(DeviceGone()));
        };
        activeFlight.waiters.add(onForceCancel);
        signal.addEventListener('abort', onCallerAbort, { once: true });
        void activeFlight.promise.then((result) => {
          if (done) return;
          done = true;
          leave();
          resolve(result);
        });
      });
    },
    cancel(key) {
      const flight = flights.get(key);
      if (!flight) return;
      flights.delete(key);
      flight.controller.abort();
      for (const cancel of [...flight.waiters]) cancel();
    },
    cancelAll() {
      for (const key of [...flights.keys()]) this.cancel(key);
    },
  };
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

export function waitForBridgeRef(
  rec: LiveDevice,
  kind: BridgeKind,
  wait: boolean,
  signal: AbortSignal,
  listen: (listener: () => void) => () => void,
  schedule: Schedule,
  timeoutMs: number,
): Promise<BridgeDeviceRef | null> {
  const existing = rec.refs.get(kind);
  if (existing) return Promise.resolve(existing);
  if (!wait) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ref: BridgeDeviceRef | null): void => {
      if (settled) return;
      settled = true;
      stop();
      timer.cancel();
      resolve(ref);
    };
    const stop = listen(() => {
      const found = rec.refs.get(kind);
      if (found) finish(found);
    });
    const timer = schedule(timeoutMs, () => finish(rec.refs.get(kind) ?? null));
    if (signal.aborted) finish(null);
    else signal.addEventListener('abort', () => finish(null), { once: true });
  });
}
