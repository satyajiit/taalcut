// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CardOf } from '@taalcut/core';
import type { ToolCallStatus } from './call-chip';

/** One tool call in a run, as the transcript gives it to a run block. */
export interface RunTool {
  card: CardOf<'toolRun'>;
  /** The plan step that was running when the call started, if any. */
  stepId?: string;
}

/**
 * What a run's list of calls shows: a call on its own, or a run of calls to the same tool as one row (FIX-TOOLGROUPS:
 * the agent inspected 11 clips at once and the chat said "Inspect a clip" eleven times). The key is the first
 * call's id, so a row keeps its place, and its open or closed state, as calls join it.
 */
export type ToolRunEntry =
  | { kind: 'call'; key: string; call: RunTool }
  | { kind: 'group'; key: string; tool: string; calls: readonly RunTool[] };

/**
 * Folds consecutive calls to the same tool into one group; a call between them to another tool ends the group, so
 * the order stays true. A lone call stays a call. Pure, so a run replayed from history groups exactly as it did live.
 */
export function groupToolRuns(tools: readonly RunTool[]): ToolRunEntry[] {
  const runs: RunTool[][] = [];
  for (const tool of tools) {
    const last = runs.at(-1);
    if (last && last[0]!.card.tool === tool.card.tool) last.push(tool);
    else runs.push([tool]);
  }
  return runs.map((calls): ToolRunEntry => {
    const first = calls[0]!;
    return calls.length === 1
      ? { kind: 'call', key: first.card.id, call: first }
      : { kind: 'group', key: first.card.id, tool: first.card.tool, calls };
  });
}

/** How a group of calls is going, counted. */
export interface ToolRunTally {
  total: number;
  /** Succeeded. */
  done: number;
  failed: number;
  running: number;
  /** Stopped before they finished (the run was stopped). */
  stopped: number;
  /**
   * The group's one status, for its chip: running while any call runs; then failed if any failed, stopped if any
   * was stopped, else done.
   */
  status: ToolCallStatus;
}

export function tallyToolRuns(calls: readonly RunTool[]): ToolRunTally {
  const count = (status: ToolCallStatus) => calls.filter(({ card }) => card.status === status).length;
  const done = count('succeeded');
  const failed = count('failed');
  const running = count('running');
  const stopped = count('cancelled');
  const status: ToolCallStatus =
    running > 0 ? 'running' : failed > 0 ? 'failed' : stopped > 0 ? 'cancelled' : 'succeeded';
  return { total: calls.length, done, failed, running, stopped, status };
}
