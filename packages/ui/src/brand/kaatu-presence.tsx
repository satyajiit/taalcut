// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createContext, useContext } from 'react';

/**
 * Whether Kaatu shows (UX4: the "Show Kaatu" preference, on by default). The app keeps the preference and provides
 * it here; with it off, every decorative Kaatu (the companion, a moment's, an empty state's) is gone and the words
 * beside it stay. Outside a provider Kaatu shows, as in the kit's previews and tests.
 */
const KaatuShown = createContext(true);

export const KaatuPresenceProvider = KaatuShown.Provider;

export function useKaatuShown(): boolean {
  return useContext(KaatuShown);
}
