// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MouseEvent } from 'react';
import { isUnder } from '../areas';
import { useHistoryLedger } from './use-history-nav';

const SETTINGS = ['/settings'];

/**
 * Settings' "Back to app": back to the page you opened Settings from, as you
 * left it (its scroll, its search), however many sections you looked at on
 * the way. Opened first, with nothing before it, the link goes where it
 * points (the chat).
 */
export function useLeaveSettings(): (event: MouseEvent<HTMLAnchorElement>) => void {
  const ledger = useHistoryLedger();
  return (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    if (ledger.leave((path) => isUnder(path, SETTINGS))) event.preventDefault();
  };
}
