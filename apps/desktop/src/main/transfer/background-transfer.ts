// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { TransferStreamItem } from '@taalcut/core';

interface Subscriber {
  readonly pending: Map<string, TransferStreamItem>;
  wake?: () => void;
}
interface Reception {
  readonly abort: AbortController;
  readonly latest: Map<string, TransferStreamItem>;
  readonly viewers: Set<Subscriber>;
  done: Promise<void>;
  ended: boolean;
  failed?: unknown;
}
const itemKey = (item: TransferStreamItem) =>
  item.type === 'session'
    ? 'session'
    : item.type === 'file'
      ? `file:${item.file.id}`
      : `approval:${item.approval.id}`;

/** Main owns reception; reconnecting a renderer observes the same session. Pairing secrets stay in memory. */
export function createBackgroundTransferOwner() {
  let active: Reception | undefined;
  const closeReception = async (current: Reception | undefined) => {
    current?.abort.abort();
    await current?.done;
    if (active === current) active = undefined;
  };
  const close = () => closeReception(active);
  function begin(call: (...args: unknown[]) => unknown, args: unknown[]): Reception {
    const state: Reception = {
      abort: new AbortController(),
      latest: new Map(),
      viewers: new Set(),
      done: Promise.resolve(),
      ended: false,
    };
    const requestOptions = (args[1] ?? {}) as { signal?: AbortSignal };
    state.done = (async () => {
      try {
        const stream = (await call(args[0], {
          ...requestOptions,
          signal: state.abort.signal,
        })) as AsyncIterable<TransferStreamItem>;
        for await (const update of stream) {
          const prior = state.latest.get('session');
          const item: TransferStreamItem =
            update.type === 'session' &&
            !update.pairing &&
            update.session.state === 'listening' &&
            prior?.type === 'session' &&
            prior.session.id === update.session.id &&
            prior.pairing
              ? { ...update, pairing: prior.pairing }
              : update;
          const key = itemKey(item);
          state.latest.set(key, item);
          for (const viewer of state.viewers) {
            viewer.pending.set(key, item);
            viewer.wake?.();
          }
        }
      } catch (cause) {
        if (!state.abort.signal.aborted) state.failed = cause;
      } finally {
        state.ended = true;
        for (const viewer of state.viewers) viewer.wake?.();
      }
    })();
    return state;
  }
  async function open(call: (...args: unknown[]) => unknown, args: unknown[]) {
    if (!active || active.ended) active = begin(call, args);
    const state = active;
    const signal = ((args[1] ?? {}) as { signal?: AbortSignal }).signal;
    const viewer: Subscriber = { pending: new Map(state.latest) };
    state.viewers.add(viewer);
    return (async function* () {
      const wake = () => viewer.wake?.();
      signal?.addEventListener('abort', wake, { once: true });
      try {
        while (!signal?.aborted) {
          if (viewer.pending.size) {
            const [key, item] = viewer.pending.entries().next().value!;
            viewer.pending.delete(key);
            yield item;
            continue;
          }
          if (state.ended) {
            if (state.failed) throw state.failed;
            return;
          }
          await new Promise<void>((resolve) => {
            viewer.wake = resolve;
          });
          viewer.wake = undefined;
        }
      } finally {
        signal?.removeEventListener('abort', wake);
        state.viewers.delete(viewer);
        viewer.pending.clear();
      }
    })();
  }
  return {
    close,
    wrap<C extends object>(client: C): C {
      return new Proxy(client, {
        get(target, property, receiver) {
          const value: unknown = Reflect.get(target, property, receiver);
          if (property !== 'transfer' || value === null || typeof value !== 'object') return value;
          return new Proxy(value, {
            get(transfer, name, receiver) {
              const method: unknown = Reflect.get(transfer, name, receiver);
              if (typeof method !== 'function') return method;
              if (name === 'open')
                return (...args: unknown[]) =>
                  open((...input) => Reflect.apply(method, transfer, input), args);
              if (name === 'close')
                return async (...args: unknown[]) => {
                  const closing = active;
                  const result: unknown = await Reflect.apply(method, transfer, args);
                  await closeReception(closing);
                  return result;
                };
              return method;
            },
          });
        },
      });
    },
  };
}
