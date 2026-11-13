// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shortcuts as this platform shows them (shortcut.ts): the Mac's glyphs, or the words on a PC's keys in the app's
 * language. One hook for the kit's ShortcutKeys and RailTooltip and the app's aria-keyshortcuts.
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { useMemo } from 'react';
import { useHostPlatform } from '../platform/host-platform';
import { ariaKeyShortcuts, parseShortcut, shortcutKeys, type KeyWords } from './shortcut';

const KEY_WORDS: Readonly<Record<keyof KeyWords, MessageDescriptor>> = {
  ctrl: msg({ id: 'keys.ctrl', message: 'Ctrl', comment: 'The Control key, as printed on PC keyboards' }),
  alt: msg({ id: 'keys.alt', message: 'Alt', comment: 'The Alt key, as printed on PC keyboards' }),
  shift: msg({ id: 'keys.shift', message: 'Shift', comment: 'The Shift key, as printed on PC keyboards' }),
  enter: msg({ id: 'keys.enter', message: 'Enter', comment: 'The Enter key, as printed on PC keyboards' }),
  escape: msg({ id: 'keys.escape', message: 'Esc', comment: 'The Escape key, as printed on PC keyboards' }),
  backspace: msg({ id: 'keys.backspace', message: 'Backspace', comment: 'The Backspace key on PC keyboards' }),
  delete: msg({ id: 'keys.delete', message: 'Del', comment: 'The Delete key, as printed on PC keyboards' }),
  tab: msg({ id: 'keys.tab', message: 'Tab', comment: 'The Tab key, as printed on PC keyboards' }),
};

export interface ShortcutFormat {
  /** One entry per <kbd>. */
  keys(accelerator: string): string[];
  /** As one string: '⇧⌘Z' on a Mac, 'Ctrl+Shift+Z' elsewhere. */
  text(accelerator: string): string;
  /** The aria-keyshortcuts value. */
  aria(accelerator: string): string;
}

export function useShortcutFormat(): ShortcutFormat {
  const { i18n } = useLingui();
  const platform = useHostPlatform();
  return useMemo(() => {
    const pc =
      platform === 'mac'
        ? undefined
        : (Object.fromEntries(
            Object.entries(KEY_WORDS).map(([key, word]) => [key, i18n._(word)]),
          ) as unknown as KeyWords);
    const keys = (accelerator: string) => shortcutKeys(parseShortcut(accelerator), pc);
    return {
      keys,
      text: (accelerator) => keys(accelerator).join(pc ? '+' : ''),
      aria: (accelerator) => ariaKeyShortcuts(parseShortcut(accelerator), platform),
    };
  }, [i18n, platform]);
}
