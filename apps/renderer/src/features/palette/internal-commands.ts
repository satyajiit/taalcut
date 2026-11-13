// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which bus commands ⌘K offers, and how. The bus marks what ⌘K can't run as is: `internal` (an inverse only undo
 * and redo run) and `needsPayload` (a payload schema that refuses `{}`: the command names a project, a clip, a
 * template, a memory or a plugin its page supplies). ⌘K runs every other command with an empty payload, so a command
 * that needs one is offered only through an item of ⌘K's own that supplies it (a preset or a Phase 3 opener), never
 * as is. e2e/palette.spec.ts runs every command ⌘K offers. Plain module (no macros) so the e2e tests can import it.
 */
import type { CommandInfo } from '@taalcut/core';

/**
 * The few commands that accept `{}` and still belong to their page or moment, so ⌘K leaves them out by name:
 * - `reference.showWarning`: deprecated (REF1), once the reel-download warning's fix; it opens nothing now;
 * - `system.openFilesAndFolders`: System Settings' Files and Folders, the fix for a folder Taalcut couldn't read;
 * - `system.openStorage`: System Settings' Storage, the fix for a full disk (UX2-DOWNLOADER);
 * - `onboarding.reset`: Run setup again, on Settings › About (Help), where it says what starts over;
 * - `go.projects`: the projects list is the Make area's page, which ⌘K lists once as Make (`go.make`); the shell
 *   still carries out the agent's `go.projects` (shell/nav/projects-action.ts).
 */
export const INTERNAL_COMMANDS: ReadonlySet<string> = new Set([
  'reference.showWarning',
  'system.openFilesAndFolders',
  'system.openStorage',
  'onboarding.reset',
  'go.projects',
]);

/** How ⌘K offers a command the bus lists: through an item of its own that supplies the payload, as is, or not. */
export type PaletteOffer = 'ownItem' | 'asIs' | 'hidden';

/** `ownItem`: ⌘K has a preset or a Phase 3 opener for the command, which supplies its payload or opens its page. */
export function paletteOffer(
  info: Pick<CommandInfo, 'name' | 'internal' | 'needsPayload'>,
  ownItem: boolean,
): PaletteOffer {
  if (info.internal || INTERNAL_COMMANDS.has(info.name)) return 'hidden';
  if (ownItem) return 'ownItem';
  return info.needsPayload ? 'hidden' : 'asIs';
}
