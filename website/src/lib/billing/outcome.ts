// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { type Confirmation, parseConfirmation } from './api';

/**
 * A confirmed payment's outcome, kept for the tab: the page a buyer returns to takes the payment's values out of its
 * address, so without this a reload would have nothing to show. What is kept is the billing service's own answer for
 * that order (its reference, that it is paid, the plan, the amount and the two dates): nothing personal, and none of
 * the payment's own values. Session storage, so it is gone when the tab closes; the privacy notice names the key.
 */
export const OUTCOME_KEY = 'taalcut.premiumOrder';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function sessionStore(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    // Storage can be blocked (private windows): a reload then has nothing to show, as before.
    return null;
  }
}

/** Keeps a paid order's outcome. Anything but a paid one is not kept: only a confirmed payment survives a reload. */
export function rememberOutcome(order: Confirmation, store: Store | null = sessionStore()): void {
  if (order.status !== 'paid' || store === null) return;
  try {
    store.setItem(OUTCOME_KEY, JSON.stringify(order));
  } catch {
    // A full or blocked store: the page still shows the outcome it has; only the reload loses it.
  }
}

/** The paid outcome this tab confirmed, or null. What was stored is checked again like any answer of the service's. */
export function rememberedOutcome(store: Store | null = sessionStore()): Confirmation | null {
  if (store === null) return null;
  try {
    const raw = store.getItem(OUTCOME_KEY);
    const order = raw === null ? null : parseConfirmation(JSON.parse(raw) as unknown);
    return order?.status === 'paid' ? order : null;
  } catch {
    // Not JSON, or a blocked store: nothing remembered.
    return null;
  }
}
