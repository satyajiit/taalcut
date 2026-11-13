// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ok, type AsyncResult } from '@taalcut/core';
import type { BridgeSession, DeviceItem } from './bridge';
import { itemKey } from './device-key';
import { DeviceGone } from './errors';
import type { DeviceHub } from './hub';
import { accessError } from './hub-view';
import { drainListing } from './listing';

/** One phone's listing, with its items by itemKey for the page's thumbnail lookups. */
export interface Catalogue {
  readonly session: BridgeSession;
  readonly items: DeviceItem[];
  readonly byKey: ReadonlyMap<string, DeviceItem>;
}

export function catalogueOf(items: DeviceItem[], session: BridgeSession): Catalogue {
  return { session, items, byKey: new Map(items.map((item) => [itemKey(item.id), item])) };
}

interface ListingFlight {
  readonly controller: AbortController;
  readonly waiters: Set<() => void>;
  readonly promise: AsyncResult<Catalogue>;
}

const inflight = new WeakMap<BridgeSession, ListingFlight>();

/** Lists one session at a time, sharing an in-flight scan across concurrent open/item callers. */
export function loadSessionCatalogue(
  cache: Map<string, Catalogue>,
  deviceKey: string,
  session: BridgeSession,
  signal: AbortSignal,
): AsyncResult<Catalogue> {
  if (signal.aborted) return Promise.resolve(err(DeviceGone()));
  const existing = cache.get(deviceKey);
  if (existing && existing.session === session && session.access().state === 'ready') {
    return Promise.resolve(ok(existing));
  }
  let flight = inflight.get(session);
  if (!flight) {
    const controller = new AbortController();
    const waiters = new Set<() => void>();
    const promise = drainListing(session.list(controller.signal), controller.signal)
      .then((listed): Awaited<AsyncResult<Catalogue>> => {
        if (!listed.ok) return listed;
        const built = catalogueOf(listed.value, session);
        cache.set(deviceKey, built);
        return ok(built);
      })
      .finally(() => {
        if (inflight.get(session)?.controller === controller) inflight.delete(session);
      });
    flight = { controller, waiters, promise };
    inflight.set(session, flight);
  }
  const activeFlight = flight;
  return new Promise((resolve) => {
    let done = false;
    const leave = (): void => {
      activeFlight.waiters.delete(onAbort);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => {
      if (done) return;
      done = true;
      leave();
      if (activeFlight.waiters.size === 0) activeFlight.controller.abort();
      resolve(err(DeviceGone()));
    };
    activeFlight.waiters.add(onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    void activeFlight.promise.then((result) => {
      if (done) return;
      done = true;
      leave();
      resolve(result);
    });
  });
}

/** Cached files remain useful after unlock, but never stand in for current device access. */
export async function ensureCatalogue(
  hub: Pick<DeviceHub, 'view' | 'session'>,
  cache: Map<string, Catalogue>,
  deviceKey: string,
  signal: AbortSignal,
): AsyncResult<Catalogue> {
  const view = hub.view(deviceKey);
  const session = hub.session(deviceKey);
  if (!view || !view.connected) return err(DeviceGone());
  if (view.access !== 'ready' || !session) return err(accessError(view));
  const existing = cache.get(deviceKey);
  if (existing && existing.session === session) return ok(existing);
  return loadSessionCatalogue(cache, deviceKey, session, signal);
}
