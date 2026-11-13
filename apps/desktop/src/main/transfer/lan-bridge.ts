// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's lan process lifetime: start on a transfer call, stop 60 seconds
 * after the session ends unless a file is still checking or importing, a
 * devices stream is open, or a device import is running.
 * bridgeUtilityEvents feeds it the bridged transfer events.
 */
import type { Clock, EventBus } from '@taalcut/core';
import type { UtilityHost } from '../rpc/utility-host';
import { createLanLifecycle, type LanLifecycle } from './lan-lifecycle';

export function createDesktopLanLifecycle(
  host: Pick<UtilityHost, 'start' | 'stop'>,
  clock: Clock,
): LanLifecycle {
  const lifecycle = createLanLifecycle({
    start: () => host.start('lan'),
    stop: () => host.stop('lan'),
    now: () => clock.now(),
    schedule(ms, fn) {
      const timer = setTimeout(fn, ms);
      return { cancel: () => clearTimeout(timer) };
    },
  });
  // Windows and main-owned import discovery group their streams independently. Aggregate both holds here.
  return {
    ...lifecycle,
    onDevicesWatch: trackDevicesWatch((open) => lifecycle.onDevicesWatch(open)),
  };
}

type LanEvents = Pick<LanLifecycle, 'onSession' | 'onFile'> & Partial<Pick<LanLifecycle, 'onDeviceRun'>>;

/** Session, file and device-run events on main's bus, after the utility bridge republishes them. */
export function watchLanEvents(events: EventBus, lan: LanEvents): () => void {
  const offSession = events.on('transfer.session', (event) => lan.onSession(event.payload));
  const offFile = events.on('transfer.file', (event) => lan.onFile(event.payload));
  const offRun = events.on('transfer.deviceRun', (event) => lan.onDeviceRun?.(event.payload));
  return () => {
    offSession();
    offFile();
    offRun();
  };
}

/** One `onWatch(true)` while any devices iterator is open, and `false` when the last one ends. */
export function trackDevicesWatch(onWatch: (open: boolean) => void): (open: boolean) => void {
  let open = 0;
  return (next) => {
    if (next) {
      open += 1;
      if (open === 1) onWatch(true);
      return;
    }
    if (open === 0) return;
    open -= 1;
    if (open === 0) onWatch(false);
  };
}

/**
 * Holds the lan process for as long as a window iterates `transfer.devices`.
 * The count starts on the first `next` and ends once, in the iterator's close.
 */
export function watchLanDevices<C extends object>(client: C, note: (open: boolean) => void): C {
  return wrapAt(client, 'transfer', (transfer) =>
    isObject(transfer)
      ? wrapAt(transfer, 'devices', (call) => (isCall(call) ? watchDevicesCall(call, note) : call))
      : transfer,
  );
}

/** `target` with one property passed through `wrap` on every read; everything else as it was. */
function wrapAt<T extends object>(target: T, key: PropertyKey, wrap: (value: unknown) => unknown): T {
  return new Proxy(target, {
    get(inner, prop, receiver) {
      const value: unknown = Reflect.get(inner, prop, receiver);
      return prop === key ? wrap(value) : value;
    },
  });
}

function watchDevicesCall(
  call: (...args: never[]) => unknown,
  note: (open: boolean) => void,
): (...args: never[]) => unknown {
  return new Proxy(call, {
    apply(target, thisArg, args) {
      const result: unknown = Reflect.apply(target, thisArg, args);
      if (!isThenable(result)) return watchValue(result, note);
      return result.then((value) => watchValue(value, note));
    },
  });
}

function watchValue(value: unknown, note: (open: boolean) => void): unknown {
  if (!isObject(value)) return value;
  return watchIterator(value, note);
}

const ITERATOR_STEPS = new Set<PropertyKey>(['next', 'return', 'throw']);

function watchIterator<I extends object>(iterator: I, note: (open: boolean) => void): I {
  const session = iteratorSession(note);
  return new Proxy(iterator, {
    get(target, prop, receiver) {
      if (prop === Symbol.asyncIterator) return () => receiver;
      const value: unknown = Reflect.get(target, prop, receiver);
      if (!ITERATOR_STEPS.has(prop) || !isCall(value)) return value;
      return wrapStep(target, value, prop === 'next', session);
    },
  });
}

interface IteratorSession {
  start(): void;
  finish(): void;
}

function iteratorSession(note: (open: boolean) => void): IteratorSession {
  let opened = false;
  let settled = false;
  return {
    start() {
      if (opened) return;
      opened = true;
      note(true);
    },
    finish() {
      if (!opened || settled) return;
      settled = true;
      note(false);
    },
  };
}

function wrapStep(
  target: object,
  method: (...args: never[]) => unknown,
  isNext: boolean,
  session: IteratorSession,
): (...args: unknown[]) => unknown {
  return (...args) => {
    if (isNext) session.start();
    let result: unknown;
    try {
      result = Reflect.apply(method, target, args);
    } catch (error) {
      session.finish();
      throw error;
    }
    if (!isThenable(result)) {
      if (!isNext || isDone(result)) session.finish();
      return result;
    }
    return result.then(
      (step) => {
        if (!isNext || isDone(step)) session.finish();
        return step;
      },
      (error: unknown) => {
        session.finish();
        throw error;
      },
    );
  };
}

function isObject(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function isCall(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function';
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return isObject(value) && 'then' in value && typeof value.then === 'function';
}

function isDone(value: unknown): boolean {
  return isObject(value) && 'done' in value && value.done === true;
}
