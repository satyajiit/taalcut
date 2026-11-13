// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The in-process event bus: typed, synchronous, fire-and-forget. One per
 * process; eventsRouter and bridgeEvents carry selected events between
 * processes. Durable facts (job state, the agent log) live in storage; events
 * only say that something changed.
 */
import type { Clock } from '../basics/clock';
import { createToken } from '../di/token';
import type { EventOf, EventPayload, EventType, TaalcutEvent } from './catalogue';

export type Unsubscribe = () => void;

export interface EventBus {
  /** Stamps `at` from the clock and delivers to every current subscriber. */
  emit<T extends EventType>(type: T, payload: EventPayload<T>): void;
  /** Delivers an event as it is, keeping its `at` (events arriving from another process). */
  publish(event: TaalcutEvent): void;
  on<T extends EventType>(type: T, listener: (event: EventOf<T>) => void): Unsubscribe;
  /** Every event, or only `types`. */
  onAny(listener: (event: TaalcutEvent) => void, types?: readonly EventType[]): Unsubscribe;
}

export interface EventBusDeps {
  readonly clock: Clock;
  /** A listener threw. Default: console.error. The other listeners still run. */
  readonly onListenerError?: (error: unknown, event: TaalcutEvent) => void;
}

export const EventBusToken = createToken<EventBus>('core.eventBus');

interface Subscription {
  readonly types: ReadonlySet<EventType> | null;
  readonly listener: (event: TaalcutEvent) => void;
}

const logListenerError = (error: unknown, event: TaalcutEvent): void => {
  console.error(`Event listener for '${event.type}' threw`, error);
};

export function createEventBus({ clock, onListenerError = logListenerError }: EventBusDeps): EventBus {
  // One list in subscription order, so delivery order is predictable.
  const subscriptions: Subscription[] = [];

  const subscribe = (subscription: Subscription): Unsubscribe => {
    subscriptions.push(subscription);
    return () => {
      const index = subscriptions.indexOf(subscription);
      if (index >= 0) subscriptions.splice(index, 1);
    };
  };

  const publish = (event: TaalcutEvent): void => {
    for (const { types, listener } of [...subscriptions]) {
      if (types && !types.has(event.type)) continue;
      try {
        listener(event);
      } catch (error) {
        onListenerError(error, event);
      }
    }
  };

  return {
    emit(type, payload) {
      publish({ type, at: clock.now(), payload } as TaalcutEvent);
    },
    publish,
    on(type, listener) {
      return subscribe({ types: new Set([type]), listener: listener as (event: TaalcutEvent) => void });
    },
    onAny(listener, types) {
      return subscribe({ types: types ? new Set(types) : null, listener });
    },
  };
}
