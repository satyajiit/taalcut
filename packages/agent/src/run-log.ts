// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * RunLog: the one writer for a run. Appends go through a queue so parallel
 * tool calls and the approval policy can write concurrently without seq
 * conflicts; each acknowledged event is folded into `state` and handed to
 * `onEvent` (cards, status) in order.
 */
import { createSerialQueue, ok, type AsyncResult, type RunId } from '@taalcut/core';
import { newEvent, type AgentEvent, type AgentEventType, type EventPayloads } from './events';
import type { EventLogStore } from './ports';
import { applyEvent, foldEvents, type RunState } from './state';

/** Called with each event as it is acknowledged, the state after it, and the run's events up to it. */
export type LogListener = (event: AgentEvent, state: RunState, events: readonly AgentEvent[]) => void;

export type EventInput = { [T in AgentEventType]: readonly [T, EventPayloads[T]] }[AgentEventType];

export class RunLog {
  readonly state: RunState;
  private readonly appends = createSerialQueue();

  private constructor(
    private readonly store: EventLogStore,
    readonly runId: RunId,
    readonly events: AgentEvent[],
    private readonly now: () => number,
    private readonly onEvent: LogListener,
  ) {
    this.state = foldEvents(runId, events);
  }

  static async open(
    store: EventLogStore,
    runId: RunId,
    now: () => number,
    onEvent: LogListener = () => {},
  ): AsyncResult<RunLog> {
    const events = await store.read(runId);
    if (!events.ok) return events;
    return ok(new RunLog(store, runId, events.value, now, onEvent));
  }

  /** Appends events atomically, in order, after every append queued before it. */
  append(...inputs: EventInput[]): AsyncResult<AgentEvent[]> {
    const run = async (): AsyncResult<AgentEvent[]> => {
      const at = this.now();
      const fresh = inputs.map(([type, payload]) => newEvent(type, payload as never, at));
      const written = await this.store.append(this.runId, this.events.length, fresh);
      if (!written.ok) return written;
      const numbered = fresh.map(
        (e, i) => ({ ...e, runId: this.runId, seq: this.events.length + i }) as AgentEvent,
      );
      for (const event of numbered) {
        this.events.push(event);
        applyEvent(this.state, event);
        this.onEvent(event, this.state, this.events);
      }
      return ok(numbered);
    };
    return this.appends.run(run);
  }
}
