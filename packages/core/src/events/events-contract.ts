// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Events across processes. Each process serves `events.subscribe` from its
 * own bus. Main bridges each utility process's events into its bus, and the
 * renderer subscribes to main's: utility bus → port → main bus → port →
 * renderer. Every event is validated against the catalogue on each hop.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { err, ok, type AsyncResult } from '../basics/result';
import type { CommandBus } from '../commands/bus-types';
import { eventIterator, implementContract, ipc, type RpcClient } from '../ipc/contract';
import { callRpc, fromRpcError } from '../ipc/errors';
import type { EventBus, Unsubscribe } from './bus';
import { eventTypeSchema, taalcutEventSchema, type EventType } from './catalogue';
import { eventStream } from './stream';

export const eventsContract = {
  /** Events of the given types (default: all the server exposes) from now on, until the caller stops. */
  subscribe: ipc
    .input(z.object({ types: z.array(eventTypeSchema).min(1).optional() }).optional())
    .output(eventIterator(taalcutEventSchema)),
};

export interface EventsRouterOptions {
  /** The types this process lets out. Default: all. */
  readonly exposed?: readonly EventType[];
  readonly maxBuffered?: number;
}

export function eventsRouter(bus: EventBus, options: EventsRouterOptions = {}) {
  const os = implementContract(eventsContract);
  const exposed = options.exposed ? new Set(options.exposed) : null;
  return os.router({
    subscribe: os.subscribe.handler(({ input, signal }) => {
      const requested = input?.types ?? options.exposed;
      const types = requested && exposed ? requested.filter((type) => exposed.has(type)) : requested;
      return eventStream(bus, { types, signal, maxBuffered: options.maxBuffered });
    }),
  });
}

export interface EventBridge {
  /** Resolves when the remote stream ends: Ok after stop(), Err when the other process went away or overflowed. */
  readonly done: AsyncResult<void>;
  stop(): void;
}

/**
 * Subscribes to another process's events and republishes them on `bus`,
 * keeping their timestamps. Resolves once the subscription is live.
 */
export async function bridgeEvents(
  remote: RpcClient<typeof eventsContract>,
  bus: EventBus,
  options: { readonly types?: readonly EventType[] } = {},
): AsyncResult<EventBridge> {
  const controller = new AbortController();
  const input = options.types ? { types: [...options.types] } : undefined;
  const stream = await callRpc(remote.subscribe(input, { signal: controller.signal }));
  if (!stream.ok) return stream;
  const done = (async (): AsyncResult<void> => {
    try {
      for await (const event of stream.value) bus.publish(event);
      return ok(undefined);
    } catch (cause) {
      const error = fromRpcError(cause);
      return controller.signal.aborted ? ok(undefined) : err(error);
    }
  })();
  return ok({ done, stop: () => controller.abort() });
}

/** Publishes command-bus changes as command.changed events, so every window refreshes after undo. */
export function forwardCommandEvents(commands: CommandBus, events: EventBus): Unsubscribe {
  return commands.subscribe(({ kind, id, name, projectId, origin }) =>
    events.emit('command.changed', { kind, id, name, projectId, source: origin.source, actor: origin.actor }),
  );
}
