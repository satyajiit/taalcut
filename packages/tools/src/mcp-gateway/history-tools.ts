// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The gateway's own tools (tools SPEC, "Exposure"): `taalcut_history` (read), `taalcut_undo` and `taalcut_redo`
 * (edit), straight on the command bus with the session's origin. They act on the project's one history, so an MCP
 * client's undo can undo a click and ⌘Z in the app undoes an MCP edit (PRD V2). Redoing a destructive command is
 * refused (`mcp.person_only`): as a tool call it would have needed the in-app approval, which a redo would skip.
 * EDT1: so is redoing an agent turn's group, which runs every command of the turn again and may hold a destructive
 * one the history doesn't name.
 */
import {
  err,
  ok,
  ulidSchema,
  ValidationError,
  type AsyncResult,
  type CommandBus,
  type McpLevel,
  type McpToolDef,
} from '@taalcut/core';
import { z } from 'zod';
import { McpPersonOnly } from './errors';
import type { McpOrigin } from './external-runner';

export interface NativeTool {
  readonly def: McpToolDef;
  readonly needed: McpLevel;
  run(input: unknown, origin: McpOrigin): AsyncResult<Record<string, unknown>>;
}

const projectInput = z.object({ projectId: ulidSchema('Project') }).strict();

function inputSchema(): Record<string, unknown> {
  const json = z.toJSONSchema(projectInput, { target: 'draft-2020-12', io: 'input' }) as Record<
    string,
    unknown
  >;
  delete json['$schema'];
  return json;
}

function parse(input: unknown): AsyncResult<z.output<typeof projectInput>> {
  const parsed = projectInput.safeParse(input);
  return Promise.resolve(
    parsed.success
      ? ok(parsed.data)
      : err(ValidationError({ field: 'projectId' }, { detail: parsed.error.message })),
  );
}

const nameOrNull = { type: ['string', 'null'] };
const historyOutput = {
  type: 'object',
  properties: { undo: nameOrNull, redo: nameOrNull },
  required: ['undo', 'redo'],
};
const stepOutput = { type: 'object', properties: { command: nameOrNull }, required: ['command'] };

/** Whether the bus's next redo would apply a destructive command again, or may (a group). */
async function redoesDestructive(
  bus: Pick<CommandBus, 'history' | 'list'>,
  projectId: z.output<typeof projectInput>['projectId'],
): AsyncResult<string | null> {
  const state = await bus.history(projectId);
  if (!state.ok) return state;
  const next = state.value.redo;
  const destructive =
    next !== null &&
    (Boolean(state.value.redoGroup) ||
      bus.list().some((info) => info.name === next && info.sideEffect === 'destructive'));
  return ok(destructive ? next : null);
}

export function historyTools(
  bus: Pick<CommandBus, 'undo' | 'redo' | 'history' | 'list'>,
): readonly NativeTool[] {
  const schema = inputSchema();
  const step = (direction: 'undo' | 'redo'): NativeTool => ({
    needed: 'edit',
    def: {
      name: `taalcut_${direction}`,
      title:
        direction === 'undo' ? "Undo the project's last change" : "Redo the project's last undone change",
      description:
        direction === 'undo'
          ? "Reverses the latest undoable change in the project's history, whoever made it (you, the person or Taalcut's agent). Returns the command it undid, or null when there was nothing to undo."
          : 'Applies again the change the latest undo reversed. Returns the command it redid, or null.',
      inputSchema: schema,
      outputSchema: stepOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async run(input, origin) {
      const parsed = await parse(input);
      if (!parsed.ok) return parsed;
      if (direction === 'redo') {
        const refused = await redoesDestructive(bus, parsed.value.projectId);
        if (!refused.ok) return refused;
        if (refused.value !== null) return err(McpPersonOnly({ command: refused.value }));
      }
      const done = await bus[direction](parsed.value.projectId, origin);
      return done.ok ? ok({ command: done.value?.name ?? null }) : done;
    },
  });
  const history: NativeTool = {
    needed: 'read',
    def: {
      name: 'taalcut_history',
      title: 'What undo and redo would do next',
      description:
        "The names of the commands the project's next undo and redo would reverse or apply (null for none).",
      inputSchema: schema,
      outputSchema: historyOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async run(input) {
      const parsed = await parse(input);
      if (!parsed.ok) return parsed;
      const state = await bus.history(parsed.value.projectId);
      return state.ok ? ok({ undo: state.value.undo, redo: state.value.redo }) : state;
    },
  };
  return [history, step('undo'), step('redo')];
}
