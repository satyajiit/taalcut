// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useEffect, useRef } from 'react';
import type { PaletteItem } from './command-palette';
import { isEditableTarget, matchesShortcut, overlayOpen, parseShortcut } from './shortcut';

export interface CommandShortcutOptions {
  /** The palette's own shortcut, which works everywhere, even in a text field. Default 'mod+k'. */
  readonly paletteShortcut?: string;
  /** Without it, ⌘K isn't bound here (see usePaletteShortcut). */
  onTogglePalette?(): void;
}

/** The palette's own dialog doesn't keep ⌘K from closing it. */
const PALETTE = '[data-slot="command-palette"]';

/**
 * Binds ⌘K and every palette item's shortcut on the window. Item shortcuts
 * stay out of the way of text fields and open dialogs; ⌘K toggles the palette
 * from anywhere except another dialog or menu.
 */
export function useCommandShortcuts(
  items: readonly PaletteItem[],
  options: CommandShortcutOptions = {},
): void {
  const latest = useRef({ items, options });
  latest.current = { items, options };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      const { items, options } = latest.current;
      if (
        options.onTogglePalette &&
        matchesShortcut(event, parseShortcut(options.paletteShortcut ?? 'mod+k'))
      ) {
        if (overlayOpen(PALETTE)) return;
        event.preventDefault();
        options.onTogglePalette();
        return;
      }
      // A field in a dialog that is animating out still has focus for a moment; it no longer counts.
      const closing =
        event.target instanceof Element && event.target.closest('[data-state="closed"]') !== null;
      if ((isEditableTarget(event.target) && !closing) || overlayOpen()) return;
      const item = items.find(
        (i) => i.shortcut && !i.disabled && matchesShortcut(event, parseShortcut(i.shortcut)),
      );
      if (!item) return;
      event.preventDefault();
      void item.run();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

const NO_ITEMS: readonly PaletteItem[] = [];

/**
 * Only ⌘K, for an app that loads the palette's items later: bind this where
 * the app starts, and useCommandShortcuts(items) without onTogglePalette
 * where the items are.
 */
export function usePaletteShortcut(onToggle: () => void, shortcut = 'mod+k'): void {
  useCommandShortcuts(NO_ITEMS, { onTogglePalette: onToggle, paletteShortcut: shortcut });
}
