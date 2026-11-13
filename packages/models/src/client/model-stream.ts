// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A ModelStream over a producer function. The producer starts at once and
 * pushes events into a buffer; the consumer may iterate at its own pace, or
 * not at all and just await result().
 */
import { err, toTaalcutError, type AsyncResult, type Result } from '@taalcut/core';
import type { ModelEvent, ModelResult, ModelStream } from './types';

export type Emit = (event: ModelEvent) => void;

export function createModelStream(produce: (emit: Emit) => Promise<Result<ModelResult>>): ModelStream {
  const buffer: ModelEvent[] = [];
  let finished = false;
  let wake: (() => void) | undefined;

  const emit: Emit = (event) => {
    buffer.push(event);
    wake?.();
  };

  const outcome: AsyncResult<ModelResult> = (async () => {
    try {
      return await produce(emit);
    } catch (cause) {
      // A throw here is a bug, but the stream must still end with exactly one terminal event.
      const error = toTaalcutError(cause);
      emit({ type: 'error', error });
      return err(error);
    } finally {
      finished = true;
      wake?.();
    }
  })();

  async function* iterate(): AsyncGenerator<ModelEvent> {
    let index = 0;
    for (;;) {
      if (index < buffer.length) {
        yield buffer[index++]!;
        continue;
      }
      if (finished) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = undefined;
    }
  }

  return {
    [Symbol.asyncIterator]: () => iterate(),
    result: () => outcome,
  };
}
