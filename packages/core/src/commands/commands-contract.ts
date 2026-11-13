// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The command bus over IPC, for the renderer (buttons, shortcuts, ⌘K). The
 * renderer may only claim the 'ui' or 'shortcut' source; the actor is fixed
 * by the server, so a page can't pose as the agent. A payload is checked
 * against its command's schema by the bus; here (in main too, before it is
 * forwarded) only its size and nesting are capped.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { withinJsonLimits, type JsonLimits } from '../basics/json-limits';
import { implementContract, ipc } from '../ipc/contract';
import { unwrapRpc } from '../ipc/errors';
import type { CommandBus } from './bus-types';
import { editorActivityContract, watchEditorActivity } from './editor-activity-contract';
import { commandGroupSchema, commandNameSchema, shortcutSchema, SIDE_EFFECTS } from './definition';

const rendererSource = z.enum(['ui', 'shortcut']).default('ui');

/** The most a page may send as one command's payload. */
export const COMMAND_PAYLOAD_LIMITS: JsonLimits = { maxBytes: 1024 * 1024, maxDepth: 32 };

const payloadSchema = z.unknown().refine((payload) => withinJsonLimits(payload, COMMAND_PAYLOAD_LIMITS), {
  message: `Larger than ${COMMAND_PAYLOAD_LIMITS.maxBytes} bytes or nested deeper than ${COMMAND_PAYLOAD_LIMITS.maxDepth}`,
});
const projectIdSchema = idSchema<'Project'>().nullable();

export const dispatchReceiptSchema = z.object({
  id: idSchema<'Command'>(),
  name: commandNameSchema,
  projectId: projectIdSchema,
  sequence: z.int().positive().nullable(),
  result: z.unknown(),
  undoable: z.boolean(),
  deduplicated: z.boolean(),
});

export const historyReceiptSchema = z
  .object({
    id: idSchema<'Command'>(),
    name: commandNameSchema,
    projectId: projectIdSchema,
    /** What the inverse (undo) or the re-run (redo) returned; parse it with that command's result schema. */
    result: z.unknown().optional(),
    /** EDT1: the group the step took whole, and how many commands it had. */
    group: commandGroupSchema.optional(),
    steps: z.int().positive().optional(),
  })
  .nullable();

export const commandInfoSchema = z.object({
  name: commandNameSchema,
  sideEffect: z.enum(SIDE_EFFECTS),
  labelKey: z.string(),
  /** e.g. 'mod+shift+z'; absent when the command has no key binding. */
  shortcut: shortcutSchema.optional(),
  /** The binding on a PC (Linux, Windows) when it isn't `shortcut` (shortcutOn). */
  pcShortcut: shortcutSchema.optional(),
  /** true for commands people don't pick (inverses only undo and redo run): ⌘K hides them. */
  internal: z.literal(true).optional(),
  /** true when the command's payload schema refuses `{}`: only the page that supplies a payload runs it. */
  needsPayload: z.literal(true).optional(),
});

const historyStep = ipc
  .input(
    z.object({
      projectId: projectIdSchema,
      source: rendererSource,
      /** EDT1: only when the step is this group (the changes card's "Undo this change"); a conflict otherwise. */
      group: commandGroupSchema.optional(),
    }),
  )
  .output(historyReceiptSchema);

export const commandsContract = {
  ...editorActivityContract,
  dispatch: ipc
    .input(
      z.object({
        name: commandNameSchema,
        payload: payloadSchema,
        source: rendererSource,
        /** e.g. one per button press, so a double click applies once. */
        idempotencyKey: z.string().min(1).max(512).optional(),
      }),
    )
    .output(dispatchReceiptSchema),
  undo: historyStep,
  redo: historyStep,
  history: ipc.input(z.object({ projectId: projectIdSchema })).output(
    z.object({
      undo: commandNameSchema.nullable(),
      redo: commandNameSchema.nullable(),
      /** EDT1: the group the next undo or redo takes whole, when it is one. */
      undoGroup: commandGroupSchema.nullable().optional(),
      redoGroup: commandGroupSchema.nullable().optional(),
    }),
  ),
  list: ipc.output(z.array(commandInfoSchema)),
};

const groupOf = ({ group }: { readonly group?: string | undefined }) =>
  group !== undefined ? { group } : {};

/** Serves commandsContract from a bus. Every renderer call is attributed to `actor` (the signed-in user). */
export function commandsRouter(bus: CommandBus, actor = 'user') {
  const os = implementContract(commandsContract);
  return os.router({
    editing: os.editing.handler(({ input }) => bus.editing.snapshot(input.projectId)),
    watchEditing: os.watchEditing.handler(({ input, signal }) =>
      watchEditorActivity(bus.editing, input.projectId, signal ?? new AbortController().signal),
    ),
    dispatch: os.dispatch.handler(async ({ input }) =>
      unwrapRpc(
        await bus.dispatch(
          input.name,
          input.payload,
          { source: input.source, actor },
          { idempotencyKey: input.idempotencyKey },
        ),
      ),
    ),
    undo: os.undo.handler(async ({ input }) =>
      unwrapRpc(await bus.undo(input.projectId, { source: input.source, actor }, groupOf(input))),
    ),
    redo: os.redo.handler(async ({ input }) =>
      unwrapRpc(await bus.redo(input.projectId, { source: input.source, actor }, groupOf(input))),
    ),
    history: os.history.handler(async ({ input }) => unwrapRpc(await bus.history(input.projectId))),
    list: os.list.handler(() => bus.list()),
  });
}
