// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Writes that a command makes through a port (settings, model profiles) commit
 * with the command's audit row (P1-D5): given the command's context, the store
 * stages the write in the unit of work instead of committing it now. Without a
 * context (start-up, migration, tests) it writes immediately.
 */
import { ok, type CommandContext, type Result } from '@taalcut/core';

/** The part of CommandUnitOfWork a store needs (structural, so this module imports nothing of it). */
export interface CommandStager {
  stage(context: CommandContext, write: () => Result<unknown>): Result<void>;
}

/**
 * Checks first, so a write the store would refuse fails the handler now rather than the command's commit;
 * then stages it with the command, or runs it when there is no context or no unit of work.
 */
export function writeWith(
  stager: CommandStager | undefined,
  context: CommandContext | undefined,
  check: () => Result<void>,
  write: () => Result<unknown>,
): Result<void> {
  const checked = check();
  if (!checked.ok) return checked;
  if (context && stager) return stager.stage(context, write);
  const written = write();
  return written.ok ? ok(undefined) : written;
}
