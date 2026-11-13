// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useEffect } from 'react';
import type { HistoryLedger } from './history-ledger';

/** MouseEvent.button for a mouse's side buttons. */
const BACK_BUTTON = 3;
const FORWARD_BUTTON = 4;

/**
 * Where the page answers the mouse's back and forward buttons itself. On a
 * Mac nothing else does; Electron on Windows and Linux turns them into app
 * commands that main answers (apps/desktop/src/main/menu/navigation.ts), so
 * there the page stands back and a press never counts twice. A plain browser
 * (the dev server, tests) is the page's to answer.
 */
export function pageAnswersMouseButtons(inApp: boolean, userAgent: string): boolean {
  return !inApp || /Macintosh|Mac OS X/.test(userAgent);
}

/** Back and Forward on the mouse's side buttons. Chromium would act on the press itself, so it is cancelled. */
export function watchMouseHistory(ledger: Pick<HistoryLedger, 'back' | 'forward'>): () => void {
  const side = (event: MouseEvent) => event.button === BACK_BUTTON || event.button === FORWARD_BUTTON;
  const onDown = (event: MouseEvent) => {
    if (side(event)) event.preventDefault();
  };
  const onUp = (event: MouseEvent) => {
    if (!side(event)) return;
    event.preventDefault();
    if (event.button === BACK_BUTTON) ledger.back();
    else ledger.forward();
  };
  window.addEventListener('mousedown', onDown);
  window.addEventListener('mouseup', onUp);
  return () => {
    window.removeEventListener('mousedown', onDown);
    window.removeEventListener('mouseup', onUp);
  };
}

export function useMouseHistory(ledger: HistoryLedger, enabled: boolean): void {
  useEffect(() => (enabled ? watchMouseHistory(ledger) : undefined), [ledger, enabled]);
}
