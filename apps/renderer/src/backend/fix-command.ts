// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { FixAction } from '@taalcut/core';

/**
 * The command an error's fix button dispatches. A fix that names no payload runs a command that takes none, such as
 * core's UI commands (`system.openFilesAndFolders`, `system.openStorage`), whose schema is an empty object: the bus
 * refuses a missing payload as `core.validation`, so the button would only show that.
 */
export function fixCommand(fix: FixAction): { readonly name: string; readonly payload: unknown } {
  return { name: fix.command, payload: fix.payload ?? {} };
}
