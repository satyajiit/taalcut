// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Events from a bus as an async iterator, for streaming them over IPC. The
 * buffer is bounded: a reader that falls more than `maxBuffered` events
 * behind gets core.event_stream_overflow (retryable) and should resubscribe
 * and re-read state, rather than the process holding events without limit.
 */
import { defineError, type TaalcutError } from '../basics/errors';
import type { EventBus } from './bus';
import type { EventType, TaalcutEvent } from './catalogue';

export const EventStreamOverflow = defineError<{ max: number }>('core.event_stream_overflow', {
  retryable: true,
});

export interface EventStreamOptions {
  readonly types?: readonly EventType[];
  /** Ends the stream (done, not an error). */
  readonly signal?: AbortSignal;
  /** Default 1000. */
  readonly maxBuffered?: number;
}

export type EventStream = AsyncIteratorObject<TaalcutEvent, undefined, unknown>;

export function eventStream(bus: EventBus, options: EventStreamOptions = {}): EventStream {
  const { types, signal, maxBuffered = 1000 } = options;
  const buffer: TaalcutEvent[] = [];
  let waiting: ((result: IteratorResult<TaalcutEvent>) => void) | undefined;
  let failure: TaalcutError | undefined;
  let finished = false;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    unsubscribe();
    signal?.removeEventListener('abort', finish);
    waiting?.({ done: true, value: undefined });
    waiting = undefined;
  };

  const unsubscribe = bus.onAny((event) => {
    if (waiting) {
      const resolve = waiting;
      waiting = undefined;
      resolve({ done: false, value: event });
    } else if (buffer.length < maxBuffered) {
      buffer.push(event);
    } else {
      buffer.length = 0;
      failure = EventStreamOverflow({ max: maxBuffered });
      finish();
    }
  }, types);

  if (signal?.aborted) finish();
  else signal?.addEventListener('abort', finish, { once: true });

  const close = (): Promise<IteratorReturnResult<undefined>> => {
    finish();
    buffer.length = 0;
    return Promise.resolve({ done: true, value: undefined });
  };

  const iterator: EventStream = {
    next() {
      const event = buffer.shift();
      if (event) return Promise.resolve({ done: false, value: event });
      if (failure) {
        const error = failure;
        failure = undefined;
        return Promise.reject(error);
      }
      if (finished) return Promise.resolve({ done: true, value: undefined });
      return new Promise((resolve) => (waiting = resolve));
    },
    return: close,
    [Symbol.asyncIterator]: () => iterator,
    [Symbol.asyncDispose]: async () => void (await close()),
  };
  return iterator;
}
