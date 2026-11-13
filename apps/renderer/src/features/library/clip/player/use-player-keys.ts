// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The clip page's player keys, wherever the focus is on the page (not in a field, a menu, a dialog or a list that
 * moves with arrows): Space plays and pauses, J K L shuttle, ← → step a frame, ⇧← ⇧→ go to the previous or next
 * shot, R loops the shot, M mutes, F fills the screen. A key a control handled itself (the scrubber's own arrows, a menu's) never
 * gets here. The same words and keys are on the transport's buttons (`PLAYER_KEYS`).
 */
import { useEffect, useEffectEvent } from 'react';

export interface PlayerKeys {
  toggle(): void;
  shuttle(direction: -1 | 1): void;
  pause(): void;
  stepFrame(direction: -1 | 1): void;
  stepShot(direction: -1 | 1): void;
  toggleMute(): void;
  toggleLoop(): void;
  toggleFullscreen(): void;
}

/** The transport's keys as accelerators (aria-keyshortcuts and the tooltips' keys): key names, not words. */
/* eslint-disable lingui/no-unlocalized-strings -- key names from the UI Events spec, shown as key caps */
export const PLAYER_KEYS = {
  play: 'Space',
  backFrame: 'ArrowLeft',
  nextFrame: 'ArrowRight',
  previousShot: 'Shift+ArrowLeft',
  nextShot: 'Shift+ArrowRight',
  loop: 'R',
  mute: 'M',
  fullscreen: 'F',
} as const;
/* eslint-enable lingui/no-unlocalized-strings */

const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
/** A button's own Space presses it. */
const PRESSABLE = 'button, a[href], [role=button], [role=menuitem], [role=option], [role=tab]';
/** Where arrows and letters belong to something else. */
const ELSEWHERE =
  '[role=dialog], [role=menu], [role=listbox], [role=tablist], [role=radiogroup], [data-slot=palette]';

export function usePlayerKeys(keys: PlayerKeys, enabled: boolean): void {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!enabled || event.defaultPrevented || event.isComposing) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(TYPING) || target?.closest(ELSEWHERE)) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const act = (run: () => void) => {
      event.preventDefault();
      run();
    };
    if (key === ' ') {
      if (!target?.closest(PRESSABLE)) act(keys.toggle);
    } else if (key === 'j') act(() => keys.shuttle(-1));
    else if (key === 'k') act(keys.pause);
    else if (key === 'l') act(() => keys.shuttle(1));
    else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const direction = key === 'ArrowLeft' ? -1 : 1;
      act(() => (event.shiftKey ? keys.stepShot(direction) : keys.stepFrame(direction)));
    } else if (key === 'm') act(keys.toggleMute);
    else if (key === 'r') act(keys.toggleLoop);
    else if (key === 'f') act(keys.toggleFullscreen);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
}
