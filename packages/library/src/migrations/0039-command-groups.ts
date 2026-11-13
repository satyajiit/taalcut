// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-CTX: a command's history step (core's `AuditEntry.group`, `DispatchOptions.group`). Commands of one agent
 * turn share a group, and undo and redo take the group whole, so one ⌘Z takes back the whole turn; the column keeps
 * that across a restart, when the bus rebuilds its stacks from the log. Null for a command on its own, which every
 * command before this migration is. Down drops the column: a rebuilt history then undoes those commands one by one.
 */
import type { Migration } from './types';

const up = `
ALTER TABLE commands ADD COLUMN group_id TEXT CHECK (group_id IS NULL OR length(group_id) BETWEEN 1 AND 200);
`;

const down = `
ALTER TABLE commands DROP COLUMN group_id;
`;

export const commandGroups: Migration = { version: 39, name: 'command_groups', up, down };
