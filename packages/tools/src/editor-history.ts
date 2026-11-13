// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  defineTool,
  defineToolModule,
  HISTORY_COMMANDS,
  historyMutationSchema,
  historyStateJsonSchema,
  NO_TOOL_RETRY,
  ulidSchema,
  type AnyTool,
  type CommandBus,
} from '@taalcut/core';
import { z } from 'zod';

/** Same queue and ownership checks as the UI and MCP history actions. */
export function editorHistoryTools(bus: CommandBus) {
  const read = defineTool({
    name: 'history.get',
    version: '1.0.0',
    description:
      'Inspects the last edit that can be undone and the change that can be redone, with their stable command ids and a current history token. Read this before undoing or redoing an edit. Use the id as a precondition to change exactly that step, including an entire AI turn.',
    summary: 'Shows the last edit to undo or redo, with command ids and a history token.',
    tags: ['history', 'undo', 'redo', 'last', 'edit'],
    input: z.object({ projectId: ulidSchema('Project') }),
    output: historyStateJsonSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    run: (input) => bus.history(input.projectId, { includeIds: true }),
  });
  const steps = Object.values(HISTORY_COMMANDS).map(
    (name) =>
      defineTool({
        name,
        command: name,
        version: '1.0.0',
        description: `${name === HISTORY_COMMANDS.undo ? 'Undoes' : 'Redoes'} the next project history step, including its complete AI group. Read history.get first and pass expectedCommandId and expectedHistoryToken from its token. A stale or repeated id changes nothing. Ownership and Stop checks apply.`,
        summary:
          name === HISTORY_COMMANDS.undo
            ? 'Undoes the last edit or entire AI turn after inspecting history.get.'
            : 'Redoes the last undone edit or AI turn after inspecting history.get.',
        tags: ['history', name === HISTORY_COMMANDS.undo ? 'undo' : 'redo', 'last', 'edit'],
        input: historyMutationSchema,
        output: z.unknown(),
        costClass: 'local',
        sideEffect: 'write',
        timeoutMs: 30_000,
        retry: NO_TOOL_RETRY,
        idempotencyKey: (input) =>
          `${name}:${input.projectId}:${input.expectedCommandId}:${input.expectedHistoryToken}`,
        run: (input, ctx) => ctx.dispatch(input),
      }) as AnyTool,
  );
  return defineToolModule({ id: 'history', tools: [read as AnyTool, ...steps] });
}
