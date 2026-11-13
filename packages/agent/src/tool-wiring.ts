// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How the agent plugs into the tool executor: its command dispatcher as the
 * executor's command bus, and an idempotency store backed by the run log, so
 * a call repeated after a restart gets the logged outcome instead of running
 * again.
 */
import type { RunId } from '@taalcut/core';
import type { IdempotencyStore, IdempotentOutcome, ToolCommandBus } from '@taalcut/tools';
import type { CommandDispatchMeta, CommandDispatcher } from './ports';
import type { RunState } from './state';

export function createLogIdempotencyStore(
  runState: (runId: RunId) => RunState | undefined,
  idempotencyKeys: Map<string, string>,
): IdempotencyStore {
  const remembered = new Map<string, IdempotentOutcome>();
  return {
    async get(key) {
      const hit = remembered.get(key);
      if (hit) return hit;
      // After a restart, outcomes are found in the run's own log (keys start with the run id).
      const state = runState(key.slice(0, key.indexOf(':')) as RunId);
      return state ? loggedOutcome(state, key) : undefined;
    },
    async set(key, outcome) {
      remembered.set(key, outcome);
      idempotencyKeys.set(outcome.ok ? outcome.result.callId : outcome.callId, key);
    },
  };
}

export function toolCommandBus(commands: CommandDispatcher): ToolCommandBus {
  return {
    dispatch: (command, payload, meta) =>
      commands.dispatch(command, payload, {
        ...originOf(meta),
        toolCallId: meta.callId,
        tool: meta.tool,
        ...(meta.runId ? { runId: meta.runId } : {}),
        ...(meta.idempotencyKey ? { idempotencyKey: meta.idempotencyKey } : {}),
        ...(meta.signal ? { signal: meta.signal } : {}),
      }),
  };
}

/** The logged outcome of the call that used `key`: a completed call, or a failure logged with its key. */
function loggedOutcome(state: RunState, key: string): IdempotentOutcome | undefined {
  for (const call of Object.values(state.toolCalls)) {
    const outcome = call.outcome;
    if (outcome?.payload.idempotencyKey !== key) continue;
    if (outcome.kind === 'failed')
      return { ok: false, callId: outcome.payload.toolCallId, error: outcome.payload.error };
    const done = outcome.payload;
    return {
      ok: true,
      result: {
        callId: done.toolCallId,
        tool: call.requested.tool,
        version: done.version ?? '',
        inputHash: done.inputHash ?? '',
        value: done.output.kind === 'inline' ? done.output.value : done.output.ref,
        output: done.output,
        usage: done.usage,
        cached: false,
        deduplicated: false,
        attempts: done.attempts,
        durationMs: done.durationMs,
        ...(done.approvalId ? { approvalId: done.approvalId } : {}),
      },
    };
  }
  return undefined;
}

/**
 * The dispatch's origin. @taalcut/tools' ToolDispatchMeta gains `source: 'agent' | 'mcp'` and `actor` (lane
 * mcp-release, P3-V4); read structurally so this passes them through before and after that change.
 */
function originOf(meta: {
  readonly source: string;
  readonly actor?: unknown;
}): Pick<CommandDispatchMeta, 'source' | 'actor'> {
  const actor = typeof meta.actor === 'string' ? { actor: meta.actor } : {};
  return meta.source === 'mcp' ? { source: 'mcp', ...actor } : { source: 'agent', ...actor };
}
