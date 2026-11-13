// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The stores' write rule (core section 10, "Staged writes"): check now, then stage the write on the command's
 * unit of work when given a CommandContext (it commits with the command's audit row), else run it at once.
 * Either way the write runs in a transaction that checks again first, so a stale check never commits.
 */
import { ok, type CommandContext, type Result } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { writeWith, type CommandStager } from '../ports/staging';
import { inTransaction } from '../repositories/shared';

export type StagedWrite = (
  context: CommandContext | undefined,
  check: () => Result<void>,
  apply: () => Result<unknown> | void,
) => Result<void>;

export function stagedWriter(
  db: LibraryDatabase,
  commands: CommandStager | undefined,
  entity: string,
): StagedWrite {
  return (context, check, apply) =>
    writeWith(commands, context, check, () =>
      inTransaction(db, entity, () => {
        const again = check();
        if (!again.ok) return again;
        return apply() ?? ok(undefined);
      }),
    );
}
