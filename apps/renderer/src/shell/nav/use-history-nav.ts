// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useRouter } from '@tanstack/react-router';
import { useSyncExternalStore } from 'react';
import { ledgerFor, type HistoryLedger, type HistorySnapshot } from './history-ledger';

export interface HistoryNav extends HistorySnapshot {
  back(): void;
  forward(): void;
}

/** The window's history ledger: one per router, the same for the bar, ⌘K and the mouse. */
export function useHistoryLedger(): HistoryLedger {
  return ledgerFor(useRouter().history);
}

/** Whether Back and Forward lead anywhere, and the steps themselves (DESIGN.md "Window", v0.4). */
export function useHistoryNav(): HistoryNav {
  const ledger = useHistoryLedger();
  const snapshot = useSyncExternalStore(ledger.subscribe, ledger.get);
  return { ...snapshot, back: ledger.back, forward: ledger.forward };
}
