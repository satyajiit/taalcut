// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EventLogStore implementations: in memory (tests, replay) and one JSON-lines
 * file per run (development, and the crash tests until the library's SQLite
 * table lands). The file store syncs each append to disk before it returns,
 * so an acknowledged event survives kill -9. A line counts only once its
 * newline is on disk: a crash can leave a last line cut short, or complete
 * JSON with no newline, and neither was acknowledged. Both are ignored, and cut
 * off before the next append so new lines never run onto them.
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  truncateSync,
} from 'node:fs';
import { join } from 'node:path';
import { attempt, err, ok, type RunId } from '@taalcut/core';
import { LogConflict, LogStoreFailed } from './errors';
import { readEvent, TERMINAL_EVENTS, type AgentEvent, type NewAgentEvent } from './events';
import type { EventLogStore } from './ports';

const isTerminal = (events: readonly AgentEvent[]) =>
  events.some((event) => TERMINAL_EVENTS.includes(event.type));

const number = (runId: RunId, from: number, events: readonly NewAgentEvent[]): AgentEvent[] =>
  events.map((event, i) => ({ ...event, runId, seq: from + i }) as AgentEvent);

export function createMemoryEventLogStore(): EventLogStore & { readonly runs: Map<RunId, AgentEvent[]> } {
  const runs = new Map<RunId, AgentEvent[]>();
  return {
    runs,
    async append(runId, expectedSeq, events) {
      const log = runs.get(runId) ?? [];
      if (expectedSeq !== log.length) return err(LogConflict({ runId, expectedSeq }));
      // Copy through JSON, as a real store would: no shared references with the caller.
      const numbered = number(runId, expectedSeq, events).map(
        (e) => JSON.parse(JSON.stringify(e)) as AgentEvent,
      );
      runs.set(runId, [...log, ...numbered]);
      return ok(expectedSeq + events.length - 1);
    },
    async read(runId, fromSeq = 0) {
      return ok((runs.get(runId) ?? []).slice(fromSeq));
    },
    async openRuns() {
      return ok([...runs.entries()].filter(([, events]) => !isTerminal(events)).map(([id]) => id));
    },
  };
}

/** One `<runId>.jsonl` file per run in `dir`. One writer per run (the agent process). */
export function createFileEventLogStore(dir: string): EventLogStore {
  mkdirSync(dir, { recursive: true });
  const nextSeq = new Map<RunId, number>();
  const file = (runId: RunId) => join(dir, `${runId}.jsonl`);

  /** The valid events, and how many bytes of the file they span. */
  const scan = (runId: RunId): { events: AgentEvent[]; validBytes: number } => {
    if (!existsSync(file(runId))) return { events: [], validBytes: 0 };
    const events: AgentEvent[] = [];
    let validBytes = 0;
    const lines = readFileSync(file(runId), 'utf8').split('\n');
    // What follows the last newline was never acknowledged, even if it parses.
    lines.pop();
    for (const line of lines) {
      const event = line.trim() ? parseLine(line) : undefined;
      // A line cut short by a crash mid-write was never acknowledged: drop it and everything after.
      if (!event || event.seq !== events.length) break;
      events.push(event);
      validBytes += Buffer.byteLength(line) + 1;
    }
    return { events, validBytes };
  };
  const load = (runId: RunId) => scan(runId).events;

  /** Before this process first writes to a run, cut off any torn tail so new lines follow valid ones. */
  const prepare = (runId: RunId): number => {
    const { events, validBytes } = scan(runId);
    if (existsSync(file(runId)) && statSync(file(runId)).size > validBytes)
      truncateSync(file(runId), validBytes);
    return events.length;
  };

  return {
    async append(runId, expectedSeq, events) {
      const next = nextSeq.get(runId) ?? prepare(runId);
      if (expectedSeq !== next) return err(LogConflict({ runId, expectedSeq }));
      const lines = number(runId, expectedSeq, events)
        .map((e) => `${JSON.stringify(e)}\n`)
        .join('');
      const written = attempt(() => {
        const fd = openSync(file(runId), 'a');
        try {
          appendFileSync(fd, lines);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      });
      if (!written.ok) {
        // The write may have left part of a line: check the file again before the next append.
        nextSeq.delete(runId);
        return err(LogStoreFailed(undefined, { detail: written.error.detail }));
      }
      nextSeq.set(runId, expectedSeq + events.length);
      return ok(expectedSeq + events.length - 1);
    },
    async read(runId, fromSeq = 0) {
      return ok(load(runId).slice(fromSeq));
    },
    async openRuns() {
      const ids = readdirSync(dir)
        .filter((name) => name.endsWith('.jsonl'))
        .map((name) => name.slice(0, -'.jsonl'.length) as RunId);
      return ok(ids.filter((id) => !isTerminal(load(id))).sort());
    },
  };
}

function parseLine(line: string): AgentEvent | undefined {
  try {
    return readEvent(JSON.parse(line));
  } catch {
    return undefined;
  }
}
