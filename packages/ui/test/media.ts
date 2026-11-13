// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

type Listener = (event: { matches: boolean }) => void;

/** jsdom has no matchMedia. This fake lets a test flip the OS appearance. */
export function installMatchMedia(dark: boolean): { setDark(next: boolean): void; listenerCount(): number } {
  let matches = dark;
  const listeners = new Set<Listener>();
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return matches;
    },
    onchange: null,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
  return {
    setDark(next) {
      matches = next;
      for (const listener of listeners) listener({ matches: next });
    },
    listenerCount: () => listeners.size,
  };
}
