// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UI actions: things only the renderer can do (go to a page, open a card),
 * asked for from outside it. Main's app menu and bus commands such as
 * `go.library` (commands/ui-commands.ts) and settings.openSignInWarning emit
 * a `ui.action` event; the renderer runs the palette item with the same id,
 * so ⌘K, the menu and the shortcut do one thing.
 */
import '../basics/zod-config';
import { z } from 'zod';

const ACTION_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9-]+)+$/;

export const uiActionSchema = z.object({
  /** A palette item id, e.g. 'go.library' or 'settings.openSignInWarning'. */
  action: z.string().regex(ACTION_PATTERN).max(100),
  /** Plain strings only (ids, versions); never user text. */
  args: z.record(z.string(), z.string().max(200)).optional(),
});
export type UiAction = z.infer<typeof uiActionSchema>;
