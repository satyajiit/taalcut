// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useIdleMood, type MascotMood } from '@taalcut/ui';
import { useEffect, useSyncExternalStore } from 'react';
import { companionWork, reportWork, subscribeWork } from './companion-work';

/**
 * The companion's mood from the app's state (UX4): a grin or a bashful look for a moment when work ends; thinking
 * while anything runs; otherwise idle, asleep after a quiet minute, and dozing a moment after nightfall (the theme's
 * scene), as Kaatu does everywhere.
 */
export function useCompanionMood(): MascotMood {
  const idle = useIdleMood();
  const work = useSyncExternalStore(subscribeWork, companionWork);
  if (work.pulse) return work.pulse;
  if (work.busy) return 'thinking';
  return idle;
}

/**
 * A page that knows of work the backend's events don't carry (the chat's run, from its own stream) tells the
 * companion, by a key of its own, with the mood its own Kaatu shows: thinking while it runs, then happy or oops.
 */
export function useReportWork(key: string, mood: MascotMood): void {
  useEffect(() => {
    if (mood === 'thinking') reportWork(key, 'running');
    else if (mood === 'happy') reportWork(key, 'succeeded', { moment: true });
    else if (mood === 'oops') reportWork(key, 'failed');
    else reportWork(key, 'stopped');
  }, [key, mood]);
  // Leaving the page stops what it reported: it can't say how it ended any more.
  useEffect(() => () => reportWork(key, 'stopped'), [key]);
}
