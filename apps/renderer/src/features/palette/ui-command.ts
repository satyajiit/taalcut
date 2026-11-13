// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { shortcutOn, type CommandInfo, type Keyboard } from '@taalcut/core';

/** The bus's command list by name: what uiCommand needs of each entry. */
export type ListedCommands = ReadonlyMap<string, { readonly shortcut?: string | undefined }>;

/**
 * A listed command as this keyboard binds it: on a PC (Linux, Windows) its `pcShortcut`, where it has one, is its
 * shortcut (View › Toggle Sidebar: Ctrl+B, as ⌃⌘S would be Ctrl+S there), so ⌘K shows and binds what the menu does.
 */
export function onKeyboard(info: CommandInfo, keyboard: Keyboard): CommandInfo {
  const shortcut = shortcutOn(info, keyboard);
  return shortcut === undefined || shortcut === info.shortcut ? info : { ...info, shortcut };
}

/**
 * The palette item for a bus command the page carries out itself (core's UI
 * commands: go.*, edit.*): the command's name, and its shortcut from the
 * bus's list, so ⌘K, the app menu and the keys can't disagree. Nothing until
 * the list has loaded, or when the bus doesn't have the command.
 */
export function uiCommand(commands: ListedCommands, name: string) {
  const info = commands.get(name);
  if (!info) return {};
  return { command: name, ...(info.shortcut ? { shortcut: info.shortcut } : {}) };
}
