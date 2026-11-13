// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Help menu: Send Feedback… (core's help.feedback, the page's dialog),
 * then the project on GitHub, which left the window bar in UX round 1
 * (DESIGN.md "Window", v0.4); Settings › About links the same pages. Each
 * item sends its palette item's id as a `ui.action`, so ⌘K and the menu open
 * one thing, and the page opens the browser through files.openExternal's
 * checks. With the help role, macOS adds its search field.
 */
import type { MessageDescriptor } from '@lingui/core';
import type { UiAction } from '@taalcut/core';
import type { MenuItemConstructorOptions } from 'electron';

export const HELP_LABELS = {
  help: /*i18n*/ { id: 'menu.help', message: 'Help' },
  feedback: /*i18n*/ { id: 'menu.help.feedback', message: 'Send Feedback…' },
  github: /*i18n*/ { id: 'menu.help.github', message: 'Star {appName} on GitHub' },
  reportIssue: /*i18n*/ { id: 'menu.help.reportIssue', message: 'Report an Issue on GitHub' },
  requestFeature: /*i18n*/ { id: 'menu.help.requestFeature', message: 'Request a Feature on GitHub' },
} as const satisfies Record<string, MessageDescriptor>;

/** The palette items the Help menu runs, by label. */
export const HELP_ACTIONS = {
  feedback: 'help.feedback',
  github: 'help.github',
  reportIssue: 'help.reportIssue',
  requestFeature: 'help.requestFeature',
} as const satisfies Partial<Record<keyof typeof HELP_LABELS, string>>;

export function helpMenu(
  text: (message: MessageDescriptor) => string,
  run: (action: UiAction) => void,
): MenuItemConstructorOptions {
  const item = (name: keyof typeof HELP_ACTIONS): MenuItemConstructorOptions => ({
    label: text(HELP_LABELS[name]),
    click: () => run({ action: HELP_ACTIONS[name] }),
  });
  return {
    role: 'help',
    label: text(HELP_LABELS.help),
    submenu: [
      item('feedback'),
      { type: 'separator' },
      item('github'),
      item('reportIssue'),
      item('requestFeature'),
    ],
  };
}
