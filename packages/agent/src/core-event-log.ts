// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's EventLogStore over core's (which @taalcut/library implements on
 * the agent_events table, createLibraryPorts(db).eventLog). Core numbers a
 * run's entries from 1 and stores { at, type, data }; the agent numbers its
 * events from 0 and keeps { type, v, at, payload }, so data is { v, payload }.
 * The run's status and conversation go to the store with the events that set
 * them, so listRuns finds runs to resume.
 */
import {
  ConflictError,
  err,
  isId,
  NotFoundError,
  ok,
  type ConversationId,
  type EventLogStore as CoreEventLogStore,
  type RunStatus,
} from '@taalcut/core';
import { LogConflict } from './errors';
import { readEvent, type AgentEventType, type NewAgentEvent } from './events';
import type { EventLogStore } from './ports';

const STATUS_AFTER: Partial<Record<AgentEventType, RunStatus>> = {
  'run.started': 'running',
  'run.resumed': 'running',
  'run.paused': 'paused',
  'run.completed': 'succeeded',
  'run.failed': 'failed',
  'run.cancelled': 'cancelled',
};

export function fromCoreEventLog(store: CoreEventLogStore): EventLogStore {
  return {
    async append(runId, expectedSeq, events) {
      const status = events.map((e) => STATUS_AFTER[e.type]).findLast((s) => s !== undefined);
      const conversationId = conversationOf(events);
      const written = await store.append(
        runId,
        events.map((e) => ({ at: e.at, type: e.type, data: { v: e.v, payload: e.payload } })),
        { expectedSeq, ...(status ? { status } : {}), ...(conversationId ? { conversationId } : {}) },
      );
      if (!written.ok) {
        return ConflictError.is(written.error) ? err(LogConflict({ runId, expectedSeq })) : written;
      }
      return ok(written.value.lastSeq - 1);
    },

    async read(runId, fromSeq = 0) {
      const entries = await store.read(runId, fromSeq + 1);
      // The agent reads an unknown run as an empty log.
      if (!entries.ok) return NotFoundError.is(entries.error) ? ok([]) : entries;
      return ok(
        entries.value.flatMap((entry) => {
          const data = (entry.data ?? {}) as { v?: unknown; payload?: unknown };
          const event = readEvent({
            runId,
            seq: entry.seq - 1,
            type: entry.type,
            v: data.v,
            at: entry.at,
            payload: data.payload,
          });
          return event ? [event] : [];
        }),
      );
    },

    async openRuns() {
      const runs = await store.listRuns({ statuses: ['running', 'paused'], limit: 1000 });
      return runs.ok ? ok(runs.value.map((run) => run.runId)) : runs;
    },
  };
}

function conversationOf(events: readonly NewAgentEvent[]): ConversationId | undefined {
  const started = events.find((e) => e.type === 'run.started');
  const id = started?.type === 'run.started' ? started.payload.conversationId : undefined;
  return isId(id) ? (id as ConversationId) : undefined;
}
