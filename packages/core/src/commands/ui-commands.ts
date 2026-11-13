// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Commands only the focused window can carry out: go to an area or Settings,
 * undo or redo in the project it shows, show or hide its sidebar. Each is read-only (the audit log keeps
 * nothing) and its handler emits `ui.action` with the command's name; the
 * renderer runs the palette item with that id. Their shortcuts are defined
 * here and nowhere else: ⌘K reads them from `commands.list`, main's menu from
 * these definitions, so ⌘1–4, ⌘,, ⌘Z, ⌘⇧Z and ⌃⌘S agree everywhere. On a PC
 * (Linux, Windows) `mod` is Ctrl, and the one that would clash there has a PC
 * binding of its own (Ctrl+B for the sidebar).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { ok } from '../basics/result';
import type { EventBus } from '../events/bus';
import { defineCommand, shortcutOn, type Keyboard } from './definition';

export const UI_COMMAND_NAMES = [
  'go.make',
  'go.library',
  'go.templates',
  'go.agent',
  'go.settings',
  'edit.undo',
  'edit.redo',
  'view.sidebar',
  'chat.addSelection',
  'go.projects',
  'go.privacy',
  'help.feedback',
  /**
   * @deprecated REF1 (2026-10-29): the reel-download warning card is gone, so nothing asks for it any more and the
   * window ignores it. It stays so a chat stored before REF1, whose error still names it as its fix, parses.
   */
  'reference.showWarning',
  'system.openFilesAndFolders',
  'go.language',
  'system.openStorage',
] as const;
export type UiCommandName = (typeof UI_COMMAND_NAMES)[number];

/** Each UI command's key binding; `undefined` for one that ⌘K and the menus list without a shortcut. */
const UI_COMMAND_SHORTCUTS: Readonly<Record<UiCommandName, string | undefined>> = {
  'go.make': 'mod+1',
  'go.library': 'mod+2',
  'go.templates': 'mod+3',
  'go.agent': 'mod+4',
  'go.settings': 'mod+,',
  'edit.undo': 'mod+z',
  'edit.redo': 'mod+shift+z',
  // View › Show/Hide Sidebar, as in Finder and Notes (⌃⌘S).
  'view.sidebar': 'ctrl+mod+s',
  // Phase 2: point the chat at what is selected (V3); projects; Settings → Privacy; Help → Send feedback.
  'chat.addSelection': 'mod+shift+a',
  'go.projects': undefined,
  'go.privacy': undefined,
  'help.feedback': undefined,
  // Fix buttons: once the reference-download warning card (deprecated since REF1: no card, nothing to open), and
  // System Settings › Privacy & Security › Files and Folders (library.folder_permission_denied; main's
  // files.openSystemSettings).
  'reference.showWarning': undefined,
  'system.openFilesAndFolders': undefined,
  // P3-L2: ⌘K "Change language…" opens Settings › About at Language (GO_LANGUAGE_COMMAND).
  'go.language': undefined,
  // UX2-DOWNLOADER: the fix button on a disk-space error (jobs.downloads_space_low, jobs.disk_space_low) opens
  // System Settings › General › Storage (main's files.openSystemSettings, pane `storage`).
  'system.openStorage': undefined,
};

/**
 * Where a binding above would clash on a PC (Linux, Windows): ⌃⌘S is Ctrl+S there, which is Save (and a browser's
 * Save Page). Ctrl+B toggles the sidebar in VS Code and Firefox.
 */
const UI_COMMAND_PC_SHORTCUTS: Readonly<Partial<Record<UiCommandName, string>>> = {
  'view.sidebar': 'mod+b',
};

/** A UI command's binding on this keyboard, for a page's own button that names it (the window bar's sidebar button). */
export function uiCommandShortcut(name: UiCommandName, keyboard: Keyboard): string | undefined {
  return shortcutOn(
    { shortcut: UI_COMMAND_SHORTCUTS[name], pcShortcut: UI_COMMAND_PC_SHORTCUTS[name] },
    keyboard,
  );
}

/** The four areas, in menu and shortcut order (Settings sits in the app menu). */
export const AREA_COMMANDS: readonly UiCommandName[] = ['go.make', 'go.library', 'go.templates', 'go.agent'];

export function createUiCommands(deps: { readonly events: Pick<EventBus, 'emit'> }) {
  const all = UI_COMMAND_NAMES.map((name) =>
    defineCommand({
      name,
      payload: z.object({}),
      sideEffect: 'read',
      ...(UI_COMMAND_SHORTCUTS[name] !== undefined ? { shortcut: UI_COMMAND_SHORTCUTS[name] } : {}),
      ...(UI_COMMAND_PC_SHORTCUTS[name] !== undefined ? { pcShortcut: UI_COMMAND_PC_SHORTCUTS[name] } : {}),
      project: () => null,
      handle() {
        deps.events.emit('ui.action', { action: name });
        return ok({ result: null });
      },
    }),
  );
  return { all };
}
