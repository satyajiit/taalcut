// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The command bus's helpers that hold no state: source checks, running a handler, parsing, replays. */
import { ConflictError, toTaalcutError, ValidationError } from '../basics/errors';
import type { ProjectId } from '../basics/ids';
import { err, ok, type AsyncResult, type Result } from '../basics/result';
import type { AuditEntry, AuditLogStore } from './audit-log';
import { CommandSourceRefused, type DispatchReceipt } from './bus-types';
import type { AnyCommand, CommandContext, CommandOrigin, CommandOutcome } from './definition';

/** A command declared for some sources only refuses the others (`sources`). */
export function refuseSource(command: AnyCommand, origin: CommandOrigin): Result<void> {
  if (!command.sources || command.sources.includes(origin.source)) return ok(undefined);
  return err(CommandSourceRefused({ name: command.name, source: origin.source }));
}

export const keyOf = (projectId: ProjectId | null): string => projectId ?? '';

export async function run(
  command: AnyCommand,
  payload: unknown,
  context: CommandContext,
): AsyncResult<CommandOutcome<unknown>> {
  try {
    return await command.handle(payload, context);
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
}

export function parse(command: AnyCommand, payload: unknown): Result<unknown> {
  const parsed = command.payload.safeParse(payload);
  if (parsed.success) return ok(parsed.data);
  const field = parsed.error.issues[0]?.path.map(String).join('.') || undefined;
  return err(
    ValidationError(field ? { field } : undefined, { detail: `${command.name}: ${parsed.error.message}` }),
  );
}

/** The original receipt for a repeated idempotency key, or a conflict if the key belongs to another command. */
export function replay(command: AnyCommand, entry: AuditEntry, key: string): Result<DispatchReceipt> {
  if (entry.name !== command.name) {
    return err(
      ConflictError({ entity: 'command', id: key }, { detail: `Key already used by ${entry.name}` }),
    );
  }
  const { id, name, projectId, sequence, result } = entry;
  return ok({ id, name, projectId, sequence, result, undoable: entry.inverse !== null, deduplicated: true });
}

/** The step that ran with `context` won't be recorded: the store drops what its handlers staged (review M1). */
export function unrecorded<T>(store: AuditLogStore, context: CommandContext, result: T): T {
  store.discard?.(context);
  return result;
}
