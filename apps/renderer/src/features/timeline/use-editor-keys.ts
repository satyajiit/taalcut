// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The editor's own keys, wherever the focus is on the page (not in a field,
 * a button, a menu or the docked chat): Space plays and pauses, ⌘= and ⌘−
 * zoom, ⌘0 fits the whole video, Escape lets go of the selection. A key a
 * control handled itself (the clips' arrows, a menu's Escape) never gets here.
 */
import { useEffect, useEffectEvent } from 'react';

export interface EditorKeys {
  togglePlay(): void;
  zoom(step: -1 | 1): void;
  fit(): void;
  deselect(): void;
}

const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
/** A button's own Space presses it. */
const PRESSABLE = 'button, a[href]';
const ELSEWHERE = '[data-slot=editor-dock], [role=dialog], [role=menu], [role=listbox][data-slot=palette]';

export function useEditorKeys(keys: EditorKeys): void {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(TYPING) || target?.closest(ELSEWHERE)) return;
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === ' ' && !mod && !event.altKey) {
      if (target?.closest(PRESSABLE)) return;
      event.preventDefault();
      keys.togglePlay();
    } else if (mod && !event.altKey && (event.key === '=' || event.key === '+')) {
      event.preventDefault();
      keys.zoom(1);
    } else if (mod && !event.altKey && (event.key === '-' || event.key === '_')) {
      event.preventDefault();
      keys.zoom(-1);
    } else if (mod && !event.altKey && event.key === '0') {
      event.preventDefault();
      keys.fit();
    } else if (event.key === 'Escape' && !mod) {
      keys.deselect();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}
