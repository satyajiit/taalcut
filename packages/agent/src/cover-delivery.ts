// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { coverExportResultSchema, type RunId } from '@taalcut/core';
import type { CommandDispatcher } from './ports';
import type { RunLog } from './run-log';

/** A stopped tool can still finish an already-started command. Its saved file must remain reachable. */
export function withCoverDelivery(
  commands: CommandDispatcher,
  runLog: (runId: RunId | undefined) => RunLog | undefined,
  now: () => number,
): CommandDispatcher {
  return {
    async dispatch(command, payload, meta) {
      const log =
        command === 'render.exportCover' && meta.tool === command && meta.source === 'agent'
          ? runLog(meta.runId)
          : undefined;
      const requested = log?.events.find(
        (event) => event.type === 'tool.requested' && event.payload.toolCallId === meta.toolCallId,
      );
      const result = await commands.dispatch(command, payload, meta);
      if (!result.ok || !log || !requested) return result;
      const cover = coverExportResultSchema.safeParse(result.value);
      const id = `cover:${meta.toolCallId}`;
      if (!cover.success || log.state.cards[id]) return result;
      // This is only a receipt. Never restart the model or change the run's cancelled status.
      const written = await log.append([
        'card.sent',
        {
          toolCallId: meta.toolCallId,
          card: {
            type: 'toolRun',
            version: 1,
            id,
            runId: log.runId,
            toolRunId: meta.toolCallId,
            tool: command,
            status: 'succeeded',
            startedAt: requested.at,
            finishedAt: now(),
            savedCover: cover.data,
          },
        },
      ]);
      return written.ok ? result : written;
    },
  };
}
