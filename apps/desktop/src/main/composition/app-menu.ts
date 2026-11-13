// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The app menu. Its accelerators are the `shortcut`s of core's UI
 * commands (createUiCommands), the same ones ⌘K shows from commands.list, or
 * on a PC their `pcShortcut` where they have one (View › Toggle Sidebar: ⌃⌘S,
 * Ctrl+B on Linux and Windows):
 * Go → the four areas (⌘1–4), Settings… (⌘,), and Edit's Undo and Redo (⌘Z,
 * ⌘⇧Z; native roles, so text fields keep their own undo). View's Back and
 * Forward (⌘[ ⌘]) and the Help menu are menu/navigation.ts and
 * menu/help-navigation.ts. A Go or Settings…
 * click emits `ui.action` with the command's name on main's bus, and the
 * renderer runs the palette item with that id. Every label comes from main's
 * catalogue (src/main/i18n), roles included, so the pseudo-locale shows the
 * whole menu. The platform shapes it (platform/types.ts MenuPolicy): macOS has
 * the menu under the app's name; Linux and Windows put Settings… and Quit under
 * File and keep only the Window roles they have, and their menu bar stays
 * hidden (the window bar is the title bar), so the menu is there for its
 * accelerators and roles.
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { AREA_COMMANDS, shortcutOn, type UiAction, type UiCommandName } from '@taalcut/core';
import type { MenuItemConstructorOptions } from 'electron';
import type { MenuPolicy } from '../../platform/types';
import { MENU_LABELS, NAVIGATION_LABELS } from '../i18n/menu-messages';
import { helpMenu } from '../menu/help-navigation';
import { historyMenu } from '../menu/navigation';

/** 'mod+shift+k' → 'CmdOrCtrl+Shift+K' (Electron's accelerator syntax). */
export function toAccelerator(shortcut: string): string {
  const names: Readonly<Record<string, string>> = {
    mod: 'CmdOrCtrl',
    shift: 'Shift',
    alt: 'Alt',
    ctrl: 'Ctrl',
  };
  return shortcut
    .split('+')
    .map((part) => names[part] ?? part.toUpperCase())
    .join('+');
}

/** What the menu needs of a command: its name and key bindings (a CommandDefinition or CommandInfo). */
export interface MenuCommand {
  readonly name: string;
  readonly shortcut?: string;
  readonly pcShortcut?: string;
}

export interface AppMenuOptions {
  /** A product name: shown as is. */
  readonly appName: string;
  /** Development builds add reload and the developer tools. */
  readonly development: boolean;
  /** Main's translations (mainI18n). */
  readonly i18n: I18n;
  /** Where the accelerators come from: core's UI commands. */
  readonly commands: readonly MenuCommand[];
  readonly run: (action: UiAction) => void;
  /** The platform's shape for the menu, and whose keyboard its accelerators are for. */
  readonly policy: Pick<MenuPolicy, 'appMenu' | 'keyboard'>;
}

type Role = NonNullable<MenuItemConstructorOptions['role']>;
type Label = keyof typeof MENU_LABELS;

export function appMenuTemplate(options: AppMenuOptions): MenuItemConstructorOptions[] {
  const text = (message: MessageDescriptor) =>
    options.i18n._({ ...message, values: { appName: options.appName } });
  const role = (name: Role & Label): MenuItemConstructorOptions => ({
    role: name,
    label: text(MENU_LABELS[name]),
  });
  const separator: MenuItemConstructorOptions = { type: 'separator' };
  const accelerator = (name: UiCommandName): Pick<MenuItemConstructorOptions, 'accelerator'> => {
    const command = options.commands.find((entry) => entry.name === name);
    const shortcut = command && shortcutOn(command, options.policy.keyboard);
    return shortcut ? { accelerator: toAccelerator(shortcut) } : {};
  };
  const item = (name: UiCommandName): MenuItemConstructorOptions => {
    const label = NAVIGATION_LABELS[name];
    return {
      label: label ? text(label) : name,
      ...accelerator(name),
      click: () => options.run({ action: name }),
    };
  };
  const go = AREA_COMMANDS.map(item);
  const appMenu: MenuItemConstructorOptions = options.policy.appMenu
    ? {
        label: options.appName,
        submenu: [
          role('about'),
          separator,
          item('go.settings'),
          separator,
          { role: 'services', label: text(MENU_LABELS.services) },
          separator,
          role('hide'),
          role('hideOthers'),
          role('unhide'),
          separator,
          role('quit'),
        ],
      }
    : { label: text(MENU_LABELS.file), submenu: [item('go.settings'), separator, role('quit')] };
  // Zoom and Bring All to Front are macOS roles.
  const windowItems: MenuItemConstructorOptions[] = options.policy.appMenu
    ? [role('minimize'), role('zoom'), separator, role('close'), separator, role('front')]
    : [role('minimize'), separator, role('close')];
  return [
    appMenu,
    {
      label: text(MENU_LABELS.edit),
      submenu: [
        { ...role('undo'), ...accelerator('edit.undo') },
        { ...role('redo'), ...accelerator('edit.redo') },
        separator,
        role('cut'),
        role('copy'),
        role('paste'),
        role('pasteAndMatchStyle'),
        role('delete'),
        role('selectAll'),
      ],
    },
    {
      label: text(MENU_LABELS.view),
      submenu: [
        ...historyMenu.items(text, options.run),
        separator,
        ...(options.development ? [role('reload'), role('toggleDevTools'), separator] : []),
        role('resetZoom'),
        role('zoomIn'),
        role('zoomOut'),
        separator,
        item('view.sidebar'),
        role('togglefullscreen'),
      ],
    },
    { label: text(MENU_LABELS.go), submenu: go },
    {
      role: 'window',
      label: text(MENU_LABELS.window),
      // ⌘M, Zoom and ⌘W also answer the window bar's traffic controls.
      submenu: windowItems,
    },
    helpMenu(text, options.run),
  ];
}
