// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Kaatu section mood · mode: Persuade (brand character) · system: WEB2 Remix Vernacular
 * states: none of its own: it hands its mood (idle, glance, thinking, delighted, oops, asleep, wave) to every Kaatu
 *   inside it that sets no mood of its own.
 * Lets a section set Kaatu's mood without threading a prop: a section about the AI at work can wrap its Kaatu in
 * <KaatuMoodProvider mood="thinking">, and a form can switch it from glance to delighted. */

import { createContext, type ReactNode, useContext } from 'react';
import type { KaatuMood as Mood } from './kaatu-moods';

const KaatuMoodContext = createContext<Mood | undefined>(undefined);

export function KaatuMoodProvider({ mood, children }: { readonly mood: Mood; readonly children: ReactNode }) {
  return <KaatuMoodContext.Provider value={mood}>{children}</KaatuMoodContext.Provider>;
}

/** The mood the nearest KaatuMoodProvider sets, if any. */
export function useSectionMood(): Mood | undefined {
  return useContext(KaatuMoodContext);
}
