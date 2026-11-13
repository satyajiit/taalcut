// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- key names from the UI Events spec, never shown as words */

/**
 * The editor's keys as `aria-keyshortcuts` names them (UI Events key names,
 * not words for people): what the buttons say the keyboard does too. The ones
 * with ⌘ (Ctrl off a Mac) are ACCELERATORS, which useShortcutFormat shows and
 * names for this platform.
 */
export const KEYS = {
  play: 'Space',
  clear: 'Escape',
  shorter: '[',
  longer: ']',
  /** EDT1-OPS: split the clip at the playhead, delete the selected clip (what follows closes up). */
  split: 's',
  remove: 'Backspace',
} as const;

/** Shortcuts with ⌘ on a Mac and Ctrl elsewhere, as accelerators (@taalcut/ui shortcut.ts). */
export const ACCELERATORS = {
  addToChat: 'mod+shift+a',
  zoomIn: 'mod+=',
  zoomOut: 'mod+-',
  undo: 'mod+z',
  redo: 'mod+shift+z',
} as const;
