// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The visitor's analytics choice (the owner's call, 2026-11-06: on for everyone, with a remembered opt-out). Nothing
 * here loads the SDK. A visitor who never chose gets "on", unless the browser sends Global Privacy Control or Do Not
 * Track, which count as "off" until the visitor turns it on. The footer's switch writes the choice; the privacy
 * notice names the key.
 */

export type AnalyticsChoice = 'on' | 'off';

/** In local storage: "on" or "off", written only when the visitor uses the footer's switch. */
export const ANALYTICS_KEY = 'taalcut.analytics';

/** The browser signals that ask a site not to track: Global Privacy Control, and Do Not Track. */
export interface PrivacySignals {
  readonly globalPrivacyControl?: boolean;
  readonly doNotTrack?: string | null;
}

/** Whether the browser asks not to be tracked. */
export function browserAsksOff(signals: PrivacySignals | undefined): boolean {
  return signals?.globalPrivacyControl === true || signals?.doNotTrack === '1';
}

/** A stored choice wins; with none, the browser's signal decides, and otherwise analytics is on. */
export function resolveChoice(stored: string | null, asksOff: boolean): AnalyticsChoice {
  if (stored === 'on' || stored === 'off') return stored;
  return asksOff ? 'off' : 'on';
}

const listeners = new Set<() => void>();

function stored(): string | null {
  try {
    return window.localStorage.getItem(ANALYTICS_KEY);
  } catch {
    return null;
  }
}

/** The choice in this browser. Browser-only: React reads it through useSyncExternalStore, with null on the server. */
export function readChoice(): AnalyticsChoice {
  return resolveChoice(stored(), browserAsksOff(navigator as PrivacySignals));
}

/** Set when storage refuses a write, so the switch still flips on this page. */
let sessionChoice: AnalyticsChoice | null = null;

/** Saves the choice and tells every listener in this tab. */
export function writeChoice(choice: AnalyticsChoice): void {
  try {
    window.localStorage.setItem(ANALYTICS_KEY, choice);
    sessionChoice = null;
  } catch {
    // Blocked storage (a private window): the choice holds for this page only.
    sessionChoice = choice;
  }
  for (const listener of listeners) listener();
}

/** The choice, with a write that storage refused taking its place. */
export function currentChoice(): AnalyticsChoice {
  return sessionChoice ?? readChoice();
}

/** Listens for a change in this tab (the switch) or another (the storage event). Returns the unsubscribe. */
export function subscribeChoice(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === ANALYTICS_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
