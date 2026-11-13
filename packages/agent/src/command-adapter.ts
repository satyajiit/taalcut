// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's CommandDispatcher over core's command bus. A tool's command runs
 * with source 'agent' and actor 'agent:<runId>', so it gets the same audit
 * entry as the UI button; the tool's idempotency key becomes the bus's, so a
 * resumed run can't apply a command twice. EDT1: every command of one run (one
 * turn, the answer to one message) joins the run's group, so one undo takes
 * the whole turn back. An MCP client's calls stay one step each.
 */
import { agentTurnGroup, CancelledError, err, ok, type CommandBus, type AsyncResult } from '@taalcut/core';
import type { CommandDispatcher } from './ports';

export function createCommandDispatcher(
  bus: Pick<CommandBus, 'dispatch'>,
  verify?: (command: string, result: unknown) => AsyncResult<void>,
): CommandDispatcher {
  return {
    async dispatch(command, payload, meta) {
      // The tool's attempt timed out or the run was cancelled before the command started.
      if (meta.signal?.aborted) return err(CancelledError());
      const origin =
        meta.source === 'mcp'
          ? { source: 'mcp' as const, actor: meta.actor ?? 'mcp' }
          : { source: 'agent' as const, actor: meta.actor ?? (meta.runId ? `agent:${meta.runId}` : 'agent') };
      const options = {
        ...(meta.idempotencyKey ? { idempotencyKey: meta.idempotencyKey } : {}),
        ...(meta.source === 'agent' && meta.runId ? { group: agentTurnGroup(meta.runId) } : {}),
      };
      const receipt = await bus.dispatch(command, payload, origin, options);
      if (!receipt.ok) return receipt;
      if (verify) {
        const verified = await verify(command, receipt.value.result);
        if (!verified.ok) return verified;
      }
      return ok(receipt.value.result);
    },
  };
}
