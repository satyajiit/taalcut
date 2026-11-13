// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { overlayOpen } from '@taalcut/ui';
import { useEffect } from 'react';
import type { HistoryLedger } from './history-ledger';

/** ⌘[ and ⌘], as in Finder, Safari and System Settings; the View menu's Back and Forward have the same keys. */
export const BACK_SHORTCUT = 'mod+[';
export const FORWARD_SHORTCUT = 'mod+]';

/**
 * ⌘ (Ctrl in a browser elsewhere) with [ or ], and nothing else held. By the
 * key, or by its place (BracketLeft, BracketRight) where a layout puts the
 * bracket behind Option.
 */
function stepOf(event: KeyboardEvent): 'back' | 'forward' | null {
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return null;
  if (event.key === '[' || event.code === 'BracketLeft') return 'back';
  if (event.key === ']' || event.code === 'BracketRight') return 'forward';
  return null;
}

/**
 * ⌘[ and ⌘] on every page, text fields included, as in Safari: neither key
 * edits text. Taken first (the capture phase) and kept from the page, so a
 * control with its own [ and ] (the editor's clips trim with them) can't
 * swallow Back; the bare keys are still theirs. Handled here, the press never
 * reaches the app menu's accelerators as well, so a step is never taken
 * twice. Not while a dialog or menu is open: the press is then the dialog's,
 * and is still kept from the app menu, so the page never changes behind a
 * dialog. A held key steps once.
 */
export function watchHistoryKeys(ledger: Pick<HistoryLedger, 'back' | 'forward'>): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    const step = stepOf(event);
    if (!step) return;
    event.preventDefault();
    if (overlayOpen()) return;
    event.stopPropagation();
    if (event.repeat) return;
    if (step === 'back') ledger.back();
    else ledger.forward();
  };
  window.addEventListener('keydown', onKeyDown, { capture: true });
  return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
}

export function useHistoryKeys(ledger: HistoryLedger): void {
  useEffect(() => watchHistoryKeys(ledger), [ledger]);
}
